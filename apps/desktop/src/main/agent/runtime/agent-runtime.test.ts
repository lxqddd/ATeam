import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { LanguageModel, TextStreamPart, ToolSet } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type {
  AgentEvent,
  AgentEventEnvelope,
  ChatMessage,
  ModelRef,
  PermissionAction,
  PermissionRule,
  RuntimeModelsConfig
} from '@ateam/shared'
import { AgentRuntime, type AgentTurnInput } from './index'
import { attachmentDirectory, saveAttachment } from '../attachments'
import type { InstructionFile } from '../config/instructions'
import type { McpManagerLike } from '../integrations/mcp'
import { PermissionsStore } from '../config/permissions-store'
import { SessionsStore } from '../sessions/sessions-store'
import { makeMessage } from '../test/factories'
import type { ToolContext } from '../tools'
import type { WebFetchResult } from '../integrations/webfetch'
import type { WebSearchResult } from '../integrations/websearch'
import type { AgentRuntimeOptions } from './types'

const runGit = promisify(execFile)

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

function measuredTextScript(text: string, inputTokens: number): Script {
  return async function* () {
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text })
    yield part({ type: 'text-end', id: 't1' })
    yield part({
      type: 'finish',
      finishReason: 'stop',
      totalUsage: { inputTokens, outputTokens: 10, totalTokens: inputTokens + 10 }
    })
  }
}

function mutatingScript(changes: Record<string, string>): Script {
  return async function* () {
    for (const [relative, content] of Object.entries(changes)) {
      await fs.writeFile(path.join(directory, 'workspace', relative), content)
    }
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'done' })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function twoStepMutatingScript(): Script {
  return async function* () {
    await fs.writeFile(path.join(directory, 'workspace', 'step-one.txt'), 'one')
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'step one' })
    yield part({ type: 'finish-step' })
    await fs.writeFile(path.join(directory, 'workspace', 'step-two.txt'), 'two')
    yield part({ type: 'text-delta', id: 't1', text: 'step two' })
    yield part({ type: 'finish-step' })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
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
let toolAction: PermissionAction
let toolExecutor: ((value: string, toolCallId: string) => Promise<string>) | null
let toolContext: ToolContext | null
let questionExecutor:
  ((input: import('@ateam/shared').QuestionInput, toolCallId: string) => Promise<string>) | null
let subagentExecutor:
  | ((
      input: { prompt: string; agent?: string; sessionId?: string; background?: boolean },
      toolCallId: string
    ) => Promise<string>)
  | null
let baseTools: ToolSet
let languageModelRefs: Array<ModelRef | null>
let mcpManager: McpManagerLike
let mcpManagerInput: {
  workspacePath: string
  mcpAuth?: import('@ateam/shared').McpAuthRecord[]
} | null
let mcpTools: ReturnType<typeof vi.fn>
let mcpDispose: ReturnType<typeof vi.fn>
let resumeTurn: (() => void) | null
const generateTitle = vi.fn(async () => '')
let browserRequest: Mock<NonNullable<AgentRuntimeOptions['browserRequest']>>
let runtime: AgentRuntime
let sessionId: string

function createRuntime(): AgentRuntime {
  return new AgentRuntime({
    userDataPath: directory,
    workspacePath: path.join(directory, 'workspace'),
    models: MODELS,
    send: sink.send,
    browserRequest,
    dependencies: {
      createLanguageModel: (_models, ref) => {
        languageModelRefs.push(ref)
        return {} as unknown as LanguageModel
      },
      createTools: (context) => {
        toolContext = context
        subagentExecutor = context.runSubagent ?? null
        questionExecutor = context.askQuestion ?? null
        toolExecutor = async (value, toolCallId) => {
          const allowed = await context.askPermission(toolAction, value, 'task', toolCallId)
          return allowed ? `done:${value}` : 'Permission denied'
        }
        return baseTools
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
      },
      createMcpManager: (input) => {
        mcpManagerInput = input
        return mcpManager
      },
      generateTitle,
      fetchWeb: async (input): Promise<WebFetchResult> => ({
        url: input.url,
        status: 200,
        contentType: 'text/plain',
        format: 'text',
        content: `page:${input.url}`
      }),
      searchWeb: async (config, input): Promise<WebSearchResult[]> => [
        {
          title: 'Hit',
          url: 'https://hit.example',
          snippet: `${config.provider}:${input.query}`
        }
      ]
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

async function restartWithRules(
  rules: Array<{
    action: PermissionRule['action']
    resource: string
    effect: PermissionRule['effect']
    sessionId: string | null
  }>
): Promise<void> {
  await runtime.shutdown()
  const permissions = new PermissionsStore(directory)
  await permissions.init()
  for (const rule of rules) await permissions.add(rule)
  runtime = createRuntime()
  await runtime.init()
}

async function restartRuntime(): Promise<void> {
  await runtime.shutdown()
  runtime = createRuntime()
  await runtime.init()
  sessionId = (await runtime.createSession()).id
}

async function writeAgentConfig(config: {
  snapshots?: boolean
  instructions?: string[]
  lsp?: boolean
  formatters?: boolean
  references?: import('@ateam/shared').AgentReference[]
}): Promise<void> {
  const directoryPath = path.join(directory, 'agent')
  await fs.mkdir(directoryPath, { recursive: true })
  await fs.writeFile(
    path.join(directoryPath, 'config.json'),
    JSON.stringify({ snapshots: true, instructions: [], ...config })
  )
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

function mixedParallelToolScript(): Script {
  return async function* () {
    yield part({ type: 'tool-input-start', id: 'call-1', toolName: 'task' })
    yield part({ type: 'tool-call', toolCallId: 'call-1', toolName: 'task', input: { value: 'a' } })
    yield part({ type: 'tool-input-start', id: 'call-2', toolName: 'task' })
    yield part({ type: 'tool-call', toolCallId: 'call-2', toolName: 'task', input: { value: 'b' } })
    if (!toolExecutor) throw new Error('Tool executor not initialized')
    const [first] = await Promise.allSettled([
      toolExecutor('a', 'call-1'),
      Promise.reject(new Error('boom'))
    ])
    yield part({
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'task',
      input: { value: 'a' },
      output: first.status === 'fulfilled' ? first.value : 'failed'
    })
    yield part({
      type: 'tool-error',
      toolCallId: 'call-2',
      toolName: 'task',
      input: { value: 'b' },
      error: new Error('boom')
    })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function imageResultScript(): Script {
  return async function* () {
    const input = { path: 'a.png' }
    const output = {
      summary: 'Image: a.png (2 bytes)',
      image: { mimeType: 'image/png', data: 'AQID' }
    }
    yield part({ type: 'tool-input-start', id: 'call-img', toolName: 'read' })
    yield part({ type: 'tool-call', toolCallId: 'call-img', toolName: 'read', input })
    yield part({ type: 'tool-result', toolCallId: 'call-img', toolName: 'read', input, output })
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'seen' })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function multiStepUsageScript(): Script {
  return async function* () {
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'step one' })
    yield part({
      type: 'finish-step',
      usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 }
    })
    yield part({ type: 'text-delta', id: 't1', text: ' step two' })
    yield part({ type: 'finish-step' })
    yield part({
      type: 'finish',
      finishReason: 'stop',
      totalUsage: { inputTokens: 60, outputTokens: 15, totalTokens: 75 }
    })
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
  browserRequest = vi.fn(async (_sessionId: string, method: string) =>
    method === 'screenshot'
      ? { summary: 'Screenshot: Example', image: { mimeType: 'image/png', data: 'AQID' } }
      : `${method}:ok`
  )
  toolAction = 'write'
  toolExecutor = null
  toolContext = null
  subagentExecutor = null
  questionExecutor = null
  baseTools = {}
  languageModelRefs = []
  mcpTools = vi.fn(async () => ({}))
  mcpDispose = vi.fn(async () => undefined)
  mcpManagerInput = null
  mcpManager = {
    tools: mcpTools as unknown as McpManagerLike['tools'],
    dispose: mcpDispose as unknown as McpManagerLike['dispose'],
    servers: vi.fn(async () => []),
    statuses: vi.fn(async () => []),
    prompts: vi.fn(async () => []),
    resources: vi.fn(async () => []),
    getPrompt: vi.fn(async () => ''),
    readResource: vi.fn(async () => ''),
    addServer: vi.fn(),
    updateServer: vi.fn(),
    removeServer: vi.fn(),
    setMcpAuth: vi.fn(async () => undefined),
    setTransientServers: vi.fn(async () => undefined)
  }
  resumeTurn = null
  generateTitle.mockReset()
  generateTitle.mockResolvedValue('')
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

  it('persists always decisions and skips prompts after restart', async () => {
    scripts.push(toolScript(['src/a.txt']))
    await runtime.sendChat(sessionId, 'write')
    const asked = await sink.next('permission.asked')
    if (asked.event.type !== 'permission.asked') throw new Error('unexpected event')
    runtime.replyPermission(asked.event.permission.id, 'always')
    await sink.next('run.finished')

    expect(runtime.listPermissionRules(sessionId)).toEqual([
      expect.objectContaining({
        action: 'write',
        resource: 'src/*',
        effect: 'allow',
        sessionId
      })
    ])

    await runtime.shutdown()
    runtime = createRuntime()
    await runtime.init()
    const before = sink.count('permission.asked')
    scripts.push(toolScript(['src/b.txt']))
    await runtime.sendChat(sessionId, 'write again')
    await sink.next('run.finished')

    expect(sink.count('permission.asked')).toBe(before)
    const lastAssistant = assistantMessages().at(-1)
    expect(
      lastAssistant?.parts.find((entry) => entry.type === 'tool' && entry.toolCallId === 'call-1')
    ).toMatchObject({ state: 'completed', output: 'done:src/b.txt' })
  })

  it('removes a persisted rule so the action asks again', async () => {
    scripts.push(toolScript(['src/a.txt']))
    await runtime.sendChat(sessionId, 'write')
    const asked = await sink.next('permission.asked')
    if (asked.event.type !== 'permission.asked') throw new Error('unexpected event')
    runtime.replyPermission(asked.event.permission.id, 'always')
    await sink.next('run.finished')

    const [rule] = runtime.listPermissionRules(sessionId)
    expect(await runtime.removePermissionRule(rule.id)).toBe(true)

    const before = sink.count('permission.asked')
    scripts.push(toolScript(['src/b.txt']))
    await runtime.sendChat(sessionId, 'again')
    const next = await sink.next('permission.asked')
    expect(sink.count('permission.asked')).toBe(before + 1)
    if (next.event.type !== 'permission.asked') throw new Error('unexpected event')
    runtime.replyPermission(next.event.permission.id, 'reject')
    await sink.next('run.finished')
  })

  it('adds a global permission rule', async () => {
    const rule = await runtime.addPermissionRule({
      action: 'shell',
      resource: 'rm *',
      effect: 'deny',
      sessionId: null
    })

    expect(rule).toMatchObject({
      action: 'shell',
      resource: 'rm *',
      effect: 'deny',
      sessionId: null
    })
    expect(runtime.listPermissionRules()).toEqual([rule])
  })

  it('denies tools matched by a deny rule even in auto mode', async () => {
    await restartWithRules([
      { action: 'write', resource: 'src/*', effect: 'deny', sessionId: null }
    ])
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: null,
      permissionMode: 'auto'
    })
    scripts.push(toolScript(['src/a.txt']))

    await runtime.sendChat(sessionId, 'write')
    await sink.next('run.finished')

    expect(sink.count('permission.asked')).toBe(0)
    expect(toolPart('call-1').output).toBe('Permission denied')
  })

  it('asks for tools matched by an ask rule even in auto mode', async () => {
    await restartWithRules([{ action: 'write', resource: 'src/*', effect: 'ask', sessionId: null }])
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: null,
      permissionMode: 'auto'
    })
    scripts.push(toolScript(['src/a.txt']))

    await runtime.sendChat(sessionId, 'write')
    const asked = await sink.next('permission.asked')
    if (asked.event.type !== 'permission.asked') throw new Error('unexpected event')
    runtime.replyPermission(asked.event.permission.id, 'reject')
    await sink.next('run.finished')
  })

  it('allows shell commands that touch external paths in auto mode by default', async () => {
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: null,
      permissionMode: 'auto'
    })
    toolAction = 'shell'
    scripts.push(toolScript(['cat /etc/hosts']))

    await runtime.sendChat(sessionId, 'shell')
    await sink.next('run.finished')

    expect(sink.count('permission.asked')).toBe(0)
    expect(toolPart('call-1').output).toBe('done:cat /etc/hosts')
  })

  it('asks when an external_directory rule asks', async () => {
    await restartWithRules([
      { action: 'external_directory', resource: '/etc/*', effect: 'ask', sessionId: null }
    ])
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: null,
      permissionMode: 'auto'
    })
    toolAction = 'shell'
    scripts.push(toolScript(['cat /etc/hosts']))

    await runtime.sendChat(sessionId, 'shell')
    const asked = await sink.next('permission.asked')
    if (asked.event.type !== 'permission.asked') throw new Error('unexpected event')
    runtime.replyPermission(asked.event.permission.id, 'reject')
    await sink.next('run.finished')
  })

  it('allows risky shell commands in auto mode unless a rule denies them', async () => {
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: null,
      permissionMode: 'auto'
    })
    toolAction = 'shell'
    scripts.push(toolScript(['rm -rf /']))

    await runtime.sendChat(sessionId, 'shell')
    await sink.next('run.finished')

    expect(sink.count('permission.asked')).toBe(0)
    expect(toolPart('call-1').output).toBe('done:rm -rf /')
  })

  it('denies risky shell commands matched by a deny rule', async () => {
    await restartWithRules([{ action: 'shell', resource: 'rm *', effect: 'deny', sessionId: null }])
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: null,
      permissionMode: 'auto'
    })
    toolAction = 'shell'
    scripts.push(toolScript(['rm -rf /']))

    await runtime.sendChat(sessionId, 'shell')
    await sink.next('run.finished')

    expect(sink.count('permission.asked')).toBe(0)
    expect(toolPart('call-1').output).toBe('Permission denied')
  })

  it('lets a later allow rule override an earlier deny', async () => {
    await restartWithRules([
      { action: 'write', resource: '*', effect: 'deny', sessionId: null },
      { action: 'write', resource: 'src/*', effect: 'allow', sessionId: null }
    ])
    await runtime.setSessionSettings(sessionId, {
      reasoningEffort: null,
      permissionMode: 'ask'
    })
    scripts.push(toolScript(['src/a.txt']))

    await runtime.sendChat(sessionId, 'write')
    await sink.next('run.finished')

    expect(sink.count('permission.asked')).toBe(0)
    expect(toolPart('call-1').output).toBe('done:src/a.txt')
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

  it('rejects concurrent sends before the first run starts', async () => {
    scripts.push(textScript('one'))

    const first = runtime.sendChat(sessionId, 'first')
    const second = runtime.sendChat(sessionId, 'second')

    await expect(second).rejects.toThrow('SESSION_BUSY')
    await first
    await sink.next('run.finished')
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

  it('routes browser tool calls through the injected browser bridge', async () => {
    scripts.push(textScript('one'))
    await runtime.sendChat(sessionId, 'browse')
    await sink.next('run.finished')
    if (!toolContext) throw new Error('tool context not initialized')

    await expect(toolContext.browserOpen?.('https://example.com/')).resolves.toBe('open:ok')
    expect(browserRequest).toHaveBeenCalledWith(sessionId, 'open', { url: 'https://example.com/' })
    await expect(toolContext.browserClick?.('2')).resolves.toBe('click:ok')
    await expect(toolContext.browserType?.('3', 'hello', true)).resolves.toBe('type:ok')
    await expect(toolContext.browserEval?.('document.title')).resolves.toBe('eval:ok')
    await expect(toolContext.browserScreenshot?.()).resolves.toMatchObject({
      summary: 'Screenshot: Example',
      image: { mimeType: 'image/png' }
    })

    browserRequest.mockRejectedValueOnce(new Error('BROWSER_TIMEOUT'))
    await expect(toolContext.browserSnapshot?.()).resolves.toBe('Error: BROWSER_TIMEOUT')
  })

  it('pins new sessions to the runtime workspace', async () => {
    const session = await runtime.createSession()
    expect(session.directory).toBe(path.join(directory, 'workspace'))
  })

  it('creates sessions in an explicitly selected directory', async () => {
    const project = path.join(directory, 'project-one')
    await fs.mkdir(project, { recursive: true })
    const session = await runtime.createSession(project)
    expect(session.directory).toBe(await fs.realpath(project))

    await expect(runtime.createSession('relative/path')).rejects.toThrow(
      'INVALID_SESSION_DIRECTORY'
    )
    await expect(runtime.createSession(path.join(directory, 'missing'))).rejects.toThrow(
      'INVALID_SESSION_DIRECTORY'
    )
  })

  it('switches an idle session to another directory', async () => {
    const project = path.join(directory, 'project-two')
    await fs.mkdir(project, { recursive: true })
    const session = await runtime.createSession()

    const updated = await runtime.setSessionDirectory(session.id, project)
    expect(updated.directory).toBe(await fs.realpath(project))
    expect(runtime.listSessions().find((entry) => entry.id === session.id)?.directory).toBe(
      await fs.realpath(project)
    )

    const reset = await runtime.setSessionDirectory(session.id, null)
    expect(reset.directory).toBe(path.join(directory, 'workspace'))

    await expect(runtime.setSessionDirectory(session.id, 'relative/path')).rejects.toThrow(
      'INVALID_SESSION_DIRECTORY'
    )
    await expect(
      runtime.setSessionDirectory(session.id, path.join(directory, 'missing'))
    ).rejects.toThrow('INVALID_SESSION_DIRECTORY')
    await expect(runtime.setSessionDirectory('missing', project)).rejects.toThrow(
      'SESSION_NOT_FOUND'
    )
  })

  it('refuses to switch directories while a run is active', async () => {
    scripts.push(stoppableScript())
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')

    await expect(
      runtime.setSessionDirectory(sessionId, path.join(directory, 'workspace'))
    ).rejects.toThrow('SESSION_BUSY')

    runtime.stopChat(sessionId)
    await sink.next('run.finished')
  })

  it('refuses to remove a worktree used by a session', async () => {
    const workspace = path.join(directory, 'workspace')
    await runGit('git', ['init', '-b', 'main'], { cwd: workspace })
    await runGit('git', ['config', 'user.email', 'test@example.com'], { cwd: workspace })
    await runGit('git', ['config', 'user.name', 'Test'], { cwd: workspace })
    await fs.writeFile(path.join(workspace, 'README.md'), 'hello')
    await runGit('git', ['add', '.'], { cwd: workspace })
    await runGit('git', ['commit', '-m', 'init'], { cwd: workspace })

    scripts.push(textScript('one'))
    await runtime.sendChat(sessionId, 'hello')
    await sink.next('run.finished')
    if (!toolContext) throw new Error('tool context not initialized')
    const created = await toolContext.worktreeCreate?.({ name: 'feature' })
    const worktree = /at (.+)\.\n/.exec(created ?? '')?.[1]
    expect(worktree).toBeTruthy()

    await toolContext.moveSession?.(worktree as string)
    scripts.push(textScript('two'))
    await runtime.sendChat(sessionId, 'again')
    await sink.next('run.finished')
    if (!toolContext) throw new Error('tool context not initialized')

    await expect(toolContext.worktreeRemove?.(worktree as string, true)).resolves.toContain(
      'in use by a session'
    )
  })

  it('moves a session to another directory at the next run boundary', async () => {
    const workspace = path.join(directory, 'workspace')
    const target = path.join(workspace, 'feature')
    await fs.mkdir(target, { recursive: true })

    scripts.push(textScript('one'))
    await runtime.sendChat(sessionId, 'hello')
    await sink.next('run.finished')
    if (!toolContext) throw new Error('tool context not initialized')
    expect(toolContext.workspace).toBe(workspace)

    await expect(toolContext.moveSession?.(target)).resolves.toContain('next message')
    const moved = runtime.listSessions().find((session) => session.id === sessionId)
    expect(moved?.directory).toBe(await fs.realpath(target))

    scripts.push(textScript('two'))
    await runtime.sendChat(sessionId, 'again')
    await sink.next('run.finished')
    if (!toolContext) throw new Error('tool context not initialized')
    expect(toolContext.workspace).toBe(await fs.realpath(target))
  })

  it('rejects session moves outside the workspace and its worktrees', async () => {
    const outside = path.join(directory, 'outside')
    await fs.mkdir(outside, { recursive: true })

    scripts.push(textScript('one'))
    await runtime.sendChat(sessionId, 'hello')
    await sink.next('run.finished')
    if (!toolContext) throw new Error('tool context not initialized')

    await expect(toolContext.moveSession?.(outside)).resolves.toContain(
      'Sessions can only move inside their workspace'
    )
    await expect(toolContext.moveSession?.('relative/path')).resolves.toContain(
      'The target directory does not exist'
    )
  })

  it('aggregates mixed outcomes from parallel tool calls', async () => {
    scripts.push(mixedParallelToolScript())

    await runtime.sendChat(sessionId, 'write')
    const asked = await sink.next('permission.asked')
    if (asked.event.type !== 'permission.asked') throw new Error('unexpected event')
    runtime.replyPermission(asked.event.permission.id, 'once')
    await sink.next('run.finished')

    expect(toolPart('call-1')).toMatchObject({ state: 'completed', output: 'done:a' })
    expect(toolPart('call-2')).toMatchObject({ state: 'failed', error: 'boom' })
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

  it('defers to provider-native compaction for capable models', async () => {
    runtime.setModels({
      ...MODELS,
      models: [{ ...MODELS.models[0], contextWindow: 20_000, compaction: true }]
    })
    scripts.push(textScript('first'))
    await runtime.sendChat(sessionId, 'a'.repeat(20_000))
    await sink.next('run.finished')

    scripts.push(textScript('second'))
    await runtime.sendChat(sessionId, 'b'.repeat(20_000))
    await sink.next('run.finished')

    expect(summaries).toEqual([])
    expect(turns[0].providerOptions).toMatchObject({
      anthropic: {
        contextManagement: {
          edits: [{ type: 'compact_20260112', trigger: { type: 'input_tokens' } }]
        }
      }
    })
  })

  it('uses the last step usage for the context size', async () => {
    scripts.push(multiStepUsageScript())
    await runtime.sendChat(sessionId, 'steps')
    await sink.next('run.finished')

    expect(assistantMessages().at(-1)?.usage).toMatchObject({ inputTokens: 60, outputTokens: 15 })
    expect(runtime.listSessions()[0].contextTokens).toBe(25)
  })

  it('reports provider usage as the context size', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(runtime.listSessions()[0].contextTokens).toBe(7)
  })

  it('leaves a history under the limit untouched', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'short')
    await sink.next('run.finished')

    expect(summaries).toEqual([])
    expect(turns[0].messages).toEqual([{ role: 'user', content: 'short' }])
    const session = runtime.listSessions()[0]
    expect(session.contextTokens).toBeGreaterThan(0)
    expect(session.contextWindow).toBe(128_000)
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

  it('injects configured instruction files', async () => {
    await fs.mkdir(path.join(directory, 'workspace', 'custom'), { recursive: true })
    await fs.writeFile(path.join(directory, 'workspace', 'custom', 'AGENTS.md'), 'custom rule')
    await writeAgentConfig({ instructions: ['custom/AGENTS.md'] })
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(turns[0].system).toContain('custom rule')
  })

  it('can disable workspace snapshots through the agent config', async () => {
    await writeAgentConfig({ snapshots: false })
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    const assistant = assistantMessages().at(-1)
    expect(assistant?.snapshotBefore).toBeUndefined()
    expect(assistant?.snapshotAfter).toBeUndefined()
  })

  it('compacts a session on demand without deleting stored messages', async () => {
    scripts.push(measuredTextScript('ok', 20_000))
    await runtime.sendChat(sessionId, 'a'.repeat(70_000))
    await sink.next('run.finished')
    scripts.push(measuredTextScript('ok', 20_000))
    await runtime.sendChat(sessionId, 'b'.repeat(70_000))
    await sink.next('run.finished')
    const before = runtime.messages(sessionId).messages.length

    const session = await runtime.compactSession(sessionId)

    expect(session.compaction).toMatchObject({ summary: 'SUMMARY' })
    expect(summaries).toHaveLength(1)
    expect(session.contextTokens).toBeLessThan(20_000)
    expect(runtime.messages(sessionId).messages).toHaveLength(before)
  })

  it('does not compact a short session unless compaction is forced', async () => {
    scripts.push(textScript('first'))
    await runtime.sendChat(sessionId, 'one')
    await sink.next('run.finished')
    scripts.push(textScript('second'))
    await runtime.sendChat(sessionId, 'two')
    await sink.next('run.finished')

    const session = await runtime.compactSession(sessionId)
    expect(session.compaction).toBeNull()

    const forced = await runtime.compactSession(sessionId, { force: true })
    expect(forced.compaction).toMatchObject({ summary: 'SUMMARY' })
    expect(summaries).toHaveLength(1)
  })

  it('prepares a summary and reuses it for compaction', async () => {
    scripts.push(measuredTextScript('first', 20_000))
    await runtime.sendChat(sessionId, 'a'.repeat(70_000))
    await sink.next('run.finished')
    scripts.push(measuredTextScript('second', 20_000))
    await runtime.sendChat(sessionId, 'b'.repeat(70_000))
    await sink.next('run.finished')
    summaries = []

    expect(await runtime.prepareCompaction(sessionId)).toBe(true)
    expect(summaries).toHaveLength(1)

    summaries = []
    const session = await runtime.compactSession(sessionId, { force: true })

    expect(session.compaction).toMatchObject({ summary: 'SUMMARY' })
    expect(summaries).toHaveLength(0)
  })

  it('captures workspace snapshots and changed files around a run', async () => {
    await fs.writeFile(path.join(directory, 'workspace', 'notes.txt'), 'before')
    scripts.push(mutatingScript({ 'notes.txt': 'after', 'new.txt': 'created' }))

    await runtime.sendChat(sessionId, 'change files')
    await sink.next('run.finished')

    const assistant = assistantMessages().at(-1)
    expect(assistant?.snapshotBefore).toBeTruthy()
    expect(assistant?.snapshotAfter).toBeTruthy()
    expect(assistant?.changedFiles).toEqual(expect.arrayContaining(['notes.txt', 'new.txt']))
  })

  it('captures project references from the session workspace', async () => {
    const project = path.join(directory, 'project-refs')
    const docs = path.join(directory, 'project-docs')
    await fs.mkdir(path.join(project, '.opencode'), { recursive: true })
    await fs.mkdir(docs, { recursive: true })
    await fs.writeFile(path.join(docs, 'guide.md'), 'guide')
    await fs.writeFile(path.join(project, '.opencode', 'references.json'), JSON.stringify({ docs }))
    const session = await runtime.createSession(project)

    scripts.push(textScript('one'))
    await runtime.sendChat(session.id, 'hello')
    await sink.next('run.finished')

    const snapshotsDirectory = path.join(directory, 'agent', 'snapshots')
    const manifests = await Promise.all(
      (await fs.readdir(snapshotsDirectory))
        .filter((name) => name.endsWith('.json'))
        .map(async (name) =>
          JSON.parse(await fs.readFile(path.join(snapshotsDirectory, name), 'utf8'))
        )
    )
    const snapshot = manifests.find((entry) => entry.sessionId === session.id)

    expect(snapshot?.references).toEqual([{ alias: 'docs', root: await fs.realpath(docs) }])
    expect(Object.keys(snapshot?.files ?? {})).toContain('\u0000refs/docs/guide.md')
  })

  it('records a snapshot for each model step', async () => {
    scripts.push(twoStepMutatingScript())

    await runtime.sendChat(sessionId, 'two steps')
    await sink.next('run.finished')

    const assistant = assistantMessages().at(-1)
    expect(assistant?.snapshotSteps).toHaveLength(2)
    expect(assistant?.snapshotSteps?.[0].files).toContain('step-one.txt')
    expect(assistant?.snapshotSteps?.[1].files).toContain('step-two.txt')
    expect(assistant?.snapshotAfter).toBe(assistant?.snapshotSteps?.[1].after)
    expect(assistant?.changedFiles).toEqual(
      expect.arrayContaining(['step-one.txt', 'step-two.txt'])
    )
  })

  it('restores files and conversation on undo, then replays them on redo', async () => {
    const notes = path.join(directory, 'workspace', 'notes.txt')
    const created = path.join(directory, 'workspace', 'new.txt')
    const outside = path.join(directory, 'workspace', 'outside.txt')
    await fs.writeFile(notes, 'before')
    scripts.push(mutatingScript({ 'notes.txt': 'after', 'new.txt': 'created' }))
    await runtime.sendChat(sessionId, 'change files')
    await sink.next('run.finished')
    await fs.writeFile(outside, 'unrelated')

    const undone = await runtime.undoSession(sessionId)

    expect(undone.prompt).toBe('change files')
    expect(undone.session.redoAvailable).toBe(true)
    expect(runtime.messages(sessionId).messages).toHaveLength(0)
    expect(await fs.readFile(notes, 'utf8')).toBe('before')
    await expect(fs.stat(created)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(outside, 'utf8')).toBe('unrelated')

    const redone = await runtime.redoSession(sessionId)

    expect(redone.redoAvailable).toBe(false)
    expect(runtime.messages(sessionId).messages).toHaveLength(2)
    expect(await fs.readFile(notes, 'utf8')).toBe('after')
    expect(await fs.readFile(created, 'utf8')).toBe('created')
    expect(await fs.readFile(outside, 'utf8')).toBe('unrelated')
  })

  it('clears redo after a new message is sent', async () => {
    await fs.writeFile(path.join(directory, 'workspace', 'notes.txt'), 'before')
    scripts.push(mutatingScript({ 'notes.txt': 'after' }))
    await runtime.sendChat(sessionId, 'change')
    await sink.next('run.finished')
    await runtime.undoSession(sessionId)

    scripts.push(textScript('new answer'))
    await runtime.sendChat(sessionId, 'new direction')
    await sink.next('run.finished')

    expect(runtime.listSessions()[0].redoAvailable).toBe(false)
    await expect(runtime.redoSession(sessionId)).rejects.toThrow('NOTHING_TO_REDO')
  })

  it('reverts to an earlier assistant turn and redoes the removed turns', async () => {
    scripts.push(mutatingScript({ 'a.txt': 'a' }))
    await runtime.sendChat(sessionId, 'first')
    await sink.next('run.finished')
    scripts.push(mutatingScript({ 'b.txt': 'b' }))
    await runtime.sendChat(sessionId, 'second')
    await sink.next('run.finished')
    scripts.push(mutatingScript({ 'c.txt': 'c' }))
    await runtime.sendChat(sessionId, 'third')
    await sink.next('run.finished')

    const assistants = assistantMessages()
    const second = assistants[1]

    const undone = await runtime.undoSession(sessionId, second.id)

    expect(undone.session.redoAvailable).toBe(true)
    expect(runtime.messages(sessionId).messages).toHaveLength(2)
    expect(await fs.readFile(path.join(directory, 'workspace', 'a.txt'), 'utf8')).toBe('a')
    await expect(fs.stat(path.join(directory, 'workspace', 'b.txt'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(fs.stat(path.join(directory, 'workspace', 'c.txt'))).rejects.toMatchObject({
      code: 'ENOENT'
    })

    await runtime.redoSession(sessionId)

    expect(runtime.messages(sessionId).messages).toHaveLength(6)
    expect(await fs.readFile(path.join(directory, 'workspace', 'b.txt'), 'utf8')).toBe('b')
    expect(await fs.readFile(path.join(directory, 'workspace', 'c.txt'), 'utf8')).toBe('c')
  })

  it('rejects undo while running and redo without a staged undo', async () => {
    await expect(runtime.redoSession(sessionId)).rejects.toThrow('NOTHING_TO_REDO')

    scripts.push(stoppableScript())
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')

    await expect(runtime.undoSession(sessionId)).rejects.toThrow('SESSION_BUSY')

    runtime.stopChat(sessionId)
    await sink.next('run.finished')
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

describe('agent tooling configuration', () => {
  it('enforces organization policy rules above session rules', async () => {
    await fs.mkdir(path.join(directory, 'agent'), { recursive: true })
    await fs.writeFile(
      path.join(directory, 'agent', 'policy.json'),
      JSON.stringify({
        permissionRules: [{ action: 'shell', resource: '*', effect: 'deny' }]
      })
    )
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    await expect(
      toolContext?.askPermission('shell', 'echo hi', 'shell', 'call-policy')
    ).resolves.toBe(false)
    expect(sink.count('permission.asked')).toBe(0)
  })

  it('advertises references and allows their external paths', async () => {
    const referenceDirectory = path.join(directory, 'reference-docs')
    await fs.mkdir(referenceDirectory, { recursive: true })
    await fs.writeFile(path.join(referenceDirectory, 'guide.md'), '# Guide')
    await writeAgentConfig({
      references: [{ alias: 'docs', path: referenceDirectory, description: 'Product docs' }]
    })
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(turns[0].system).toContain(`docs: ${referenceDirectory}`)
    expect(turns[0].system).toContain('Product docs')
    await expect(
      toolContext?.askPermission(
        'external_directory',
        path.join(referenceDirectory, 'guide.md'),
        'read',
        'call-ref'
      )
    ).resolves.toBe(true)
    expect(sink.count('permission.asked')).toBe(0)
  })

  it('stores text and images from tool results separately', async () => {
    scripts.push(imageResultScript())

    await runtime.sendChat(sessionId, 'read image')
    await sink.next('run.finished')

    const part = assistantMessages()
      .at(-1)
      ?.parts.find((candidate) => candidate.type === 'tool')
    expect(part).toMatchObject({
      state: 'completed',
      output: 'Image: a.png (2 bytes)',
      images: [{ mimeType: 'image/png', data: 'AQID' }]
    })
  })

  it('provides formatting and diagnostics hooks by default', async () => {
    scripts.push(textScript('Hello'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(typeof toolContext?.formatFiles).toBe('function')
    expect(typeof toolContext?.diagnoseFiles).toBe('function')
    expect(typeof toolContext?.lspHover).toBe('function')
    expect(typeof toolContext?.lspDefinition).toBe('function')
  })

  it('disables the hooks when the config turns them off', async () => {
    await runtime.shutdown()
    await writeAgentConfig({ lsp: false, formatters: false })
    runtime = createRuntime()
    await runtime.init()
    const session = await runtime.createSession()
    scripts.push(textScript('Hello'))

    await runtime.sendChat(session.id, 'hi')
    await sink.next('run.finished')

    expect(toolContext?.formatFiles).toBeUndefined()
    expect(toolContext?.diagnoseFiles).toBeUndefined()
  })
})

describe('MCP tool integration', () => {
  it('forwards stored OAuth credentials to the MCP manager', async () => {
    const auth = {
      serverId: 'server-1',
      serverUrl: 'https://mcp.example.com/mcp',
      accessToken: 'access-1'
    }

    await runtime.setMcpAuth([auth])
    await runtime.listMcpServers()

    expect(mcpManagerInput?.mcpAuth).toEqual([auth])
    await runtime.setMcpAuth([])
    expect(mcpManager.setMcpAuth).toHaveBeenCalledWith([])
  })

  it('surfaces MCP prompt errors to the caller', async () => {
    vi.mocked(mcpManager.getPrompt).mockRejectedValueOnce(new Error('UNKNOWN_MCP_SERVER: missing'))

    await expect(runtime.mcpPrompt('missing', 'greet')).rejects.toThrow('UNKNOWN_MCP_SERVER')
  })

  it('runs MCP prompts in the requested workspace', async () => {
    const project = path.join(directory, 'project-mcp')
    await fs.mkdir(project, { recursive: true })

    await runtime.mcpPrompt('docs', 'search', undefined, project)

    expect(mcpManagerInput?.workspacePath).toBe(project)
  })

  it('merges MCP tools into the run tool set', async () => {
    mcpTools.mockResolvedValue({
      mcp_demo_echo: { description: 'Echo', execute: async () => 'ok' }
    } as unknown as ToolSet)
    scripts.push(textScript('Hello'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(mcpTools).toHaveBeenCalledWith(
      expect.objectContaining({ askPermission: expect.any(Function) })
    )
    expect(Object.keys(turns[0].tools)).toContain('mcp_demo_echo')
  })

  it('disposes the MCP manager on shutdown', async () => {
    scripts.push(textScript('Hello'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    await runtime.shutdown()

    expect(mcpDispose).toHaveBeenCalled()
  })
})

function subagentCallScript(input: {
  prompt: string
  agent?: string
  sessionId?: string
  background?: boolean
}): Script {
  return async function* () {
    yield part({ type: 'tool-input-start', id: 'call-sub', toolName: 'subagent' })
    yield part({ type: 'tool-call', toolCallId: 'call-sub', toolName: 'subagent', input })
    if (!subagentExecutor) throw new Error('subagent executor is missing')
    const output = await subagentExecutor(input, 'call-sub')
    yield part({ type: 'tool-result', toolCallId: 'call-sub', toolName: 'subagent', input, output })
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'parent done' })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function questionScript(): Script {
  return async function* () {
    const input = {
      header: 'Pick',
      question: 'Continue?',
      options: [{ label: 'yes' }]
    }
    yield part({ type: 'tool-input-start', id: 'call-q', toolName: 'question' })
    yield part({ type: 'tool-call', toolCallId: 'call-q', toolName: 'question', input })
    if (!questionExecutor) throw new Error('question executor is missing')
    const output = await questionExecutor(input, 'call-q')
    yield part({ type: 'tool-result', toolCallId: 'call-q', toolName: 'question', input, output })
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: 'child done' })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function nestedSubagentScript(): Script {
  return async function* () {
    if (!subagentExecutor) throw new Error('subagent executor is missing')
    const output = await subagentExecutor(
      { prompt: 'Nested task', agent: 'general' },
      'call-nested'
    )
    yield part({ type: 'text-start', id: 't1' })
    yield part({ type: 'text-delta', id: 't1', text: output })
    yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
  }
}

function toolOutput(message: ChatMessage | undefined): string {
  const part = message?.parts.find((entry) => entry.type === 'tool')
  return part?.type === 'tool' ? (part.output ?? '') : ''
}

describe('agent selection', () => {
  it('lists builtin and custom agents', async () => {
    await fs.mkdir(path.join(directory, 'agent', 'agents'), { recursive: true })
    await fs.writeFile(
      path.join(directory, 'agent', 'agents', 'custom.md'),
      ['---', 'description: Custom agent', 'mode: primary', '---', 'Custom prompt.'].join('\n')
    )

    const agents = await runtime.listAgents()

    expect(agents.map((agent) => agent.id)).toContain('custom')
    expect(agents.map((agent) => agent.id)).toContain('build')
  })

  it('loads project agents from the requested workspace', async () => {
    const project = path.join(directory, 'project-agents')
    await fs.mkdir(path.join(project, '.opencode', 'agent'), { recursive: true })
    await fs.writeFile(
      path.join(project, '.opencode', 'agent', 'reviewer.md'),
      ['---', 'description: Project reviewer', 'mode: primary', '---', 'Review code.'].join('\n')
    )

    const projectAgents = await runtime.listAgents(project)
    const defaultAgents = await runtime.listAgents()

    expect(projectAgents.map((agent) => agent.id)).toContain('reviewer')
    expect(defaultAgents.map((agent) => agent.id)).not.toContain('reviewer')
  })

  it('persists the selected primary agent', async () => {
    const updated = await runtime.setSessionAgent(sessionId, 'plan')

    expect(updated.agent).toBe('plan')
    expect(runtime.listSessions()[0].agent).toBe('plan')
  })

  it('rejects subagent and unknown agents for primary sessions', async () => {
    await expect(runtime.setSessionAgent(sessionId, 'explore')).rejects.toThrow('AGENT_NOT_PRIMARY')
    await expect(runtime.setSessionAgent(sessionId, 'missing')).rejects.toThrow('AGENT_NOT_FOUND')
  })

  it('applies the agent prompt, tools and step limit', async () => {
    baseTools = { read: {} as never, write: {} as never, subagent: {} as never }
    await runtime.setSessionAgent(sessionId, 'plan')
    scripts.push(textScript('planned'))

    await runtime.sendChat(sessionId, 'plan the work')
    await sink.next('run.finished')

    expect(turns[0].system).toContain('plan agent')
    expect(Object.keys(turns[0].tools)).toEqual(['read'])
    expect(turns[0].maxSteps).toBe(20)
  })

  it('uses the agent model when configured', async () => {
    await fs.mkdir(path.join(directory, 'agent', 'agents'), { recursive: true })
    await fs.writeFile(
      path.join(directory, 'agent', 'agents', 'smart.md'),
      [
        '---',
        'description: Smart agent',
        'mode: primary',
        'model: provider-1/model-1',
        '---',
        'Be smart.'
      ].join('\n')
    )
    await runtime.setSessionAgent(sessionId, 'smart')
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(languageModelRefs.at(-1)).toEqual({ providerId: 'provider-1', modelId: 'model-1' })
  })
})

describe('subagent tool', () => {
  it('runs a hidden child session and returns its output', async () => {
    scripts.push(subagentCallScript({ prompt: 'Explore src', agent: 'explore' }))
    scripts.push(textScript('found three files'))

    await runtime.sendChat(sessionId, 'delegate')
    await sink.next('run.finished')

    const output = toolOutput(assistantMessages().at(-1))
    expect(output).toContain('[subagent explore · session ')
    expect(output).toContain('found three files')
    const childId = /session ([0-9a-f-]+)/.exec(output)?.[1]
    expect(childId).toBeTruthy()
    const childMessages = runtime.messages(childId as string).messages
    expect(childMessages.at(-1)?.parts).toEqual([{ type: 'text', text: 'found three files' }])
    expect(runtime.listSessions()).toHaveLength(1)
  })

  it('prevents nested subagents', async () => {
    scripts.push(subagentCallScript({ prompt: 'Outer task', agent: 'general' }))
    scripts.push(nestedSubagentScript())

    await runtime.sendChat(sessionId, 'delegate')
    await sink.next('run.finished')

    expect(toolOutput(assistantMessages().at(-1))).toContain('subagents cannot spawn subagents')
  })

  it('continues an existing subagent session', async () => {
    scripts.push(subagentCallScript({ prompt: 'First task', agent: 'explore' }))
    scripts.push(textScript('first answer'))
    await runtime.sendChat(sessionId, 'delegate')
    await sink.next('run.finished')
    const childId = /session ([0-9a-f-]+)/.exec(
      toolOutput(assistantMessages().at(-1))
    )?.[1] as string

    scripts.push(subagentCallScript({ prompt: 'Follow up', agent: 'explore', sessionId: childId }))
    scripts.push(textScript('second answer'))
    await runtime.sendChat(sessionId, 'again')
    await sink.next('run.finished')

    const childMessages = runtime.messages(childId).messages
    expect(childMessages).toHaveLength(4)
    expect(childMessages.at(-1)?.parts).toEqual([{ type: 'text', text: 'second answer' }])
    expect(toolOutput(assistantMessages().at(-1))).toContain('second answer')
    expect(runtime.listSessions()).toHaveLength(1)
  })

  it('keeps a continued subagent in its own directory', async () => {
    scripts.push(subagentCallScript({ prompt: 'First task', agent: 'explore' }))
    scripts.push(textScript('first answer'))
    await runtime.sendChat(sessionId, 'delegate')
    await sink.next('run.finished')
    const childId = /session ([0-9a-f-]+)/.exec(
      toolOutput(assistantMessages().at(-1))
    )?.[1] as string

    const workspace = path.join(directory, 'workspace')
    const feature = path.join(workspace, 'feature')
    await fs.mkdir(feature, { recursive: true })
    if (!toolContext) throw new Error('tool context not initialized')
    await toolContext.moveSession?.(feature)
    expect(runtime.listSessions().find((entry) => entry.id === sessionId)?.directory).toBe(
      workspace
    )

    scripts.push(subagentCallScript({ prompt: 'Follow up', agent: 'explore', sessionId: childId }))
    scripts.push(textScript('second answer'))
    await runtime.sendChat(sessionId, 'again')
    await sink.next('run.finished')

    expect(turns.at(-2)?.system).toContain(workspace)
    expect(turns.at(-1)?.system).toContain(feature)
  })

  it('delegates child permissions to the parent request', async () => {
    scripts.push(subagentCallScript({ prompt: 'Edit a file', agent: 'general' }))
    scripts.push(async function* () {
      if (!toolExecutor) throw new Error('tool executor is missing')
      const result = await toolExecutor('child.txt', 'child-call')
      yield part({ type: 'text-start', id: 't1' })
      yield part({ type: 'text-delta', id: 't1', text: result })
      yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
    })

    await runtime.sendChat(sessionId, 'delegate')
    const asked = await sink.next('permission.asked')
    if (asked.event.type !== 'permission.asked') throw new Error('unexpected event')
    expect(asked.event.permission).toMatchObject({
      sessionId,
      action: 'write',
      toolCallId: 'call-sub'
    })
    runtime.replyPermission(asked.event.permission.id, 'once')
    await sink.next('run.finished')

    expect(toolOutput(assistantMessages().at(-1))).toContain('done:child.txt')
  })

  it('removes child sessions when the parent is deleted', async () => {
    scripts.push(subagentCallScript({ prompt: 'Explore', agent: 'explore' }))
    scripts.push(textScript('done'))
    await runtime.sendChat(sessionId, 'delegate')
    await sink.next('run.finished')
    const childId = /session ([0-9a-f-]+)/.exec(
      toolOutput(assistantMessages().at(-1))
    )?.[1] as string

    await runtime.deleteSession(sessionId)

    expect(() => runtime.messages(childId)).toThrow('SESSION_NOT_FOUND')
  })
})

describe('web tool wiring', () => {
  it('wires webfetch through the configured fetcher', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    await expect(
      toolContext?.fetchWeb?.({ url: 'https://example.com', format: 'markdown' })
    ).resolves.toBe(
      'URL: https://example.com\nStatus: 200\nContent-Type: text/plain\n\npage:https://example.com'
    )
  })

  it('reports unconfigured web search and uses the saved provider', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    await expect(toolContext?.webSearch?.({ query: 'cats', count: 3 })).resolves.toContain(
      'web search is not configured'
    )

    runtime.setWebSearch({ provider: 'tavily', apiKey: 'key' })

    await expect(toolContext?.webSearch?.({ query: 'cats', count: 3 })).resolves.toBe(
      'Search results for "cats" (tavily):\n1. Hit\n   https://hit.example\n   tavily:cats'
    )
  })
})

describe('attachments', () => {
  it('includes text attachments in model messages', async () => {
    const attachment = await saveAttachment(directory, sessionId, {
      name: 'notes.txt',
      mimeType: 'text/plain',
      data: Buffer.from('attached text')
    })
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'see attached', undefined, [attachment])
    await sink.next('run.finished')

    expect(turns[0].messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see attached' },
          { type: 'text', text: 'File: notes.txt\n```\nattached text\n```' }
        ]
      }
    ])
    const userMessage = runtime.messages(sessionId).messages[0]
    expect(userMessage.parts).toContainEqual({ type: 'attachment', attachment })
  })

  it('does not read attachments outside the session directory', async () => {
    await fs.writeFile(path.join(directory, 'secret.txt'), 'top secret')
    const attachment = {
      id: 'escape',
      name: 'secret.txt',
      mimeType: 'text/plain',
      size: 10,
      kind: 'text' as const,
      path: path.join(attachmentDirectory(directory, sessionId), '..', '..', '..', 'secret.txt')
    }
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'see attached', undefined, [attachment])
    await sink.next('run.finished')

    expect(JSON.stringify(turns[0].messages)).not.toContain('top secret')
  })

  it('sends images as multimodal parts and allows attachment-only messages', async () => {
    const attachment = await saveAttachment(directory, sessionId, {
      name: 'shot.png',
      mimeType: 'image/png',
      data: Buffer.from([1, 2, 3])
    })
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, '', undefined, [attachment])
    await sink.next('run.finished')

    const user = turns[0].messages[0]
    expect(user).toMatchObject({
      role: 'user',
      content: [expect.objectContaining({ type: 'file', mediaType: 'image/png' })]
    })
    expect(runtime.messages(sessionId).messages[0].parts).toHaveLength(1)
  })

  it('removes attachment files when a session is deleted', async () => {
    const attachment = await saveAttachment(directory, sessionId, {
      name: 'notes.txt',
      mimeType: 'text/plain',
      data: Buffer.from('x')
    })
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi', undefined, [attachment])
    await sink.next('run.finished')

    await runtime.deleteSession(sessionId)

    await expect(fs.stat(attachmentDirectory(directory, sessionId))).rejects.toThrow()
  })
})

describe('skills and commands', () => {
  async function writeWorkspace(relative: string, content: string): Promise<void> {
    const target = path.join(directory, 'workspace', relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content)
  }

  it('lists skills in the system prompt and loads them on demand', async () => {
    await writeWorkspace(
      '.opencode/skills/review/SKILL.md',
      ['---', 'description: Review code', '---', 'Review steps.'].join('\n')
    )
    await writeWorkspace('.opencode/skills/review/references/checklist.md', 'Checklist')
    await restartRuntime()
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(turns[0].system).toContain('Available skills')
    expect(turns[0].system).toContain('- review: Review code')
    const loaded = await toolContext?.loadSkill?.('review')
    expect(loaded).toContain('Review steps.')
    expect(loaded).toContain('references/checklist.md')
    expect(loaded).toContain(path.join(directory, 'workspace', '.opencode', 'skills', 'review'))
    await expect(toolContext?.loadSkill?.('missing')).resolves.toContain('unknown skill')
  })

  it('omits the skills prompt when none exist', async () => {
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(turns[0].system).not.toContain('Available skills')
  })

  it('lists MCP prompts as commands', async () => {
    vi.mocked(mcpManager.prompts).mockResolvedValueOnce([
      {
        server: 'docs',
        name: 'search',
        description: 'Search docs',
        arguments: [{ name: 'query', required: true }]
      }
    ])

    const commands = await runtime.listCommands()

    expect(commands).toContainEqual({
      id: 'mcp:docs:search',
      name: 'search',
      description: 'MCP · docs · Search docs',
      template: '',
      agent: null,
      model: null,
      mcp: { server: 'docs', prompt: 'search', arguments: ['query'] },
      source: 'mcp'
    })
  })

  it('lists workspace commands', async () => {
    await writeWorkspace(
      '.opencode/commands/review.md',
      ['---', 'description: Review changes', '---', 'Review $ARGUMENTS'].join('\n')
    )

    const commands = await runtime.listCommands()

    expect(commands).toMatchObject([
      { name: 'review', description: 'Review changes', template: 'Review $ARGUMENTS' }
    ])
  })
})

describe('todo tools', () => {
  it('stores todos on the session and exposes them for reading', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    const output = await toolContext?.writeTodos?.([
      { content: 'Write tests', status: 'in_progress', priority: 'high' },
      { content: 'Ship it', status: 'pending', priority: 'low' }
    ])

    expect(output).toContain('Tasks (0/2 completed):')
    expect(runtime.listSessions()[0].todos).toMatchObject([
      { id: 'todo-1', content: 'Write tests', status: 'in_progress', priority: 'high' },
      { id: 'todo-2', content: 'Ship it', status: 'pending', priority: 'low' }
    ])
    const upsert = sink.envelopes
      .filter((envelope) => envelope.event.type === 'session.upsert')
      .at(-1)
    expect(upsert?.event).toMatchObject({
      session: { todos: expect.arrayContaining([expect.objectContaining({ content: 'Ship it' })]) }
    })
    await expect(toolContext?.readTodos?.()).resolves.toContain('1. [in_progress] Write tests')
  })
})

describe('question tool', () => {
  it('routes subagent questions to the parent session', async () => {
    scripts.push(subagentCallScript({ prompt: 'Ask the user', agent: 'general' }))
    scripts.push(questionScript())

    await runtime.sendChat(sessionId, 'delegate')
    const asked = await sink.next('question.asked')
    if (asked.event.type !== 'question.asked') throw new Error('unexpected event')
    expect(asked.event.question.sessionId).toBe(sessionId)

    runtime.replyQuestion(asked.event.question.id, { selected: ['yes'], custom: null })
    await sink.next('run.finished')

    expect(runtime.questions()).toEqual([])
  })

  it('asks the user and returns the answer', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    const pending = questionExecutor?.(
      {
        header: 'Choose',
        question: 'Which file should change?',
        options: [{ label: 'src/a.ts' }, { label: 'src/b.ts' }],
        multiple: false,
        allowCustom: false
      },
      'call-q'
    )
    const asked = await sink.next('question.asked')
    if (asked.event.type !== 'question.asked') throw new Error('unexpected event')
    expect(asked.event.question).toMatchObject({
      sessionId,
      toolCallId: 'call-q',
      question: 'Which file should change?'
    })
    expect(runtime.questions()).toHaveLength(1)

    runtime.replyQuestion(asked.event.question.id, { selected: ['src/a.ts'], custom: null })

    await expect(pending).resolves.toBe('User answered: src/a.ts')
    expect(runtime.questions()).toEqual([])
  })

  it('formats multiple selections and custom input', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    const pending = questionExecutor?.(
      {
        header: 'Pick',
        question: 'Which checks?',
        options: [{ label: 'lint' }, { label: 'tests' }],
        multiple: true,
        allowCustom: true
      },
      'call-q2'
    )
    const asked = await sink.next('question.asked')
    if (asked.event.type !== 'question.asked') throw new Error('unexpected event')
    runtime.replyQuestion(asked.event.question.id, {
      selected: ['lint', 'tests'],
      custom: 'typecheck'
    })

    await expect(pending).resolves.toBe('User answered: lint, tests; custom: typecheck')
  })

  it('reports cancelled questions', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    const pending = questionExecutor?.(
      { header: 'Pick', question: 'Continue?', options: [{ label: 'yes' }] },
      'call-q3'
    )
    const asked = await sink.next('question.asked')
    if (asked.event.type !== 'question.asked') throw new Error('unexpected event')
    runtime.replyQuestion(asked.event.question.id, {
      selected: [],
      custom: null,
      cancelled: true
    })

    await expect(pending).resolves.toBe('User cancelled the question.')
  })
})

describe('question timeouts and cancellation', () => {
  it('times out unanswered questions', async () => {
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    vi.useFakeTimers()
    const pending = questionExecutor?.(
      { header: 'Pick', question: 'Continue?', options: [{ label: 'yes' }] },
      'call-timeout'
    )
    vi.advanceTimersByTime(10 * 60 * 1000)

    await expect(pending).resolves.toBe('User did not answer the question in time.')
    expect(runtime.questions()).toEqual([])
  })

  it('cancels pending questions when the run stops', async () => {
    scripts.push(pausableTextScript())
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')
    await vi.waitFor(() => expect(questionExecutor).not.toBeNull())

    const pending = questionExecutor?.(
      { header: 'Pick', question: 'Continue?', options: [{ label: 'yes' }] },
      'call-stop'
    )
    await sink.next('question.asked')

    runtime.stopChat(sessionId)
    await expect(pending).resolves.toBe('User cancelled the question.')

    if (resumeTurn) resumeTurn()
    resumeTurn = null
    await sink.next('run.finished')
  })
})

describe('model capability metadata', () => {
  it('passes max output tokens to the turn and records message cost', async () => {
    runtime.setModels({
      ...MODELS,
      models: [
        {
          ...MODELS.models[0],
          contextWindow: 200_000,
          maxOutputTokens: 4_096,
          costInput: 3,
          costOutput: 15
        }
      ]
    })
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(turns[0].maxOutputTokens).toBe(4_096)
    expect(assistantMessages()[0].costUsd).toBe(0.000069)
  })
})

describe('session search and fork', () => {
  it('forks a session and emits it', async () => {
    scripts.push(textScript('hello'))
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    const forked = await runtime.forkSession(sessionId)

    expect(forked.title).toContain('(fork)')
    expect(runtime.messages(forked.id).messages).toHaveLength(2)
    expect(
      sink.envelopes.some(
        (envelope) =>
          envelope.event.type === 'session.upsert' && envelope.event.session.id === forked.id
      )
    ).toBe(true)
  })

  it('copies attachments and strips snapshot references when forking', async () => {
    const attachment = await saveAttachment(directory, sessionId, {
      name: 'notes.txt',
      mimeType: 'text/plain',
      data: Buffer.from('attached text')
    })
    scripts.push(textScript('ok'))
    await runtime.sendChat(sessionId, 'see attached', undefined, [attachment])
    await sink.next('run.finished')

    const forked = await runtime.forkSession(sessionId)
    const messages = runtime.messages(forked.id).messages
    const part = messages[0].parts.find((candidate) => candidate.type === 'attachment')
    if (part?.type !== 'attachment') throw new Error('attachment missing')
    expect(
      part.attachment.path.startsWith(`${attachmentDirectory(directory, forked.id)}${path.sep}`)
    ).toBe(true)
    await expect(fs.stat(part.attachment.path)).resolves.toBeDefined()

    await runtime.deleteSession(sessionId)
    await expect(fs.stat(part.attachment.path)).resolves.toBeDefined()

    const assistant = messages[1]
    expect(assistant.snapshotBefore).toBeUndefined()
    expect(assistant.snapshotAfter).toBeUndefined()
    expect(assistant.snapshotSteps).toEqual([])
  })

  it('rejects forking a running session', async () => {
    scripts.push(pausableTextScript())
    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.started')
    await vi.waitFor(() => expect(resumeTurn).not.toBeNull())

    await expect(runtime.forkSession(sessionId)).rejects.toThrow('SESSION_BUSY')

    if (resumeTurn) resumeTurn()
    resumeTurn = null
    await sink.next('run.finished')
  })

  it('searches sessions by title and message content', async () => {
    scripts.push(textScript('The weather is sunny today'))
    await runtime.sendChat(sessionId, 'weather in Hangzhou')
    await sink.next('run.finished')

    const byMessage = runtime.searchSessions('sunny')
    expect(byMessage).toHaveLength(1)
    expect(byMessage[0].session.id).toBe(sessionId)
    expect(byMessage[0].snippet).toContain('sunny')

    const byTitle = runtime.searchSessions('weather in')
    expect(byTitle[0].session.id).toBe(sessionId)
    expect(runtime.searchSessions('nothing-matches')).toEqual([])
    expect(runtime.searchSessions('  ')).toEqual([])
  })
})

describe('generated session titles', () => {
  it('replaces the derived title after the first exchange', async () => {
    generateTitle.mockResolvedValueOnce('Hangzhou Weather')
    scripts.push(textScript('sunny'))
    await runtime.sendChat(sessionId, 'today weather')
    await sink.next('run.finished')

    expect(runtime.listSessions()[0].title).toBe('Hangzhou Weather')

    scripts.push(textScript('again'))
    await runtime.sendChat(sessionId, 'more')
    await sink.next('run.finished')
    expect(generateTitle).toHaveBeenCalledTimes(1)
  })

  it('keeps the derived title when generation fails', async () => {
    generateTitle.mockRejectedValueOnce(new Error('offline'))
    scripts.push(textScript('sunny'))
    await runtime.sendChat(sessionId, 'today weather')
    await sink.next('run.finished')

    expect(runtime.listSessions()[0].title).toBe('today weather')
  })
})

describe('agent permission rules', () => {
  async function writeAgent(name: string, frontmatter: string[]): Promise<void> {
    await fs.mkdir(path.join(directory, 'agent', 'agents'), { recursive: true })
    await fs.writeFile(
      path.join(directory, 'agent', 'agents', `${name}.md`),
      ['---', ...frontmatter, '---', 'Agent instructions.'].join('\n')
    )
  }

  it('enforces agent deny rules in auto mode', async () => {
    await writeAgent('lockdown', [
      'description: Locked down',
      'mode: primary',
      'permission: edit|*|deny'
    ])
    await runtime.setSessionSettings(sessionId, { reasoningEffort: null, permissionMode: 'auto' })
    await runtime.setSessionAgent(sessionId, 'lockdown')
    toolAction = 'edit'
    scripts.push(toolScript(['a.txt']))

    await runtime.sendChat(sessionId, 'edit it')
    await sink.next('run.finished')

    expect(toolOutput(assistantMessages().at(-1))).toBe('Permission denied')
    expect(sink.envelopes.some((envelope) => envelope.event.type === 'permission.asked')).toBe(
      false
    )
  })

  it('lets agent rules allow what the session mode asks', async () => {
    await writeAgent('trusted', [
      'description: Trusted',
      'mode: primary',
      'permission: write|*|allow'
    ])
    await runtime.setSessionAgent(sessionId, 'trusted')
    toolAction = 'write'
    scripts.push(toolScript(['a.txt']))

    await runtime.sendChat(sessionId, 'write it')
    await sink.next('run.finished')

    expect(toolOutput(assistantMessages().at(-1))).toBe('done:a.txt')
    expect(sink.envelopes.some((envelope) => envelope.event.type === 'permission.asked')).toBe(
      false
    )
  })

  it('lets session rules override agent rules', async () => {
    await writeAgent('lockdown', [
      'description: Locked down',
      'mode: primary',
      'permission: edit|*|deny'
    ])
    await runtime.setSessionAgent(sessionId, 'lockdown')
    await runtime.addPermissionRule({
      action: 'edit',
      resource: '*',
      effect: 'allow',
      sessionId
    })
    toolAction = 'edit'
    scripts.push(toolScript(['a.txt']))

    await runtime.sendChat(sessionId, 'edit it')
    await sink.next('run.finished')

    expect(toolOutput(assistantMessages().at(-1))).toBe('done:a.txt')
  })

  it('applies subagent agent rules through the parent request', async () => {
    await writeAgent('strict', [
      'description: Strict subagent',
      'mode: subagent',
      'permission: shell|*|deny'
    ])
    toolAction = 'shell'
    scripts.push(subagentCallScript({ prompt: 'Run a command', agent: 'strict' }))
    scripts.push(async function* () {
      if (!toolExecutor) throw new Error('tool executor is missing')
      const output = await toolExecutor('rm -rf /', 'child-call')
      yield part({ type: 'text-start', id: 't1' })
      yield part({ type: 'text-delta', id: 't1', text: output })
      yield part({ type: 'finish', finishReason: 'stop', totalUsage: {} })
    })

    await runtime.sendChat(sessionId, 'delegate')
    await sink.next('run.finished')

    expect(toolOutput(assistantMessages().at(-1))).toContain('Permission denied')
  })
})

describe('background subagents and sampling', () => {
  it('passes the agent temperature to the turn', async () => {
    await fs.mkdir(path.join(directory, 'agent', 'agents'), { recursive: true })
    await fs.writeFile(
      path.join(directory, 'agent', 'agents', 'creative.md'),
      ['---', 'description: Creative', 'mode: primary', 'temperature: 0.4', '---', 'Write.'].join(
        '\n'
      )
    )
    await runtime.setSessionAgent(sessionId, 'creative')
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(turns[0].temperature).toBe(0.4)
  })

  it('applies the selected model variant', async () => {
    runtime.setModels({
      ...MODELS,
      models: [
        {
          ...MODELS.models[0],
          maxOutputTokens: 4096,
          variants: [
            {
              id: 'deep',
              name: 'Deep',
              settings: { reasoningEffort: 'high', temperature: 0.2, maxOutputTokens: 8192 }
            }
          ]
        }
      ]
    })
    await runtime.setSessionModel(sessionId, {
      providerId: 'provider-1',
      modelId: 'model-1',
      variant: 'deep'
    })
    scripts.push(textScript('ok'))

    await runtime.sendChat(sessionId, 'hi')
    await sink.next('run.finished')

    expect(turns[0].reasoning).toBe('high')
    expect(turns[0].temperature).toBe(0.2)
    expect(turns[0].maxOutputTokens).toBe(8192)
  })

  it('drops variants that disappear from the model configuration', async () => {
    runtime.setModels({
      ...MODELS,
      models: [
        {
          ...MODELS.models[0],
          variants: [{ id: 'high', name: 'High', settings: {} }]
        }
      ]
    })
    await runtime.setSessionModel(sessionId, {
      providerId: 'provider-1',
      modelId: 'model-1',
      variant: 'high'
    })

    runtime.setModels(MODELS)

    expect(runtime.listSessions()[0].model?.variant).toBeNull()
  })

  it('rejects unknown model variants', async () => {
    await expect(
      runtime.setSessionModel(sessionId, {
        providerId: 'provider-1',
        modelId: 'model-1',
        variant: 'missing'
      })
    ).rejects.toThrow('INVALID_VARIANT')
  })

  it('runs subagents in the background and reports completion', async () => {
    scripts.push(subagentCallScript({ prompt: 'Explore src', agent: 'explore', background: true }))
    scripts.push(textScript('background result'))

    await runtime.sendChat(sessionId, 'delegate')
    await sink.next('run.finished')

    expect(toolOutput(assistantMessages().at(-1))).toContain('running in background')

    const finished = await sink.next('subagent.finished')
    if (finished.event.type !== 'subagent.finished') throw new Error('unexpected event')
    expect(finished.event).toMatchObject({
      parentSessionId: sessionId,
      agentId: 'explore',
      status: 'completed',
      toolCallId: 'call-sub'
    })
    expect(finished.event.result).toContain('background result')
    expect(runtime.listSessions()).toHaveLength(1)
  })
})
