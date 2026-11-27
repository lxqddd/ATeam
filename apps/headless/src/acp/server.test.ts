import { PassThrough } from 'node:stream'
import { createInterface } from 'node:readline'
import type {
  AgentDefinition,
  AgentEvent,
  AgentEventEnvelope,
  ChatMessage,
  McpServerInput,
  MessageAttachment,
  MessagesSnapshot,
  ModelRef,
  PermissionDecision,
  QuestionAnswer,
  QuestionInput,
  RuntimeModelsConfig,
  SessionMeta,
  SessionSettings
} from '@ateam/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { makeMessage, makeSession, makeTextPart } from '@ateam/agent-core/testing'
import { EventBus } from '../server/event-bus'
import { AcpServer, type AcpRuntime } from './server'

interface RpcUpdate {
  sessionUpdate?: string
  [key: string]: unknown
}

interface RpcParams {
  update?: RpcUpdate
  options?: unknown[]
  [key: string]: unknown
}

interface RpcResult {
  sessionId?: string
  stopReason?: string
  [key: string]: unknown
}

interface RpcMessage {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: RpcParams
  result?: RpcResult
  error?: { code?: number; message?: string; [key: string]: unknown }
}

class FakeRuntime implements AcpRuntime {
  session: SessionMeta = makeSession({ id: 'sess-1' })
  sessions: SessionMeta[] = [this.session]
  agents: AgentDefinition[] = []
  messagesById = new Map<string, ChatMessage[]>()
  sent: string[] = []
  sentAttachments: Array<MessageAttachment[] | undefined> = []
  attachments: MessageAttachment[] = []
  transientMcp: McpServerInput[][] = []
  stopped: string[] = []
  decisions: Array<{ id: string; decision: PermissionDecision }> = []
  questionAnswers: Array<{ id: string; answer: QuestionAnswer }> = []
  modelsSet: Array<ModelRef | null> = []
  settingsSet: SessionSettings[] = []
  agentsSet: Array<string | null> = []
  onChat: ((id: string) => Promise<void>) | null = null

  async createSession(): Promise<SessionMeta> {
    return { ...this.session }
  }

  listSessions(): SessionMeta[] {
    return [...this.sessions]
  }

  async listAgents(): Promise<AgentDefinition[]> {
    return [...this.agents]
  }

  async setSessionModel(_id: string, model: ModelRef | null): Promise<SessionMeta> {
    this.modelsSet.push(model)
    Object.assign(this.session, { model })
    return this.session
  }

  async setSessionSettings(_id: string, settings: SessionSettings): Promise<SessionMeta> {
    this.settingsSet.push(settings)
    Object.assign(this.session, settings)
    return this.session
  }

  async setSessionAgent(_id: string, agentId: string | null): Promise<SessionMeta> {
    this.agentsSet.push(agentId)
    Object.assign(this.session, { agent: agentId })
    return this.session
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

  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

function envelope(event: AgentEvent, seq: number): AgentEventEnvelope {
  return { seq, at: new Date().toISOString(), event }
}

const MODELS: RuntimeModelsConfig = {
  providers: [],
  defaultModel: { providerId: 'prov', modelId: 'alpha' },
  models: [
    {
      id: 'model-alpha',
      providerId: 'prov',
      modelId: 'alpha',
      name: 'Alpha',
      createdAt: '2026-01-01T00:00:00.000Z',
      reasoning: true,
      variants: [{ id: 'fast', name: 'Fast', settings: { reasoningEffort: 'low' } }]
    },
    {
      id: 'model-beta',
      providerId: 'prov',
      modelId: 'beta',
      name: 'Beta',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ]
}

function makeAgent(overrides: Partial<AgentDefinition> & { id: string }): AgentDefinition {
  return {
    name: overrides.id,
    description: `${overrides.id} agent`,
    mode: 'primary',
    model: null,
    tools: null,
    permissions: [],
    maxSteps: null,
    temperature: null,
    prompt: '',
    source: 'builtin',
    ...overrides
  }
}

const AGENTS: AgentDefinition[] = [
  makeAgent({ id: 'build', name: 'Build' }),
  makeAgent({ id: 'plan', name: 'Plan' }),
  makeAgent({ id: 'explore', name: 'Explore', mode: 'subagent' })
]

function createHarness(
  options: {
    models?: RuntimeModelsConfig
    agents?: AgentDefinition[]
    session?: Partial<SessionMeta>
  } = {}
): {
  server: AcpServer
  bus: EventBus
  runtime: FakeRuntime
  send: (message: unknown) => void
  sendRaw: (line: string) => void
  next: (predicate?: (message: RpcMessage) => boolean) => Promise<RpcMessage>
} {
  const bus = new EventBus()
  const runtime = new FakeRuntime()
  if (options.session) Object.assign(runtime.session, options.session)
  runtime.agents = options.agents ?? []
  const input = new PassThrough()
  const output = new PassThrough()
  const reader = createInterface({ input: output })
  const messages: RpcMessage[] = []
  const waiters: Array<{
    predicate: (message: RpcMessage) => boolean
    resolve: (message: RpcMessage) => void
  }> = []
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
    ...(options.models ? { models: options.models } : {}),
    input,
    output
  })
  server.start()
  return {
    server,
    bus,
    runtime,
    send: (message) => input.write(`${JSON.stringify(message)}\n`),
    sendRaw: (line) => input.write(`${line}\n`),
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
  const sessionId = response.result?.sessionId
  if (typeof sessionId !== 'string') throw new Error('missing sessionId')
  return sessionId
}

describe('AcpServer', () => {
  it('returns a parse error for malformed JSON', async () => {
    harness = createHarness()
    harness.sendRaw('{not json')

    const response = await harness.next((message) => message.id === null)

    expect(response.error).toMatchObject({ code: -32700 })
  })

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
        message.params?.update?.sessionUpdate === 'user_message_chunk'
    )
    expect(userChunk.params).toMatchObject({
      sessionId: 'old-session',
      update: { messageId: 'm1', content: { type: 'text', text: 'hello' } }
    })
    const agentChunk = await h.next(
      (message) =>
        message.method === 'session/update' &&
        message.params?.update?.sessionUpdate === 'agent_message_chunk'
    )
    expect(agentChunk.params?.update).toMatchObject({
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
    const sessionId = (await h.next((message) => message.id === 2)).result?.sessionId ?? ''
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
      requestedSchema: {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
            oneOf: [
              { const: 'Yes', title: 'Yes' },
              { const: 'No', title: 'No' }
            ]
          },
          answer_custom: { type: 'string' }
        }
      }
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
    expect(update.params?.update).toMatchObject({
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
    expect(request.params?.options).toHaveLength(3)

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

  it('advertises config options and legacy modes on session/new', async () => {
    harness = createHarness({ models: MODELS, agents: AGENTS })
    const h = harness
    h.send(INITIALIZE)
    await h.next((message) => message.id === 1)
    h.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: { cwd: '/tmp/project', mcpServers: [] }
    })
    const response = await h.next((message) => message.id === 2)
    const result = response.result ?? {}
    expect(result.modes).toEqual({
      currentModeId: 'build',
      availableModes: [
        { id: 'build', name: 'Build', description: 'build agent' },
        { id: 'plan', name: 'Plan', description: 'plan agent' }
      ]
    })
    const options = result.configOptions as Array<{
      id: string
      category?: string
      currentValue: string
    }>
    expect(options.map((option) => option.id)).toEqual(['model', 'model_variant', 'effort', 'mode'])
    expect(options.map((option) => option.category)).toEqual([
      'model',
      'model_config',
      'thought_level',
      'mode'
    ])
    expect(options.map((option) => option.currentValue)).toEqual([
      'prov/alpha',
      'default',
      'default',
      'build'
    ])
  })

  it('returns config options when loading a session', async () => {
    harness = createHarness({ models: MODELS, agents: AGENTS })
    const h = harness
    h.runtime.sessions = [makeSession({ id: 'old-session', directory: '/tmp/project' })]
    h.send(INITIALIZE)
    await h.next((message) => message.id === 1)
    h.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/load',
      params: { sessionId: 'old-session', cwd: '/tmp/project', mcpServers: [] }
    })

    const response = await h.next((message) => message.id === 2)
    expect(response.result?.configOptions).toHaveLength(4)
  })

  it('updates the model through session/set_config_option', async () => {
    harness = createHarness({ models: MODELS, agents: AGENTS })
    const h = harness
    const sessionId = await openSession(h)
    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/set_config_option',
      params: { sessionId, configId: 'model', value: 'prov/beta' }
    })

    const response = await h.next((message) => message.id === 3)
    expect(h.runtime.modelsSet).toEqual([{ providerId: 'prov', modelId: 'beta', variant: null }])
    const options = response.result?.configOptions as Array<{
      id: string
      currentValue: string
    }>
    expect(options.find((option) => option.id === 'model')?.currentValue).toBe('prov/beta')
    expect(options.some((option) => option.id === 'model_variant')).toBe(false)
  })

  it('updates the model variant through session/set_config_option', async () => {
    harness = createHarness({ models: MODELS, agents: AGENTS })
    const h = harness
    const sessionId = await openSession(h)
    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/set_config_option',
      params: { sessionId, configId: 'model_variant', value: 'fast' }
    })

    const response = await h.next((message) => message.id === 3)
    expect(h.runtime.modelsSet).toEqual([{ providerId: 'prov', modelId: 'alpha', variant: 'fast' }])
    const options = response.result?.configOptions as Array<{
      id: string
      currentValue: string
    }>
    expect(options.find((option) => option.id === 'model_variant')?.currentValue).toBe('fast')
  })

  it('updates reasoning effort through session/set_config_option', async () => {
    harness = createHarness({ models: MODELS, agents: AGENTS })
    const h = harness
    const sessionId = await openSession(h)
    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/set_config_option',
      params: { sessionId, configId: 'effort', value: 'high' }
    })

    const response = await h.next((message) => message.id === 3)
    expect(h.runtime.settingsSet).toEqual([{ reasoningEffort: 'high', permissionMode: 'ask' }])
    const options = response.result?.configOptions as Array<{
      id: string
      currentValue: string
    }>
    expect(options.find((option) => option.id === 'effort')?.currentValue).toBe('high')
  })

  it('switches the agent mode through session/set_config_option and notifies', async () => {
    harness = createHarness({ models: MODELS, agents: AGENTS })
    const h = harness
    const sessionId = await openSession(h)
    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/set_config_option',
      params: { sessionId, configId: 'mode', value: 'plan' }
    })

    const response = await h.next((message) => message.id === 3)
    expect(h.runtime.agentsSet).toEqual(['plan'])
    const options = response.result?.configOptions as Array<{
      id: string
      currentValue: string
    }>
    expect(options.find((option) => option.id === 'mode')?.currentValue).toBe('plan')
    const update = await h.next(
      (message) =>
        message.method === 'session/update' &&
        message.params?.update?.sessionUpdate === 'current_mode_update'
    )
    expect(update.params?.update).toMatchObject({ currentModeId: 'plan' })
  })

  it('rejects unknown config options and invalid values', async () => {
    harness = createHarness({ models: MODELS, agents: AGENTS })
    const h = harness
    const sessionId = await openSession(h)
    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/set_config_option',
      params: { sessionId, configId: 'nope', value: 'x' }
    })
    expect(await h.next((message) => message.id === 3)).toMatchObject({
      error: { code: -32602, message: 'Unknown config option: nope' }
    })
    h.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'session/set_config_option',
      params: { sessionId, configId: 'model', value: 'prov/missing' }
    })
    expect(await h.next((message) => message.id === 4)).toMatchObject({
      error: { code: -32602, message: 'Invalid value for model: prov/missing' }
    })
  })

  it('switches the mode through session/set_mode', async () => {
    harness = createHarness({ models: MODELS, agents: AGENTS })
    const h = harness
    const sessionId = await openSession(h)
    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/set_mode',
      params: { sessionId, modeId: 'plan' }
    })

    expect(await h.next((message) => message.id === 3)).toMatchObject({ result: {} })
    expect(h.runtime.agentsSet).toEqual(['plan'])
    const update = await h.next(
      (message) =>
        message.method === 'session/update' &&
        message.params?.update?.sessionUpdate === 'current_mode_update'
    )
    expect(update.params?.update).toMatchObject({ currentModeId: 'plan' })
  })

  it('rejects unknown modes', async () => {
    harness = createHarness({ models: MODELS, agents: AGENTS })
    const h = harness
    const sessionId = await openSession(h)
    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/set_mode',
      params: { sessionId, modeId: 'explore' }
    })

    expect(await h.next((message) => message.id === 3)).toMatchObject({
      error: { code: -32602, message: 'Unknown mode: explore' }
    })
  })

  it('sends usage updates and prompt token usage', async () => {
    harness = createHarness({
      models: MODELS,
      agents: AGENTS,
      session: { contextTokens: 120, contextWindow: 1000 }
    })
    const h = harness
    const sessionId = await openSession(h)
    await h.next(
      (message) =>
        message.method === 'session/update' &&
        message.params?.update?.sessionUpdate === 'usage_update'
    )
    h.runtime.messagesById.set(sessionId, [
      makeMessage({ id: 'm1', sessionId, parts: [makeTextPart('a')], costUsd: 0.5 }),
      makeMessage({ id: 'm2', sessionId, parts: [makeTextPart('b')], costUsd: 0.25 })
    ])
    h.runtime.onChat = async (id) => {
      h.bus.publish(
        envelope(
          {
            type: 'run.finished',
            sessionId: id,
            messageId: 'm3',
            status: 'completed',
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              cacheReadTokens: 3
            }
          },
          1
        )
      )
    }

    h.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: { sessionId, prompt: [{ type: 'text', text: 'hi' }] }
    })

    const usage = await h.next(
      (message) =>
        message.method === 'session/update' &&
        message.params?.update?.sessionUpdate === 'usage_update'
    )
    expect(usage.params?.update).toMatchObject({
      used: 120,
      size: 1000,
      cost: { amount: 0.75, currency: 'USD' }
    })
    expect(await h.next((message) => message.id === 3)).toMatchObject({
      result: {
        stopReason: 'end_turn',
        usage: {
          totalTokens: 15,
          inputTokens: 10,
          outputTokens: 5,
          cachedReadTokens: 3
        }
      }
    })
  })

  it('accepts a custom answer next to enumerated options', async () => {
    harness = createHarness()
    const h = harness
    const { sessionId } = await openQuestion(h, {
      header: 'Pick',
      question: 'Continue?',
      options: [{ label: 'Yes' }, { label: 'No' }],
      multiple: false,
      allowCustom: true
    })
    const request = await h.next((message) => message.method === 'elicitation/create')
    expect(request.params?.requestedSchema).toMatchObject({
      properties: {
        answer: {
          oneOf: [
            { const: 'Yes', title: 'Yes' },
            { const: 'No', title: 'No' }
          ]
        },
        answer_custom: { type: 'string' }
      }
    })
    h.send({
      jsonrpc: '2.0',
      id: request.id,
      result: { action: 'accept', content: { answer_custom: 'Possibly' } }
    })

    expect(await h.next((message) => message.id === 3)).toMatchObject({
      result: { stopReason: 'end_turn' }
    })
    expect(h.runtime.questionAnswers).toEqual([
      { id: 'q1', answer: { selected: [], custom: 'Possibly', cancelled: false } }
    ])
    expect(sessionId).toBe('sess-1')
  })

  it('maps multi-select questions to arrays and returns selected labels', async () => {
    harness = createHarness()
    const h = harness
    await openQuestion(h, {
      header: 'Pick',
      question: 'Choose all',
      options: [{ label: 'One' }, { label: 'Two' }],
      multiple: true,
      allowCustom: false
    })
    const request = await h.next((message) => message.method === 'elicitation/create')
    expect(request.params?.requestedSchema).toMatchObject({
      properties: {
        answer: {
          type: 'array',
          items: {
            anyOf: [
              { const: 'One', title: 'One' },
              { const: 'Two', title: 'Two' }
            ]
          }
        }
      },
      required: ['answer']
    })
    h.send({
      jsonrpc: '2.0',
      id: request.id,
      result: { action: 'accept', content: { answer: ['Two'] } }
    })

    expect(await h.next((message) => message.id === 3)).toMatchObject({
      result: { stopReason: 'end_turn' }
    })
    expect(h.runtime.questionAnswers).toEqual([
      { id: 'q1', answer: { selected: ['Two'], custom: null, cancelled: false } }
    ])
  })
})

/** Starts a prompt whose run asks one question; resolves once the prompt is running. */
async function openQuestion(
  h: ReturnType<typeof createHarness>,
  question: Pick<QuestionInput, 'header' | 'question' | 'options'> & {
    multiple: boolean
    allowCustom: boolean
  }
): Promise<{ sessionId: string }> {
  h.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: 1, clientCapabilities: { elicitation: { form: {} } } }
  })
  await h.next((message) => message.id === 1)
  h.send({
    jsonrpc: '2.0',
    id: 2,
    method: 'session/new',
    params: { cwd: '/tmp/project', mcpServers: [] }
  })
  const sessionId = (await h.next((message) => message.id === 2)).result?.sessionId ?? ''
  let release: (() => void) | null = null
  h.runtime.onChat = async (id) => {
    h.bus.publish(
      envelope(
        {
          type: 'question.asked',
          question: {
            id: 'q1',
            sessionId: id,
            messageId: 'm1',
            toolCallId: 'call-q',
            createdAt: '2026-01-01T00:00:00.000Z',
            ...question
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
  return { sessionId }
}
