import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LanguageModel, TextStreamPart, ToolSet } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentEvent,
  AgentEventEnvelope,
  ChatMessage,
  RuntimeModelsConfig
} from '@ateam/shared'
import { AgentRuntime, type AgentTurnInput } from './runtime'
import type { InstructionFile } from './instructions'
import { SessionsStore } from './sessions-store'
import { makeMessage } from './test/factories'

const MODELS: RuntimeModelsConfig = {
  providers: [{ id: 'provider-1', name: 'Test', type: 'anthropic', apiKey: 'sk-test' }],
  models: [
    {
      id: 'model-1',
      providerId: 'provider-1',
      modelId: 'model-1',
      name: 'Test Model',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ],
  defaultModel: { providerId: 'provider-1', modelId: 'model-1' }
}

function part(value: Record<string, unknown>): TextStreamPart<ToolSet> {
  return value as unknown as TextStreamPart<ToolSet>
}

type Script = (input: AgentTurnInput) => AsyncIterable<TextStreamPart<ToolSet>>

interface Sink {
  send: (envelope: AgentEventEnvelope) => void
  envelopes: AgentEventEnvelope[]
  next: (type: AgentEvent['type']) => Promise<AgentEventEnvelope>
  count: (type: AgentEvent['type']) => number
}

function createSink(): Sink {
  const envelopes: AgentEventEnvelope[] = []
  const queues = new Map<string, AgentEventEnvelope[]>()
  const waiters: Array<{ type: string; resolve: (envelope: AgentEventEnvelope) => void }> = []

  function send(envelope: AgentEventEnvelope): void {
    envelopes.push(envelope)
    const waiterIndex = waiters.findIndex((waiter) => waiter.type === envelope.event.type)
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1)
      waiter.resolve(envelope)
      return
    }
    const queue = queues.get(envelope.event.type) ?? []
    queue.push(envelope)
    queues.set(envelope.event.type, queue)
  }

  return {
    send,
    envelopes,
    next: (type) => {
      const queue = queues.get(type)
      if (queue?.length) return Promise.resolve(queue.shift() as AgentEventEnvelope)
      return new Promise((resolve) => waiters.push({ type, resolve }))
    },
    count: (type) => envelopes.filter((envelope) => envelope.event.type === type).length
  }
}

function textScript(text: string, finishReason = 'stop'): Script {
  return async function* () {
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text })
    yield part({ type: 'text-end', id: 't1' })
    yield part({
      type: 'finish',
      finishReason,
      totalUsage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 }
    })
  }
}

function errorScript(message: string): Script {
  return async function* () {
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'partial' })
    yield part({ type: 'error', error: new Error(message) })
  }
}

function contextErrorScript(): Script {
  return async function* () {
    yield part({ type: 'error', error: new Error('maximum context length exceeded') })
  }
}

function maxStepsScript(steps: number): Script {
  return async function* () {
    for (let index = 0; index < steps; index += 1) {
      yield part({ type: 'finish-step' })
    }
    yield part({ type: 'finish', finishReason: 'tool-calls', totalUsage: {} })
  }
}

let directory: string
let sink: Sink
let scripts: Script[]
let turns: AgentTurnInput[]
let summaries: string[]
let instructionFiles: InstructionFile[]
let instructionInputs: Array<{ workspacePath: string; globalDirectory: string }>
let toolExecutor: ((value: string, toolCallId: string) => Promise<string>) | null
let resumeTurn: (() => void) | null
let runtime: AgentRuntime
let sessionId: string

function createRuntime(): AgentRuntime {
  return new AgentRuntime({
    userDataPath: directory,
    workspacePath: path.join(directory, 'workspace'),
    models: MODELS,
    send: sink.send,
    dependencies: {
      createLanguageModel: () => ({}) as unknown as LanguageModel,
      createTools: (context) => {
        toolExecutor = async (value, toolCallId) => {
          const allowed = await context.askPermission('write', value, 'task', toolCallId)
          return allowed ? `done:${value}` : 'Permission denied'
        }
        return {}
      },
      createTurn: (input) => {
        turns.push(input)
        const script = scripts.shift()
        if (!script) throw new Error('No scripted turn')
        return { stream: script(input) }
      },
      generateSummary: async (input) => {
        summaries.push(input.prompt)
        return 'SUMMARY'
      },
      loadInstructions: async (input) => {
        instructionInputs.push(input)
        return instructionFiles
      }
    }
  })
}

function toolScript(values: string[]): Script {
  return async function* (input) {
    for (const [index, value] of values.entries()) {
      const callId = `call-${index + 1}`
      yield part({ type: 'tool-input-start', id: callId, toolName: 'task' })
      yield part({ type: 'tool-call', toolCallId: callId, toolName: 'task', input: { value } })
      if (!toolExecutor) throw new Error('Tool executor not initialized')
      const output = await toolExecutor(value, callId)
      if (input.abortSignal.aborted) {
        yield part({ type: 'abort' })
        return
      }
      yield part({
        type: 'tool-result',
        toolCallId: callId,
        toolName: 'task',
        input: { value },
        output
      })
    }
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'done' })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function stoppableScript(): Script {
  return async function* (input) {
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'partial' })
    await new Promise<void>((resolve) => {
      if (input.abortSignal.aborted) {
        resolve()
        return
      }
      input.abortSignal.addEventListener('abort', () => resolve(), { once: true })
    })
    yield part({ type: 'abort' })
  }
}

function parallelToolScript(values: string[]): Script {
  return async function* () {
    for (const [index, value] of values.entries()) {
      const callId = `call-${index + 1}`
      yield part({ type: 'tool-input-start', id: callId, toolName: 'task' })
      yield part({ type: 'tool-call', toolCallId: callId, toolName: 'task', input: { value } })
    }
    const executions = values.map((value, index) => {
      if (!toolExecutor) throw new Error('Tool executor not initialized')
      return toolExecutor(value, `call-${index + 1}`)
    })
    for (const [index, execution] of executions.entries()) {
      const value = values[index]
      const output = await execution
      yield part({
        type: 'tool-result',
        toolCallId: `call-${index + 1}`,
        toolName: 'task',
        input: { value },
        output
      })
    }
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'done' })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function richStreamScript(): Script {
  return async function* () {
    yield part({ type: 'text-delta', id: 'missing', text: 'ignored' })
    yield part({ type: 'reasoning-delta', id: 'ghost', text: 'ignored' })
    yield part({ type: 'reasoning-start', id: 'r1' })
    yield part({ type: 'reasoning-delta', id: 'r1', text: 'think' })
    yield part({ type: 'reasoning-end', id: 'r1' })
    yield part({ type: 'ping' })
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'answer' })
    yield part({ type: 'text-end', id: 't1' })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function toolEventScript(event: Record<string, unknown>): Script {
  return async function* () {
    yield part({ type: 'tool-input-start', id: 'call-1', toolName: 'task' })
    yield part({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'task',
      input: { value: 'a.txt' }
    })
    yield part(event)
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function unfinishedToolScript(): Script {
  return async function* () {
    yield part({ type: 'tool-input-start', id: 'call-1', toolName: 'task' })
    yield part({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'task',
      input: { value: 'a.txt' }
    })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function doubleDeltaScript(): Script {
  return async function* () {
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'a' })
    yield part({ type: 'text-delta', id: 't1', text: 'b' })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function pausableTextScript(): Script {
  return async function* () {
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'first' })
    await new Promise<void>((resolve) => {
      resumeTurn = resolve
    })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function stoppableToolScript(): Script {
  return async function* (input) {
    yield part({ type: 'tool-input-start', id: 'call-1', toolName: 'task' })
    yield part({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'task',
      input: { value: 'a.txt' }
    })
    await new Promise<void>((resolve) => {
      if (input.abortSignal.aborted) {
        resolve()
        return
      }
      input.abortSignal.addEventListener('abort', () => resolve(), { once: true })
    })
    yield part({ type: 'abort' })
  }
}

function toolCallThenErrorScript(message: string): Script {
  return async function* () {
    yield part({ type: 'tool-input-start', id: 'call-1', toolName: 'task' })
    yield part({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'task',
      input: { value: 'a.txt' }
    })
    yield part({ type: 'error', error: new Error(message) })
  }
}

function orphanToolEventScript(): Script {
  return async function* () {
    yield part({
      type: 'tool-result',
      toolCallId: 'ghost',
      toolName: 'task',
      input: {},
      output: 'x'
    })
    yield part({
      type: 'tool-error',
      toolCallId: 'ghost',
      toolName: 'task',
      input: {},
      error: new Error('x')
    })
    yield part({ type: 'tool-output-denied', toolCallId: 'ghost', toolName: 'task', input: {} })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function assistantMessages(): ChatMessage[] {
  return runtime.messages(sessionId).messages.filter((message) => message.role === 'assistant')
}

function toolPart(callId: string): Extract<ChatMessage['parts'][number], { type: 'tool' }> {
  const found = assistantMessages()[0].parts.find(
    (entry) => entry.type === 'tool' && entry.toolCallId === callId
  )
  if (!found || found.type !== 'tool') throw new Error(`Tool part ${callId} not found`)
  return found
}

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-runtime-')))
  sink = createSink()
  scripts = []
  turns = []
  summaries = []
  instructionFiles = []
  instructionInputs = []
  toolExecutor = null
  resumeTurn = null
  runtime = createRuntime()
  await runtime.init()
  sessionId = (await runtime.createSession()).id
})

afterEach(async () => {
  vi.useRealTimers()
  await runtime.shutdown()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('AgentRuntime', () => {
  it('completes a text run and records usage', async () => {
    scripts.push(textScript('Hello'))

    await runtime.sendChat(sessionId, 'hi')
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'completed' })
    expect(turns[0].messages).toEqual([{ role: 'user', content: 'hi' }])
    const [assistant] = assistantMessages()
    expect(assistant.status).toBe('complete')
    expect(assistant.parts).toEqual([{ type: 'text', text: 'Hello' }])
    expect(assistant.usage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7 })
    expect(assistant.durationMs).toBeGreaterThanOrEqual(0)
    expect(runtime.listSessions()[0].status).toBe('idle')
  })

  it('asks for permission and completes a tool after a once reply', async () => {
    scripts.push(toolScript(['a.txt']))

    await runtime.sendChat(sessionId, 'write')
    const asked = await sink.next('permission.asked')
    if (asked.event.type !== 'permission.asked') throw new Error('unexpected event')
    expect(asked.event.permission).toMatchObject({
      action: 'write',
      resource: 'a.txt',
      toolName: 'task',
      toolCallId: 'call-1'
    })
    expect(runtime.permissions()).toHaveLength(1)

    runtime.replyPermission(asked.event.permission.id, 'once')
    await sink.next('run.finished')

    expect(toolPart('call-1')).toMatchObject({
      state: 'completed',
      output: 'done:a.txt'
    })
  })

  it('does not ask again for the same action after always', async () => {
    scripts.push(toolScript(['a.txt', 'b.txt']))

    await runtime.sendChat(sessionId, 'write')
    const asked = await sink.next('permission.asked')
    if (asked.event.type !== 'permission.asked') throw new Error('unexpected event')
    runtime.replyPermission(asked.event.permission.id, 'always')
    await sink.next('run.finished')

    expect(sink.count('permission.asked')).toBe(1)
    expect(toolPart('call-1')).toMatchObject({ state: 'completed', output: 'done:a.txt' })
    expect(toolPart('call-2')).toMatchObject({ state: 'completed', output: 'done:b.txt' })
  })

  it('marks the tool as denied after a reject reply', async () => {
    scripts.push(toolScript(['a.txt']))

    await runtime.sendChat(sessionId, 'write')
    const asked = await sink.next('permission.asked')
    if (asked.event.type !== 'permission.asked') throw new Error('unexpected event')
    runtime.replyPermission(asked.event.permission.id, 'reject')
    await sink.next('run.finished')

    expect(toolPart('call-1')).toMatchObject({
      state: 'denied',
      error: 'Permission denied by user'
    })
  })

  it('stops a run and keeps partial text', async () => {
    scripts.push(stoppableScript())

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')
    runtime.stopChat(sessionId)
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'interrupted' })
    const [assistant] = assistantMessages()
    expect(assistant.status).toBe('interrupted')
    expect(assistant.error).toBe('Interrupted by user')
    expect(assistant.parts).toEqual([{ type: 'text', text: 'partial' }])
    expect(runtime.listSessions()[0].status).toBe('idle')
  })

  it('records model errors on the message and the session', async () => {
    scripts.push(errorScript('boom'))

    await runtime.sendChat(sessionId, 'hi')
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'failed', error: 'boom' })
    const [assistant] = assistantMessages()
    expect(assistant.status).toBe('error')
    expect(assistant.error).toBe('boom')
    expect(runtime.listSessions()[0].status).toBe('error')
  })

  it('retries without duplicating the user message or the failed assistant', async () => {
    scripts.push(stoppableScript())
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')
    runtime.stopChat(sessionId)
    await sink.next('run.finished')

    scripts.push(textScript('recovered'))
    await runtime.retryChat(sessionId)
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'completed' })
    expect(JSON.stringify(turns[1].messages)).not.toContain('partial')
    const messages = runtime.messages(sessionId).messages
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(assistantMessages()).toHaveLength(2)
    expect(assistantMessages()[1].parts).toEqual([{ type: 'text', text: 'recovered' }])
  })

  it('reports max-steps when the tool step limit is reached', async () => {
    scripts.push(maxStepsScript(25))

    await runtime.sendChat(sessionId, 'hi')
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'max-steps' })
  })

  it('rejects a second send while a run is active', async () => {
    scripts.push(stoppableScript())
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')

    await expect(runtime.sendChat(sessionId, 'again')).rejects.toThrow('SESSION_BUSY')

    runtime.stopChat(sessionId)
    await sink.next('run.finished')
  })

  it('denies a pending permission after the timeout', async () => {
    vi.useFakeTimers()
    scripts.push(toolScript(['a.txt']))

    await runtime.sendChat(sessionId, 'write')
    await sink.next('permission.asked')

    vi.advanceTimersByTime(10 * 60 * 1000)
    await sink.next('run.finished')

    expect(toolPart('call-1')).toMatchObject({ state: 'denied' })
    expect(runtime.permissions()).toEqual([])
  })

  it('rejects pending permissions on shutdown', async () => {
    scripts.push(toolScript(['a.txt']))
    await runtime.sendChat(sessionId, 'write')
    await sink.next('permission.asked')

    await runtime.shutdown()
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'interrupted' })
    expect(runtime.permissions()).toEqual([])
  })

  it('aborts the run when its session is deleted', async () => {
    scripts.push(stoppableScript())
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')

    await runtime.deleteSession(sessionId)
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'interrupted' })
    expect(runtime.listSessions()).toEqual([])
    expect(() => runtime.messages(sessionId)).toThrow('SESSION_NOT_FOUND')
  })

  it('renames sessions and rejects unknown ids', async () => {
    const renamed = await runtime.renameSession(sessionId, 'New title')
    expect(renamed.title).toBe('New title')
    await expect(runtime.renameSession('missing', 'x')).rejects.toThrow('SESSION_NOT_FOUND')
  })

  it('sets and validates a session model', async () => {
    const model = { providerId: 'provider-1', modelId: 'model-1' }

    expect((await runtime.setSessionModel(sessionId, model)).model).toEqual(model)
    await expect(
      runtime.setSessionModel(sessionId, { providerId: 'other', modelId: 'x' })
    ).rejects.toThrow('MODEL_NOT_FOUND')
    await expect(runtime.setSessionModel('missing', model)).rejects.toThrow('SESSION_NOT_FOUND')
    expect((await runtime.setSessionModel(sessionId, null)).model).toBeNull()
  })

  it('sets and validates session settings', async () => {
    const settings = { reasoningEffort: 'high' as const, permissionMode: 'acceptEdits' as const }

    expect(await runtime.setSessionSettings(sessionId, settings)).toMatchObject(settings)
    await expect(runtime.setSessionSettings('missing', settings)).rejects.toThrow(
      'SESSION_NOT_FOUND'
    )
    await expect(
      runtime.setSessionSettings(sessionId, {
        reasoningEffort: 'ultra' as never,
        permissionMode: 'ask'
      })
    ).rejects.toThrow('INVALID_REASONING_EFFORT')
    await expect(
      runtime.setSessionSettings(sessionId, {
        reasoningEffort: null,
        permissionMode: 'bypass' as never
      })
    ).rejects.toThrow('INVALID_PERMISSION_MODE')
  })

  it('passes the session reasoning effort to the turn', async () => {
    scripts.push(textScript('ok'))
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: 'medium',
      permissionMode: 'ask'
    })

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(turns[0].reasoning).toBe('medium')
  })

  it('auto permission mode allows tools without asking', async () => {
    scripts.push(toolScript(['x']))
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: null,
      permissionMode: 'auto'
    })

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(sink.count('permission.asked')).toBe(0)
    expect(toolPart('call-1').output).toBe('done:x')
  })

  it('acceptEdits permission mode allows write tools without asking', async () => {
    scripts.push(toolScript(['x']))
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: null,
      permissionMode: 'acceptEdits'
    })

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(sink.count('permission.asked')).toBe(0)
    expect(toolPart('call-1').output).toBe('done:x')
  })

  it('plan permission mode denies tools without asking', async () => {
    scripts.push(toolScript(['x']))
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: null,
      permissionMode: 'plan'
    })

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(sink.count('permission.asked')).toBe(0)
    expect(turns[0].system).toContain('read-only plan mode')
    expect(toolPart('call-1').output).toBe('Permission denied')
  })

  it('clears session models that disappear from the config', async () => {
    await runtime.setSessionModel(sessionId, { providerId: 'provider-1', modelId: 'model-1' })
    const untouched = (await runtime.createSession()).id

    runtime.setModels({ ...MODELS, models: [] })

    const sessions = runtime.listSessions()
    expect(sessions.find((session) => session.id === sessionId)?.model).toBeNull()
    expect(sessions.find((session) => session.id === untouched)?.model).toBeNull()
  })

  it('validates chat sends', async () => {
    await expect(runtime.sendChat(sessionId, '   ')).rejects.toThrow('EMPTY_MESSAGE')
    await expect(runtime.sendChat('missing', 'hi')).rejects.toThrow('SESSION_NOT_FOUND')
    await expect(
      runtime.sendChat(sessionId, 'hi', { providerId: 'other', modelId: 'x' })
    ).rejects.toThrow('MODEL_NOT_FOUND')
  })

  it('persists a requested model on the session', async () => {
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi', { providerId: 'provider-1', modelId: 'model-1' })
    await sink.next('run.finished')

    expect(runtime.listSessions()[0].model).toEqual({
      providerId: 'provider-1',
      modelId: 'model-1'
    })
  })

  it('ignores stop for sessions without a run', () => {
    expect(() => runtime.stopChat('missing')).not.toThrow()
  })

  it('rejects replies for unknown permissions', () => {
    expect(() => runtime.replyPermission('missing', 'once')).toThrow('PERMISSION_NOT_FOUND')
  })

  it('validates retries', async () => {
    await expect(runtime.retryChat('missing')).rejects.toThrow('SESSION_NOT_FOUND')

    scripts.push(textScript('done'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    await expect(runtime.retryChat(sessionId)).rejects.toThrow('NOTHING_TO_RETRY')
  })

  it('rejects retry while a run is active', async () => {
    scripts.push(stoppableScript())
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')

    await expect(runtime.retryChat(sessionId)).rejects.toThrow('SESSION_BUSY')

    runtime.stopChat(sessionId)
    await sink.next('run.finished')
  })

  it('rejects retry when the transcript has no user message', async () => {
    const seed = new SessionsStore(directory)
    await seed.init()
    const seeded = await seed.create()
    await seed.appendMessage(
      seeded.id,
      makeMessage({ role: 'assistant', status: 'error', error: 'boom' })
    )
    const other = createRuntime()
    await other.init()

    await expect(other.retryChat(seeded.id)).rejects.toThrow('NOTHING_TO_RETRY')
    await other.shutdown()
  })

  it('resolves sibling permissions when replying always', async () => {
    scripts.push(parallelToolScript(['a.txt', 'b.txt']))

    await runtime.sendChat(sessionId, 'write')
    const first = await sink.next('permission.asked')
    const second = await sink.next('permission.asked')
    if (first.event.type !== 'permission.asked' || second.event.type !== 'permission.asked') {
      throw new Error('unexpected event')
    }

    runtime.replyPermission(first.event.permission.id, 'always')
    await sink.next('run.finished')

    expect(runtime.permissions()).toEqual([])
    expect(toolPart('call-1')).toMatchObject({ state: 'completed', output: 'done:a.txt' })
    expect(toolPart('call-2')).toMatchObject({ state: 'completed', output: 'done:b.txt' })
  })

  it('leaves permissions of other runs pending when one is stopped', async () => {
    const otherSession = (await runtime.createSession()).id
    scripts.push(toolScript(['a.txt']))
    scripts.push(toolScript(['b.txt']))

    await runtime.sendChat(sessionId, 'write')
    const first = await sink.next('permission.asked')
    if (first.event.type !== 'permission.asked') throw new Error('unexpected event')
    await runtime.sendChat(otherSession, 'write')
    const second = await sink.next('permission.asked')
    if (second.event.type !== 'permission.asked') throw new Error('unexpected event')

    runtime.stopChat(sessionId)
    const stopped = await sink.next('run.finished')
    expect(stopped.event).toMatchObject({ status: 'interrupted' })
    expect(runtime.permissions().map((permission) => permission.id)).toEqual([
      second.event.permission.id
    ])

    runtime.replyPermission(second.event.permission.id, 'reject')
    await sink.next('run.finished')
  })

  it('records reasoning and skips unknown deltas and parts', async () => {
    scripts.push(richStreamScript())

    await runtime.sendChat(sessionId, 'hi')
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'completed' })
    expect(assistantMessages()[0].parts).toEqual([
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'answer' }
    ])
  })

  it('serializes non-string tool output', async () => {
    scripts.push(
      toolEventScript({
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'task',
        input: { value: 'a.txt' },
        output: { ok: true }
      })
    )

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(toolPart('call-1')).toMatchObject({ state: 'completed', output: '{"ok":true}' })
  })

  it('marks tool errors with normalized messages', async () => {
    scripts.push(
      toolEventScript({
        type: 'tool-error',
        toolCallId: 'call-1',
        toolName: 'task',
        input: { value: 'a.txt' },
        error: new Error('401 Unauthorized')
      })
    )

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(toolPart('call-1')).toMatchObject({
      state: 'failed',
      error: 'Model authentication failed. Check the provider API key.'
    })
  })

  it('marks denied tool outputs', async () => {
    scripts.push(
      toolEventScript({
        type: 'tool-output-denied',
        toolCallId: 'call-1',
        toolName: 'task',
        input: { value: 'a.txt' }
      })
    )

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(toolPart('call-1')).toMatchObject({
      state: 'denied',
      error: 'Permission denied by user'
    })
  })

  it('settles unfinished tools when the run completes', async () => {
    scripts.push(unfinishedToolScript())

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(toolPart('call-1')).toMatchObject({
      state: 'failed',
      error: 'Tool call did not finish'
    })
  })

  it('appends multiple text deltas', async () => {
    scripts.push(doubleDeltaScript())

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(assistantMessages()[0].parts).toEqual([{ type: 'text', text: 'ab' }])
  })

  it('persists while streaming', async () => {
    vi.useFakeTimers()
    scripts.push(pausableTextScript())

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')
    for (let index = 0; index < 50 && !resumeTurn; index += 1) {
      await Promise.resolve()
    }
    expect(resumeTurn).not.toBeNull()

    vi.advanceTimersByTime(1_000)
    if (resumeTurn) resumeTurn()
    resumeTurn = null

    const finished = await sink.next('run.finished')
    expect(finished.event).toMatchObject({ status: 'completed' })
  })

  it('settles running tools as interrupted on stop', async () => {
    scripts.push(stoppableToolScript())
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')

    runtime.stopChat(sessionId)
    await sink.next('run.finished')

    expect(toolPart('call-1')).toMatchObject({
      state: 'failed',
      error: 'Interrupted by user'
    })
  })

  it('settles running tools as failed on errors', async () => {
    scripts.push(toolCallThenErrorScript('boom'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(toolPart('call-1')).toMatchObject({
      state: 'failed',
      error: 'Tool call failed'
    })
  })

  it('ignores tool events for unknown call ids', async () => {
    scripts.push(orphanToolEventScript())

    await runtime.sendChat(sessionId, 'hi')
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'completed' })
    expect(assistantMessages()[0].parts).toEqual([])
  })

  it('deletes idle sessions', async () => {
    const idle = (await runtime.createSession()).id

    await runtime.deleteSession(idle)

    expect(runtime.listSessions().map((session) => session.id)).not.toContain(idle)
  })

  it('rejects pending permissions when a run is stopped', async () => {
    scripts.push(toolScript(['a.txt']))
    await runtime.sendChat(sessionId, 'write')
    await sink.next('permission.asked')

    runtime.stopChat(sessionId)
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'interrupted' })
    expect(runtime.permissions()).toEqual([])
    expect(toolPart('call-1')).toMatchObject({ state: 'denied' })
  })

  it('rejects pending permissions on shutdown across runs', async () => {
    const other = (await runtime.createSession()).id
    scripts.push(toolScript(['a.txt']))
    scripts.push(toolScript(['b.txt']))
    await runtime.sendChat(sessionId, 'write')
    await sink.next('permission.asked')
    await runtime.sendChat(other, 'write')
    await sink.next('permission.asked')

    await runtime.shutdown()
    await sink.next('run.finished')
    await sink.next('run.finished')

    expect(runtime.permissions()).toEqual([])
  })

  it('compacts an oversized history before sending the next turn', async () => {
    runtime.setModels({
      ...MODELS,
      models: [{ ...MODELS.models[0], contextWindow: 20_000 }]
    })
    scripts.push(textScript('first'))
    await runtime.sendChat(sessionId, 'a'.repeat(20_000))
    await sink.next('run.finished')

    scripts.push(textScript('second'))
    await runtime.sendChat(sessionId, 'b'.repeat(20_000))
    await sink.next('run.finished')

    expect(summaries).toHaveLength(1)
    expect(turns[1].system).toContain('SUMMARY')
    expect(turns[1].messages).toHaveLength(1)
    expect(turns[1].messages[0]).toMatchObject({ role: 'user', content: 'b'.repeat(20_000) })
    expect(runtime.listSessions()[0].compaction).toMatchObject({ summary: 'SUMMARY' })
  })

  it('leaves a history under the limit untouched', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'short')
    await sink.next('run.finished')

    expect(summaries).toEqual([])
    expect(turns[0].messages).toEqual([{ role: 'user', content: 'short' }])
  })

  it('injects discovered instruction files into the system prompt', async () => {
    instructionFiles = [
      { path: '/repo/AGENTS.md', content: 'Run bun test before committing' },
      { path: '/repo/packages/web/CLAUDE.md', content: 'Keep components small' }
    ]
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(turns[0].system).toContain('Project instructions')
    expect(turns[0].system).toContain('Run bun test before committing')
    expect(turns[0].system).toContain('Keep components small')
    expect(instructionInputs[0]).toEqual({
      workspacePath: path.join(directory, 'workspace'),
      globalDirectory: directory
    })
  })

  it('keeps the base system prompt without instruction files', async () => {
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(turns[0].system).not.toContain('Project instructions')
  })

  it('compacts a session on demand without deleting stored messages', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'a'.repeat(70_000))
    await sink.next('run.finished')
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'b'.repeat(70_000))
    await sink.next('run.finished')
    const before = runtime.messages(sessionId).messages.length

    const session = await runtime.compactSession(sessionId)

    expect(session.compaction).toMatchObject({ summary: 'SUMMARY' })
    expect(summaries).toHaveLength(1)
    expect(runtime.messages(sessionId).messages).toHaveLength(before)
  })

  it('does not compact a short session', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    const session = await runtime.compactSession(sessionId)

    expect(session.compaction).toBeNull()
    expect(summaries).toEqual([])
  })

  it('rejects manual compaction for unknown or running sessions', async () => {
    await expect(runtime.compactSession('missing')).rejects.toThrow('SESSION_NOT_FOUND')

    scripts.push(stoppableScript())
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')

    await expect(runtime.compactSession(sessionId)).rejects.toThrow('SESSION_BUSY')

    runtime.stopChat(sessionId)
    await sink.next('run.finished')
  })

  it('compacts and retries once when the provider reports context overflow', async () => {
    scripts.push(textScript('first'))
    await runtime.sendChat(sessionId, 'a'.repeat(40_000))
    await sink.next('run.finished')

    scripts.push(contextErrorScript())
    scripts.push(textScript('recovered'))
    await runtime.sendChat(sessionId, 'b'.repeat(40_000))
    const finished = await sink.next('run.finished')

    expect(finished.event).toMatchObject({ status: 'completed' })
    expect(summaries).toHaveLength(1)
    expect(turns).toHaveLength(3)
    expect(turns[2].system).toContain('SUMMARY')
    expect(turns[2].messages).toHaveLength(1)
    expect(assistantMessages().at(-1)?.status).toBe('complete')
    expect(assistantMessages().at(-1)?.parts).toEqual([{ type: 'text', text: 'recovered' }])
  })
})
