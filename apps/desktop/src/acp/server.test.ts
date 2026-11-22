import { PassThrough } from 'node:stream'
import { createInterface } from 'node:readline'
import type {
  AgentEvent,
  AgentEventEnvelope,
  ChatMessage,
  McpServerInput,
  MessageAttachment,
  MessagesSnapshot,
  PermissionDecision,
  QuestionAnswer,
  QuestionInput,
  SessionMeta
} from '@ateam/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { makeMessage, makeSession, makeTextPart } from '../main/agent/test/factories'
import { EventBus } from '../server/event-bus'
import { AcpServer, type AcpRuntime } from './server'

class FakeRuntime implements AcpRuntime {
  session: SessionMeta = makeSession({ id: 'sess-1' })
  sessions: SessionMeta[] = [this.session]
  messagesById = new Map<string, ChatMessage[]>()
  sent: string[] = []
  sentAttachments: Array<MessageAttachment[] | undefined> = []
  attachments: MessageAttachment[] = []
  transientMcp: McpServerInput[][] = []
  stopped: string[] = []
  decisions: Array<{ id: string; decision: PermissionDecision }> = []
  questionAnswers: Array<{ id: string; answer: QuestionAnswer }> = []
  onChat: ((id: string) => Promise<void>) | null = null

  constructor(private readonly bus: EventBus) {}

  async createSession(): Promise<SessionMeta> {
    return { ...this.session }
  }

  listSessions(): SessionMeta[] {
    return [...this.sessions]
  }

  messages(id: string): MessagesSnapshot {
    return { sessionId: id, seq: 0, messages: this.messagesById.get(id) ?? [], running: false }
  }

  async attachImage(
    sessionId: string,
    mimeType: string,
    data: Uint8Array
  ): Promise<MessageAttachment> {
    const attachment: MessageAttachment = {
      id: `att-${this.attachments.length + 1}`,
      name: 'image.png',
      mimeType,
      size: data.byteLength,
      kind: 'image',
      path: `/tmp/${sessionId}/image.png`
    }
    this.attachments.push(attachment)
    return attachment
  }

  async setTransientMcpServers(servers: McpServerInput[]): Promise<void> {
    this.transientMcp.push(servers)
  }

  async sendChat(
    id: string,
    text: string,
    _model?: null,
    attachments?: MessageAttachment[]
  ): Promise<void> {
    this.sent.push(text)
    this.sentAttachments.push(attachments)
    if (this.onChat) await this.onChat(id)
  }

  stopChat(id: string): void {
    this.stopped.push(id)
  }

  replyPermission(id: string, decision: PermissionDecision): void {
    this.decisions.push({ id, decision })
  }

  replyQuestion(id: string, answer: QuestionAnswer): void {
    this.questionAnswers.push({ id, answer })
  }

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
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: true }
      },
      agentInfo: { name: 'ateam' }
    })
  })

  it('loads a session and replays its conversation', async () => {
    harness = createHarness()
    const h = harness
    h.runtime.sessions = [makeSession({ id: 'old-session', title: 'Old' })]
    h.runtime.messagesById.set('old-session', [
      makeMessage({ id: 'm1', role: 'user', parts: [makeTextPart('hello')] }),
      makeMessage({ id: 'm2', role: 'assistant', parts: [makeTextPart('hi there')] })
    ])
    h.send(INITIALIZE)
    await h.next((message) => message.id === 1)
    h.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/load',
      params: { sessionId: 'old-session', cwd: '/tmp/project', mcpServers: [] }
    })

    const userChunk = await h.next(
      (message) =>
        message.method === 'session/update' &&
        message.params.update.sessionUpdate === 'user_message_chunk'
    )
    expect(userChunk.params).toMatchObject({
      sessionId: 'old-session',
      update: { messageId: 'm1', content: { type: 'text', text: 'hello' } }
    })
    const agentChunk = await h.next(
      (message) =>
        message.method === 'session/update' &&
        message.params.update.sessionUpdate === 'agent_message_chunk'
    )
    expect(agentChunk.params.update).toMatchObject({
      messageId: 'm2',
      content: { type: 'text', text: 'hi there' }
    })
    expect(await h.next((message) => message.id === 2)).toMatchObject({ result: {} })
  })

  it('maps question requests to ACP elicitation when supported', async () => {
    harness = createHarness()
    const h = harness
    h.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: { elicitation: { form: {} } }
      }
    })
    await h.next((message) => message.id === 1)
    h.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: { cwd: '/tmp/project', mcpServers: [] }
    })
    const sessionId = (await h.next((message) => message.id === 2)).result.sessionId
    let release: (() => void) | null = null
    h.runtime.onChat = async (id) => {
      const question: QuestionInput = {
        header: 'Pick',
        question: 'Continue?',
        options: [{ label: 'Yes' }, { label: 'No' }]
      }
      h.bus.publish(
        envelope(
          {
            type: 'question.asked',
            question: {
              id: 'q1',
              sessionId: id,
              messageId: 'm1',
              toolCallId: 'call-q',
              header: question.header,
              question: question.question,
              options: question.options,
              multiple: false,
              allowCustom: true,
              createdAt: '2026-01-01T00:00:00.000Z'
            }
          },
          1
        )
      )
      await new Promise<void>((resolve) => {
        release = resolve
      })
      h.bus.publish(
        envelope({ type: 'run.finished', sessionId: id, messageId: 'm1', status: 'completed' }, 2)
      )
    }
    h.runtime.replyQuestion = (id: string, answer: QuestionAnswer) => {
      h.runtime.questionAnswers.push({ id, answer })
      release?.()
    }
    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'ask' }] }
    })

    const request = await h.next((message) => message.method === 'elicitation/create')
    expect(request.params).toMatchObject({
      sessionId,
      mode: 'form',
      message: 'Pick: Continue?',
      requestedSchema: { required: ['answer'] }
    })
    h.send({
      jsonrpc: '2.0',
      id: request.id,
      result: { action: 'accept', content: { answer: 'Yes' } }
    })

    expect(await h.next((message) => message.id === 3)).toMatchObject({
      result: { stopReason: 'end_turn' }
    })
    expect(h.runtime.questionAnswers).toEqual([
      { id: 'q1', answer: { selected: ['Yes'], custom: null, cancelled: false } }
    ])
  })

  it('rejects loading a session from a different directory', async () => {
    harness = createHarness()
    const h = harness
    h.runtime.sessions = [
      makeSession({ id: 'moved-session', title: 'Moved', directory: '/tmp/project' })
    ]
    h.send(INITIALIZE)
    await h.next((message) => message.id === 1)
    h.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/load',
      params: { sessionId: 'moved-session', cwd: '/tmp/other', mcpServers: [] }
    })

    const response = await h.next((message) => message.id === 2)
    expect(response.error).toMatchObject({
      code: -32602,
      message: 'Session belongs to a different directory'
    })
  })

  it('accepts image prompt blocks as attachments', async () => {
    harness = createHarness()
    const h = harness
    const sessionId = await openSession(h)
    h.runtime.onChat = async (id) => {
      h.bus.publish(
        envelope({ type: 'run.finished', sessionId: id, messageId: 'm1', status: 'completed' }, 1)
      )
    }

    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId,
        prompt: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', mimeType: 'image/png', data: 'AQID' }
        ]
      }
    })

    expect(await h.next((message) => message.id === 3)).toMatchObject({
      result: { stopReason: 'end_turn' }
    })
    expect(h.runtime.attachments).toHaveLength(1)
    expect(h.runtime.sentAttachments[0]).toEqual(h.runtime.attachments)
  })

  it('registers client-provided MCP servers for the session', async () => {
    harness = createHarness()
    const h = harness
    h.send(INITIALIZE)
    await h.next((message) => message.id === 1)
    h.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: {
        cwd: '/tmp/project',
        mcpServers: [
          {
            name: 'filesystem',
            command: '/tmp/mcp-filesystem',
            args: ['--root', '/tmp'],
            env: [{ name: 'TOKEN', value: 'secret' }]
          }
        ]
      }
    })
    await h.next((message) => message.id === 2)

    expect(h.runtime.transientMcp.at(-1)).toEqual([
      {
        name: 'filesystem',
        type: 'local',
        command: '/tmp/mcp-filesystem',
        args: ['--root', '/tmp'],
        env: { TOKEN: 'secret' }
      }
    ])
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
