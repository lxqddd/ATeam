import { PassThrough } from 'node:stream'
import { createInterface } from 'node:readline'
import type { AgentEvent, AgentEventEnvelope, PermissionDecision, SessionMeta } from '@ateam/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { makeSession } from '../main/agent/test/factories'
import { EventBus } from '../server/event-bus'
import { AcpServer, type AcpRuntime } from './server'

class FakeRuntime implements AcpRuntime {
  session: SessionMeta = makeSession({ id: 'sess-1' })
  sent: string[] = []
  stopped: string[] = []
  decisions: Array<{ id: string; decision: PermissionDecision }> = []
  onChat: ((id: string) => Promise<void>) | null = null

  constructor(private readonly bus: EventBus) {}

  async createSession(): Promise<SessionMeta> {
    return { ...this.session }
  }

  async sendChat(id: string, text: string): Promise<void> {
    this.sent.push(text)
    if (this.onChat) await this.onChat(id)
  }

  stopChat(id: string): void {
    this.stopped.push(id)
  }

  replyPermission(id: string, decision: PermissionDecision): void {
    this.decisions.push({ id, decision })
  }

  replyQuestion(): void {}

  async shutdown(): Promise<void> {}
}

function envelope(event: AgentEvent, seq: number): AgentEventEnvelope {
  return { seq, at: new Date().toISOString(), event }
}

function createHarness(): {
  server: AcpServer
  bus: EventBus
  runtime: FakeRuntime
  send: (message: unknown) => void
  next: (predicate?: (message: any) => boolean) => Promise<any>
} {
  const bus = new EventBus()
  const runtime = new FakeRuntime(bus)
  const input = new PassThrough()
  const output = new PassThrough()
  const reader = createInterface({ input: output })
  const messages: any[] = []
  const waiters: Array<{ predicate: (message: any) => boolean; resolve: (message: any) => void }> =
    []
  reader.on('line', (line) => {
    const message = JSON.parse(line)
    const waiterIndex = waiters.findIndex((entry) => entry.predicate(message))
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1)
      waiter.resolve(message)
      return
    }
    messages.push(message)
  })
  const server = new AcpServer({
    createRuntime: async () => runtime,
    bus,
    input,
    output
  })
  server.start()
  return {
    server,
    bus,
    runtime,
    send: (message) => input.write(`${JSON.stringify(message)}\n`),
    next: (predicate = () => true) => {
      const index = messages.findIndex(predicate)
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0])
      return new Promise((resolve) => waiters.push({ predicate, resolve }))
    }
  }
}

let harness: ReturnType<typeof createHarness> | null = null

afterEach(async () => {
  await harness?.server.close()
  harness = null
})

const INITIALIZE = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }

async function openSession(h: ReturnType<typeof createHarness>): Promise<string> {
  h.send(INITIALIZE)
  await h.next((message) => message.id === 1)
  h.send({
    jsonrpc: '2.0',
    id: 2,
    method: 'session/new',
    params: { cwd: '/tmp/project', mcpServers: [] }
  })
  const response = await h.next((message) => message.id === 2)
  return response.result.sessionId
}

describe('AcpServer', () => {
  it('initializes with protocol version and capabilities', async () => {
    harness = createHarness()
    harness.send(INITIALIZE)
    const response = await harness.next((message) => message.id === 1)

    expect(response.result).toMatchObject({
      protocolVersion: 1,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: 'ateam' }
    })
  })

  it('creates sessions and streams prompt output', async () => {
    harness = createHarness()
    const h = harness
    const sessionId = await openSession(h)
    h.runtime.onChat = async (id) => {
      h.bus.publish(
        envelope(
          {
            type: 'message.part.delta',
            sessionId: id,
            messageId: 'm1',
            partIndex: 0,
            kind: 'text',
            delta: 'hello'
          },
          1
        )
      )
      h.bus.publish(
        envelope({ type: 'run.finished', sessionId: id, messageId: 'm1', status: 'completed' }, 2)
      )
    }

    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'hi' }] }
    })

    const update = await h.next((message) => message.method === 'session/update')
    expect(update.params.update).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hello' }
    })
    const result = await h.next((message) => message.id === 3)
    expect(result.result).toEqual({ stopReason: 'end_turn' })
    expect(h.runtime.sent).toEqual(['hi'])
  })

  it('bridges permission requests to the client', async () => {
    harness = createHarness()
    const h = harness
    const sessionId = await openSession(h)
    let releasePermission: (() => void) | null = null
    h.runtime.onChat = async (id) => {
      h.bus.publish(
        envelope(
          {
            type: 'permission.asked',
            permission: {
              id: 'perm-1',
              sessionId: id,
              messageId: 'm1',
              toolCallId: 'call-1',
              action: 'shell',
              resource: 'ls',
              toolName: 'shell',
              createdAt: '2026-01-01T00:00:00.000Z'
            }
          },
          1
        )
      )
      await new Promise<void>((resolve) => {
        releasePermission = resolve
      })
      h.bus.publish(
        envelope({ type: 'run.finished', sessionId: id, messageId: 'm1', status: 'completed' }, 2)
      )
    }

    h.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'run it' }] }
    })
    const request = await h.next((message) => message.method === 'session/request_permission')
    expect(request.params.options).toHaveLength(3)

    h.runtime.replyPermission = (id: string, decision: PermissionDecision) => {
      h.runtime.decisions.push({ id, decision })
      releasePermission?.()
    }
    h.send({
      jsonrpc: '2.0',
      id: request.id,
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    })

    expect(await h.next((message) => message.id === 4)).toMatchObject({
      result: { stopReason: 'end_turn' }
    })
    expect(h.runtime.decisions).toEqual([{ id: 'perm-1', decision: 'once' }])
  })

  it('responds with an error when the prompt cannot start', async () => {
    harness = createHarness()
    const sessionId = await openSession(harness)
    harness.runtime.onChat = async () => {
      throw new Error('boom')
    }
    harness.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'hi' }] }
    })

    const response = await harness.next((message) => message.id === 3)
    expect(response.error).toMatchObject({ code: -32603, message: 'boom' })
  })

  it('cancels a running prompt', async () => {
    harness = createHarness()
    const h = harness
    const sessionId = await openSession(h)
    h.runtime.onChat = async (id) =>
      new Promise<void>((resolve) => {
        h.runtime.stopChat = () => {
          h.runtime.stopped.push(id)
          h.bus.publish(
            envelope(
              { type: 'run.finished', sessionId: id, messageId: 'm1', status: 'interrupted' },
              3
            )
          )
          resolve()
        }
      })

    h.send({
      jsonrpc: '2.0',
      id: 5,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'long task' }] }
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    h.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })

    expect(await h.next((message) => message.id === 5)).toMatchObject({
      result: { stopReason: 'cancelled' }
    })
  })
})
