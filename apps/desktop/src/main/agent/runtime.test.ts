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
let toolExecutor: ((value: string, toolCallId: string) => Promise<string>) | null
let runtime: AgentRuntime
let sessionId: string

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
  toolExecutor = null
  runtime = new AgentRuntime({
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
      }
    }
  })
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
})
