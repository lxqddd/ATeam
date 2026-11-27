#!/usr/bin/env node
import { createInterface, type Interface } from 'node:readline/promises'
import type {
  AgentEvent,
  AgentEventEnvelope,
  PermissionRequest,
  QuestionRequest,
  RunOutcome
} from '@ateam/shared'
import { SessionsStore } from '@ateam/agent-core'
import { restoreLegacySessionBackups } from '@ateam/agent-core'
import { createHeadlessRuntime } from '../runtime'
import { buildCliModels, CLI_HELP, parseCliArgs, type CliOptions } from './args'
import { dataCommandOf, runDataCommand } from './data'

async function readStdin(): Promise<string> {
  let text = ''
  for await (const chunk of process.stdin) text += String(chunk)
  return text
}

function summarizeEvent(event: AgentEvent): string | null {
  if (event.type === 'message.part.upsert' && event.part.type === 'tool') {
    if (event.part.state === 'running') return `[tool] ${event.part.toolName}`
    if (event.part.state === 'failed') return `[tool] ${event.part.toolName} failed`
    return null
  }
  return null
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  // Data commands only touch the session store, so they run before any model
  // configuration or agent runtime setup.
  if (dataCommandOf(argv)) return runDataCommand(argv)
  let options: CliOptions
  try {
    options = parseCliArgs(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
  if (options.help) {
    process.stdout.write(CLI_HELP)
    return 0
  }
  if (options.restoreSessions) {
    const restored = await restoreLegacySessionBackups(options.dataDir)
    const store = new SessionsStore(options.dataDir)
    await store.init()
    const total = store.list().length
    await store.close()
    console.log(`Restored ${restored} legacy session backup(s); ${total} session(s) available.`)
    return 0
  }

  let models
  try {
    models = buildCliModels(options)
  } catch (error) {
    if (!options.listSessions) {
      console.error(error instanceof Error ? error.message : String(error))
      return 2
    }
    models = { providers: [], models: [], defaultModel: null }
  }

  const terminalRef: { current: Interface | null } = { current: null }
  let askQueue: Promise<unknown> = Promise.resolve()
  const ask = async (question: string): Promise<string> => {
    terminalRef.current ??= createInterface({ input: process.stdin, output: process.stderr })
    return terminalRef.current.question(question)
  }
  const askQueued = (question: string): Promise<string> => {
    const next = askQueue.then(
      () => ask(question),
      () => ask(question)
    )
    askQueue = next.catch(() => undefined)
    return next
  }

  let sessionId: string | null = options.sessionId
  let outcome: RunOutcome | null = null
  let runError: string | null = null
  let stopRequested = false
  let finishRun: (() => void) | null = null
  const runDone = new Promise<void>((resolve) => {
    finishRun = resolve
  })

  const handlePermission = async (request: PermissionRequest): Promise<void> => {
    if (!process.stdin.isTTY || options.json) {
      runtime.replyPermission(request.id, 'reject')
      console.error(
        `[permission] ${request.toolName} ${request.action} ${request.resource}: rejected (non-interactive)`
      )
      return
    }
    const answer = (
      await askQueued(
        `\nAllow ${request.toolName} (${request.action}) ${request.resource}? [y]es/[a]lways/[N]o: `
      )
    ).trim()
    const decision =
      answer === 'a' || answer === 'always'
        ? 'always'
        : answer === 'y' || answer === 'yes'
          ? 'once'
          : 'reject'
    runtime.replyPermission(request.id, decision)
  }

  const handleQuestion = async (request: QuestionRequest): Promise<void> => {
    if (!process.stdin.isTTY || options.json) {
      runtime.replyQuestion(request.id, { selected: [], custom: null, cancelled: true })
      return
    }
    const lines = [request.header, request.question]
    request.options.forEach((option, index) => {
      lines.push(`  ${index + 1}. ${option.label}`)
    })
    const answer = (await askQueued(`${lines.join('\n')}\n> `)).trim()
    const numbers = answer
      .split(/[\s,]+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= request.options.length)
    if (numbers.length > 0) {
      const selected = numbers.map((value) => request.options[value - 1].label)
      runtime.replyQuestion(request.id, {
        selected: request.multiple ? [...new Set(selected)] : selected.slice(0, 1),
        custom: null
      })
      return
    }
    if (request.allowCustom && answer) {
      runtime.replyQuestion(request.id, { selected: [], custom: answer })
      return
    }
    runtime.replyQuestion(request.id, { selected: [], custom: null, cancelled: true })
  }

  const runtime = createHeadlessRuntime({
    dataDir: options.dataDir,
    workspace: options.workspace,
    models,
    send: (envelope: AgentEventEnvelope) => {
      if (options.json) {
        process.stdout.write(`${JSON.stringify(envelope)}\n`)
      } else {
        const line = summarizeEvent(envelope.event)
        if (line) console.error(line)
      }
      const event = envelope.event
      switch (event.type) {
        case 'message.part.delta':
          if (!options.json && event.kind === 'text') process.stdout.write(event.delta)
          break
        case 'permission.asked':
          void handlePermission(event.permission).catch(() => undefined)
          break
        case 'question.asked':
          void handleQuestion(event.question).catch(() => undefined)
          break
        case 'run.finished':
          outcome = event.status
          runError = event.error ?? null
          finishRun?.()
          break
        default:
          break
      }
    }
  })

  try {
    await runtime.init()
    if (options.listSessions) {
      const sessions = runtime.listSessions().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      if (sessions.length === 0) {
        console.log('No CLI sessions.')
      }
      for (const session of sessions) {
        console.log(`${session.id}\t${session.updatedAt}\t${session.title || '(untitled)'}`)
      }
      return 0
    }

    let prompt = options.prompt
    if (!prompt) {
      if (process.stdin.isTTY) {
        console.error('No prompt provided. Pass a prompt or pipe text via stdin.\n')
        process.stderr.write(CLI_HELP)
        return 2
      }
      prompt = await readStdin()
    }
    if (!prompt.trim()) {
      console.error('The prompt is empty.')
      return 2
    }

    if (sessionId) {
      await runtime.setSessionSettings(sessionId, {
        reasoningEffort: options.reasoning,
        permissionMode: options.permissionMode
      })
      await runtime.setSessionModel(sessionId, models.defaultModel)
    } else {
      const session = await runtime.createSession()
      sessionId = session.id
      await runtime.setSessionSettings(sessionId, {
        reasoningEffort: options.reasoning,
        permissionMode: options.permissionMode
      })
      await runtime.setSessionModel(sessionId, models.defaultModel)
    }
    if (options.agent) await runtime.setSessionAgent(sessionId, options.agent)

    const currentSession = sessionId
    process.on('SIGINT', () => {
      stopRequested = true
      runtime.stopChat(currentSession)
    })

    await runtime.sendChat(currentSession, prompt)
    await runDone
    if (terminalRef.current) {
      terminalRef.current.close()
      terminalRef.current = null
    }
    if (!outcome) {
      console.error('The run ended without a result.')
      return 1
    }
    if (runError) console.error(`\n${runError}`)
    return outcome === 'completed' ? 0 : stopRequested ? 130 : 1
  } finally {
    terminalRef.current?.close()
    await runtime.shutdown().catch(() => undefined)
  }
}

void main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
