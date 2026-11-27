import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import type {
  AgentDefinition,
  AgentEventEnvelope,
  McpServerInput,
  ChatMessage,
  MessageAttachment,
  MessagesSnapshot,
  ModelPublic,
  ModelRef,
  PermissionDecision,
  QuestionAnswer,
  QuestionInput,
  ReasoningEffort,
  RuntimeModelsConfig,
  SessionMeta,
  SessionSettings,
  TokenUsage
} from '@ateam/shared'
import type { EventBus } from '../server/event-bus'

export interface AcpRuntime {
  createSession(): Promise<SessionMeta>
  listSessions(): SessionMeta[]
  messages(id: string): MessagesSnapshot
  listAgents?(workspace?: string): Promise<AgentDefinition[]>
  attachImage(sessionId: string, mimeType: string, data: Uint8Array): Promise<MessageAttachment>
  removeAttachment?(sessionId: string, attachmentId: string): Promise<void>
  setTransientMcpServers?(servers: McpServerInput[]): Promise<void>
  setSessionModel?(id: string, model: ModelRef | null): Promise<SessionMeta>
  setSessionSettings?(id: string, settings: SessionSettings): Promise<SessionMeta>
  setSessionAgent?(id: string, agentId: string | null): Promise<SessionMeta>
  sendChat(id: string, text: string, model?: null, attachments?: MessageAttachment[]): Promise<void>
  stopChat(id: string): void
  replyPermission(id: string, decision: PermissionDecision): void
  replyQuestion(id: string, answer: QuestionAnswer): void
  shutdown(): Promise<void>
}

export interface AcpServerOptions {
  createRuntime: (cwd: string, runtimeKey?: string) => Promise<AcpRuntime>
  bus: EventBus
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  /** Models advertised to the client as ACP config options. */
  models?: RuntimeModelsConfig
  version?: string
  configureSession?: (runtime: AcpRuntime, sessionId: string) => Promise<void>
}

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void
  sessionId: string
  permissionId: string
}

interface PendingElicitation {
  runtime: AcpRuntime
  sessionId: string
  questionId: string
  question: QuestionInput
}

interface SessionEntry {
  runtime: AcpRuntime
  cwd: string
  session: SessionMeta
  agents: AgentDefinition[]
}

/** ACP `session/new` / `session/load` config select (session-config-options). */
interface ConfigSelect {
  id: string
  name: string
  description?: string
  category?: string
  type: 'select'
  currentValue: string
  options: Array<{ value: string; name: string; description?: string }>
}

interface SessionModeState {
  currentModeId: string
  availableModes: Array<{ id: string; name: string; description?: string }>
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string }
}

const PROTOCOL_VERSION = 1
const DEFAULT_EFFORT = 'default'
const DEFAULT_VARIANT = 'default'
const EFFORT_VALUES = ['default', 'minimal', 'low', 'medium', 'high'] as const
const EFFORT_LABELS: Record<string, string> = {
  default: 'Default',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High'
}

function questionInputFrom(question: {
  header: string
  question: string
  options: Array<{ label: string; description?: string }>
  multiple?: boolean
  allowCustom?: boolean
}): QuestionInput {
  return {
    header: question.header,
    question: question.question,
    options: question.options,
    multiple: question.multiple,
    allowCustom: question.allowCustom
  }
}

function questionMessage(question: QuestionInput): string {
  return `${question.header}: ${question.question}`
}

function enumOption(option: { label: string; description?: string }): Record<string, string> {
  return {
    const: option.label,
    title: option.label,
    ...(option.description ? { description: option.description } : {})
  }
}

/**
 * Maps a question to an ACP elicitation form schema: options become a single
 * select (`oneOf`) or a multi-select array, and "other" answers get their own
 * free-text field so clients never have to invent a synthetic option.
 */
function questionSchema(question: QuestionInput): Record<string, unknown> {
  const base = { title: question.header, description: question.question }
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  const options = question.options
  const customField = {
    type: 'string',
    title: `${question.header} (other)`,
    description: 'Type your own answer instead of choosing an option.'
  }
  if (question.multiple) {
    properties.answer = {
      type: 'array',
      ...base,
      ...(options.length > 0
        ? { items: { anyOf: options.map(enumOption) } }
        : { items: { type: 'string' } })
    }
    if (question.allowCustom) properties.answer_custom = customField
    else required.push('answer')
  } else if (options.length > 0) {
    properties.answer = { type: 'string', ...base, oneOf: options.map(enumOption) }
    if (question.allowCustom) properties.answer_custom = customField
    else required.push('answer')
  } else {
    properties.answer = { type: 'string', ...base }
    required.push('answer')
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false
  }
}

function answerFromElicitation(
  question: QuestionInput,
  content: Record<string, unknown>
): QuestionAnswer {
  const labels = question.options.map((option) => option.label)
  const matchLabel = (value: string): string | undefined =>
    labels.find((label) => label.toLowerCase() === value.trim().toLowerCase())
  const customText = typeof content.answer_custom === 'string' ? content.answer_custom.trim() : ''
  const raw = content.answer
  const values = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : typeof raw === 'string'
      ? (question.multiple ? raw.split(',') : [raw]).map((item) => item.trim())
      : []
  const cleaned = values.map((item) => item.trim()).filter(Boolean)
  if (question.multiple) {
    const selected: string[] = []
    for (const value of cleaned) {
      selected.push(matchLabel(value) ?? value)
    }
    return { selected, custom: customText || null, cancelled: false }
  }
  const [value] = cleaned
  if (!value) return { selected: [], custom: customText || null, cancelled: false }
  const label = matchLabel(value)
  if (label) return { selected: [label], custom: customText || null, cancelled: false }
  return { selected: [], custom: customText || value, cancelled: false }
}

function modelValue(model: Pick<ModelRef, 'providerId' | 'modelId'>): string {
  return `${model.providerId}/${model.modelId}`
}

function findModel(models: ModelPublic[], value: string): ModelPublic | undefined {
  return models.find((model) => modelValue(model) === value)
}

function usageFromEvent(usage: TokenUsage | undefined): Record<string, number> | null {
  if (!usage) return null
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens
  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    totalTokens === 0 &&
    usage.cacheReadTokens == null &&
    usage.cacheWriteTokens == null
  ) {
    return null
  }
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    ...(usage.cacheReadTokens != null ? { cachedReadTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens != null ? { cachedWriteTokens: usage.cacheWriteTokens } : {})
  }
}

function mcpServersFrom(value: unknown): McpServerInput[] {
  if (!Array.isArray(value)) return []
  const servers: McpServerInput[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Record<string, unknown>
    if (typeof raw.name !== 'string' || !raw.name.trim()) continue
    const args = Array.isArray(raw.args)
      ? raw.args.filter((item): item is string => typeof item === 'string')
      : []
    const env: Record<string, string> = {}
    if (Array.isArray(raw.env)) {
      for (const item of raw.env) {
        if (item && typeof item === 'object') {
          const pair = item as { name?: unknown; value?: unknown }
          if (typeof pair.name === 'string' && typeof pair.value === 'string') {
            env[pair.name] = pair.value
          }
        }
      }
    } else if (raw.env && typeof raw.env === 'object') {
      for (const [key, item] of Object.entries(raw.env)) {
        if (typeof item === 'string') env[key] = item
      }
    }
    const headers: Record<string, string> = {}
    if (raw.headers && typeof raw.headers === 'object') {
      for (const [key, item] of Object.entries(raw.headers)) {
        if (typeof item === 'string') headers[key] = item
      }
    }
    if (typeof raw.command === 'string' && raw.command.trim()) {
      servers.push({
        name: raw.name.trim(),
        type: 'local',
        command: raw.command,
        args,
        env
      })
    } else if (typeof raw.url === 'string' && raw.url.trim()) {
      servers.push({ name: raw.name.trim(), type: 'remote', url: raw.url, headers })
    }
  }
  return servers
}

function textFromPrompt(prompt: unknown): string {
  if (!Array.isArray(prompt)) return ''
  const parts: string[] = []
  for (const block of prompt) {
    if (!block || typeof block !== 'object') continue
    const raw = block as Record<string, unknown>
    if (raw.type === 'text' && typeof raw.text === 'string') parts.push(raw.text)
    if (raw.type === 'resource') {
      const resource = raw.resource as Record<string, unknown> | undefined
      if (resource && typeof resource.text === 'string') parts.push(resource.text)
    }
  }
  return parts.join('\n').trim()
}

function stopReason(status: string): string {
  if (status === 'completed') return 'end_turn'
  if (status === 'interrupted') return 'cancelled'
  if (status === 'max-steps') return 'max_turn_requests'
  return 'refusal'
}

function toolKind(name: string): string {
  if (/^(read|list|glob|grep)$/.test(name)) return 'read'
  if (/^(write|edit|patch|notebook_edit)$/.test(name)) return 'edit'
  if (name === 'shell') return 'execute'
  if (/^web(search|fetch)$/.test(name)) return 'fetch'
  if (/^mcp_/.test(name)) return 'other'
  return 'other'
}

export class AcpServer {
  private readonly pendingPermissions = new Map<number | string, PendingPermission>()
  private readonly pendingElicitations = new Map<number | string, PendingElicitation>()
  private elicitationForm = false
  private readonly promptAborts = new Set<AbortController>()
  private readonly sessions = new Map<string, SessionEntry>()
  private readonly seenTools = new Set<string>()
  private readonly sessionMcp = new Map<string, McpServerInput[]>()
  private readonly lineReader: Interface
  private unsubscribe: (() => void) | null = null
  private nextRequestId = 1_000_000
  private closed = false

  constructor(private readonly options: AcpServerOptions) {
    this.lineReader = createInterface({ input: options.input })
  }

  start(): void {
    this.unsubscribe = this.options.bus.subscribe((envelope) => this.handleEvent(envelope))
    this.lineReader.on('line', (line) => {
      void this.handleLine(line)
    })
  }

  async close(): Promise<void> {
    this.closed = true
    this.unsubscribe?.()
    this.lineReader.close()
    for (const entry of this.sessions.values()) {
      await entry.runtime.shutdown().catch(() => undefined)
    }
    for (const abort of this.promptAborts) abort.abort()
    this.promptAborts.clear()
    this.sessions.clear()
    this.sessionMcp.clear()
    this.pendingPermissions.clear()
    this.pendingElicitations.clear()
  }

  private write(message: unknown): void {
    if (this.closed) return
    this.options.output.write(`${JSON.stringify(message)}\n`)
  }

  private respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result })
  }

  private fail(id: number | string | null | undefined, code: number, message: string): void {
    if (id === undefined || id === null) return
    this.write({ jsonrpc: '2.0', id, error: { code, message } })
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim()
    if (!trimmed) return
    let message: JsonRpcRequest
    try {
      message = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      this.write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } })
      return
    }

    if (message.method === undefined) {
      if (message.id !== undefined) this.resolveClientRequest(message)
      return
    }

    try {
      if (message.method === 'initialize') {
        const capabilities = message.params?.clientCapabilities as
          { elicitation?: { form?: unknown } } | undefined
        this.elicitationForm = Boolean(capabilities?.elicitation?.form)
        this.respond(message.id as number, {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: true, audio: false, embeddedContext: true }
          },
          agentInfo: { name: 'ateam', title: 'ATeam', version: this.options.version ?? '0.1.0' }
        })
        return
      }
      if (message.method === 'session/new') {
        await this.createSession(message)
        return
      }
      if (message.method === 'session/load') {
        await this.loadSession(message)
        return
      }
      if (message.method === 'session/prompt') {
        await this.prompt(message)
        return
      }
      if (message.method === 'session/set_config_option') {
        await this.setConfigOption(message)
        return
      }
      if (message.method === 'session/set_mode') {
        await this.setMode(message)
        return
      }
      if (message.method === 'session/cancel') {
        this.cancel(message)
        return
      }
      if (message.id !== undefined) this.fail(message.id, -32601, 'Method not found')
    } catch (error) {
      this.fail(message.id, -32603, error instanceof Error ? error.message : String(error))
    }
  }

  private async createSession(message: JsonRpcRequest): Promise<void> {
    const cwd = message.params?.cwd
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
      this.fail(message.id, -32602, 'cwd must be an absolute path')
      return
    }
    const runtime = await this.options.createRuntime(cwd, randomUUID())
    const created = await runtime.createSession()
    if (this.options.configureSession) {
      await this.options.configureSession(runtime, created.id)
    }
    const session = this.refreshMeta(runtime, created.id) ?? created
    const agents = await this.loadAgents(runtime, cwd)
    this.sessions.set(session.id, { runtime, cwd, session, agents })
    await this.applyMcpServers(runtime, session.id, message.params?.mcpServers)
    this.respond(message.id as number, {
      sessionId: session.id,
      ...this.sessionOptions(session, agents)
    })
    this.emitUsage(runtime, session.id)
  }

  private async loadSession(message: JsonRpcRequest): Promise<void> {
    const cwd = message.params?.cwd
    const sessionId = message.params?.sessionId
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
      this.fail(message.id, -32602, 'cwd must be an absolute path')
      return
    }
    if (typeof sessionId !== 'string') {
      this.fail(message.id, -32602, 'sessionId is required')
      return
    }
    const runtime = await this.options.createRuntime(cwd, sessionId)
    const session = runtime.listSessions().find((candidate) => candidate.id === sessionId)
    if (!session) {
      await runtime.shutdown().catch(() => undefined)
      this.fail(message.id, -32602, 'Unknown session')
      return
    }
    if (session.directory && path.resolve(session.directory) !== path.resolve(cwd)) {
      await runtime.shutdown().catch(() => undefined)
      this.fail(message.id, -32602, 'Session belongs to a different directory')
      return
    }
    const agents = await this.loadAgents(runtime, cwd)
    this.sessions.set(sessionId, { runtime, cwd, session, agents })
    await this.applyMcpServers(runtime, sessionId, message.params?.mcpServers)
    this.replay(runtime.messages(sessionId).messages, sessionId)
    this.respond(message.id as number, this.sessionOptions(session, agents))
    this.emitUsage(runtime, sessionId)
  }

  private async loadAgents(runtime: AcpRuntime, cwd: string): Promise<AgentDefinition[]> {
    if (!runtime.listAgents) return []
    try {
      return await runtime.listAgents(cwd)
    } catch {
      return []
    }
  }

  /** Session options advertised on `session/new` / `session/load`. */
  private sessionOptions(
    session: SessionMeta,
    agents: AgentDefinition[]
  ): { configOptions?: ConfigSelect[]; modes?: SessionModeState } {
    const configOptions = this.configOptions(session, agents)
    const modes = this.modeState(session, agents)
    return {
      ...(configOptions.length > 0 ? { configOptions } : {}),
      ...(modes ? { modes } : {})
    }
  }

  private refreshMeta(runtime: AcpRuntime, sessionId: string): SessionMeta | undefined {
    return runtime.listSessions().find((candidate) => candidate.id === sessionId)
  }

  private primaryAgents(agents: AgentDefinition[]): AgentDefinition[] {
    return agents.filter((agent) => agent.mode === 'primary' || agent.mode === 'all')
  }

  private defaultModeId(agents: AgentDefinition[]): string | null {
    const primary = this.primaryAgents(agents)
    if (primary.length === 0) return null
    return primary.find((agent) => agent.id === 'build')?.id ?? primary[0].id
  }

  private currentModeId(session: SessionMeta, agents: AgentDefinition[]): string | null {
    const primary = this.primaryAgents(agents)
    if (primary.length === 0) return null
    if (session.agent && primary.some((agent) => agent.id === session.agent)) return session.agent
    return this.defaultModeId(agents)
  }

  private modeState(session: SessionMeta, agents: AgentDefinition[]): SessionModeState | null {
    const currentModeId = this.currentModeId(session, agents)
    if (!currentModeId) return null
    return {
      currentModeId,
      availableModes: this.primaryAgents(agents).map((agent) => ({
        id: agent.id,
        name: agent.name,
        ...(agent.description ? { description: agent.description } : {})
      }))
    }
  }

  private currentModel(session: SessionMeta): ModelRef | null {
    const models = this.options.models
    return session.model ?? models?.defaultModel ?? null
  }

  private configOptions(session: SessionMeta, agents: AgentDefinition[]): ConfigSelect[] {
    const models = this.options.models
    const options: ConfigSelect[] = []
    const selected = this.currentModel(session)
    if (models && models.models.length > 0) {
      const selectedModel = selected
        ? models.models.find((model) => modelValue(model) === modelValue(selected))
        : undefined
      const currentValue = modelValue(selectedModel ?? models.models[0])
      options.push({
        id: 'model',
        name: 'Model',
        description: 'Model used for this session',
        category: 'model',
        type: 'select',
        currentValue,
        options: models.models.map((model) => ({
          value: modelValue(model),
          name: model.name,
          description: `${model.providerId}/${model.modelId}`
        }))
      })
      const variants = selectedModel?.variants ?? []
      if (variants.length > 0) {
        const variant = selected?.variant ?? null
        options.push({
          id: 'model_variant',
          name: 'Model Variant',
          description: 'Preset variant for the selected model',
          category: 'model_config',
          type: 'select',
          currentValue:
            variant && variants.some((item) => item.id === variant) ? variant : DEFAULT_VARIANT,
          options: [
            { value: DEFAULT_VARIANT, name: 'Default' },
            ...variants.map((item) => ({
              value: item.id,
              name: item.name,
              ...(item.settings.reasoningEffort
                ? { description: item.settings.reasoningEffort }
                : {})
            }))
          ]
        })
      }
      options.push({
        id: 'effort',
        name: 'Reasoning Effort',
        description: 'Reasoning effort for this session',
        category: 'thought_level',
        type: 'select',
        currentValue: session.reasoningEffort ?? DEFAULT_EFFORT,
        options: EFFORT_VALUES.map((value) => ({ value, name: EFFORT_LABELS[value] ?? value }))
      })
    }
    const mode = this.currentModeId(session, agents)
    if (mode) {
      options.push({
        id: 'mode',
        name: 'Session Mode',
        description: 'Agent mode for this session',
        category: 'mode',
        type: 'select',
        currentValue: mode,
        options: this.primaryAgents(agents).map((agent) => ({
          value: agent.id,
          name: agent.name,
          ...(agent.description ? { description: agent.description } : {})
        }))
      })
    }
    return options
  }

  private async applyMcpServers(
    runtime: AcpRuntime,
    sessionId: string,
    raw: unknown
  ): Promise<void> {
    this.sessionMcp.set(sessionId, mcpServersFrom(raw))
    if (!runtime.setTransientMcpServers) return
    const byName = new Map<string, McpServerInput>()
    for (const [id, entry] of this.sessions) {
      if (entry.runtime !== runtime) continue
      for (const server of this.sessionMcp.get(id) ?? []) byName.set(server.name, server)
    }
    await runtime.setTransientMcpServers([...byName.values()])
  }

  private replay(messages: ChatMessage[], sessionId: string): void {
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === 'text') {
          this.notify('session/update', {
            sessionId,
            update: {
              sessionUpdate: message.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
              messageId: message.id,
              content: { type: 'text', text: part.text }
            }
          })
        } else if (part.type === 'attachment') {
          this.notify('session/update', {
            sessionId,
            update: {
              sessionUpdate: 'user_message_chunk',
              messageId: message.id,
              content: { type: 'text', text: `[attachment: ${part.attachment.name}]` }
            }
          })
        } else if (part.type === 'tool' && message.role === 'assistant') {
          this.notify('session/update', {
            sessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: part.toolCallId,
              title: part.toolName,
              kind: toolKind(part.toolName),
              status:
                part.state === 'completed'
                  ? 'completed'
                  : part.state === 'failed' || part.state === 'denied'
                    ? 'failed'
                    : 'pending',
              rawInput: part.input
            }
          })
          this.notify('session/update', {
            sessionId,
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: part.toolCallId,
              status:
                part.state === 'completed'
                  ? 'completed'
                  : part.state === 'failed' || part.state === 'denied'
                    ? 'failed'
                    : 'pending',
              content:
                part.output || part.error
                  ? [
                      {
                        type: 'content',
                        content: { type: 'text', text: part.output ?? part.error }
                      }
                    ]
                  : []
            }
          })
        }
      }
    }
  }

  private async prompt(message: JsonRpcRequest): Promise<void> {
    const sessionId = message.params?.sessionId
    if (typeof sessionId !== 'string') {
      this.fail(message.id, -32602, 'Unknown session')
      return
    }
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      this.fail(message.id, -32602, 'Unknown session')
      return
    }
    const text = textFromPrompt(message.params?.prompt)
    const imageBlocks: Array<{ mimeType: string; data: Uint8Array }> = []
    for (const block of Array.isArray(message.params?.prompt) ? message.params.prompt : []) {
      if (!block || typeof block !== 'object') continue
      const raw = block as Record<string, unknown>
      if (raw.type !== 'image' || typeof raw.data !== 'string') continue
      const mimeType = typeof raw.mimeType === 'string' ? raw.mimeType : 'image/png'
      if (!mimeType.startsWith('image/')) {
        this.fail(message.id, -32602, `Unsupported image type: ${mimeType}`)
        return
      }
      imageBlocks.push({ mimeType, data: Buffer.from(raw.data, 'base64') })
    }
    if (!text && imageBlocks.length === 0) {
      this.fail(message.id, -32602, 'Prompt contains no text or image content')
      return
    }
    const images: MessageAttachment[] = []
    for (const block of imageBlocks) {
      try {
        images.push(await entry.runtime.attachImage(sessionId, block.mimeType, block.data))
      } catch (error) {
        for (const saved of images) {
          await entry.runtime.removeAttachment?.(sessionId, saved.id).catch(() => undefined)
        }
        this.fail(message.id, -32602, error instanceof Error ? error.message : String(error))
        return
      }
    }

    const abort = new AbortController()
    this.promptAborts.add(abort)
    const finished = this.options.bus.waitFor(
      'run.finished',
      (event) => event.type === 'run.finished' && event.sessionId === sessionId,
      30 * 60_000,
      abort.signal
    )
    try {
      await entry.runtime.sendChat(sessionId, text, undefined, images)
    } catch (error) {
      abort.abort()
      await finished.catch(() => undefined)
      for (const saved of images) {
        await entry.runtime.removeAttachment?.(sessionId, saved.id).catch(() => undefined)
      }
      this.fail(message.id, -32603, error instanceof Error ? error.message : String(error))
      return
    }
    let envelope
    try {
      envelope = await finished
    } finally {
      this.promptAborts.delete(abort)
    }
    const event = envelope.event
    if (event.type === 'run.finished') {
      entry.session = this.refreshMeta(entry.runtime, sessionId) ?? entry.session
      this.emitUsage(entry.runtime, sessionId)
    }
    const usage = event.type === 'run.finished' ? usageFromEvent(event.usage) : null
    this.respond(message.id as number, {
      stopReason: event.type === 'run.finished' ? stopReason(event.status) : 'end_turn',
      ...(usage ? { usage } : {})
    })
  }

  /** Sends ACP `usage_update` when the runtime reports context usage for a session. */
  private emitUsage(runtime: AcpRuntime, sessionId: string): void {
    const session = this.refreshMeta(runtime, sessionId)
    if (!session || session.contextTokens == null || session.contextWindow == null) return
    if (session.contextWindow <= 0) return
    let costUsd = 0
    for (const message of runtime.messages(sessionId).messages) {
      if (message.costUsd) costUsd += message.costUsd
    }
    this.notify('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'usage_update',
        used: session.contextTokens,
        size: session.contextWindow,
        ...(costUsd > 0
          ? { cost: { amount: Math.round(costUsd * 1e6) / 1e6, currency: 'USD' } }
          : {})
      }
    })
  }

  private cancel(message: JsonRpcRequest): void {
    const sessionId = message.params?.sessionId
    if (typeof sessionId !== 'string') return
    const entry = this.sessions.get(sessionId)
    entry?.runtime.stopChat(sessionId)
  }

  private async setConfigOption(message: JsonRpcRequest): Promise<void> {
    const sessionId = message.params?.sessionId
    const entry = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined
    if (!entry || typeof sessionId !== 'string') {
      this.fail(message.id, -32602, 'Unknown session')
      return
    }
    const configId = message.params?.configId
    const value = message.params?.value
    if (typeof configId !== 'string' || typeof value !== 'string') {
      this.fail(message.id, -32602, 'configId and a string value are required')
      return
    }
    const configOptions = this.configOptions(entry.session, entry.agents)
    const option = configOptions.find((candidate) => candidate.id === configId)
    if (!option) {
      this.fail(message.id, -32602, `Unknown config option: ${configId}`)
      return
    }
    if (!option.options.some((candidate) => candidate.value === value)) {
      this.fail(message.id, -32602, `Invalid value for ${configId}: ${value}`)
      return
    }
    let modeChanged = false
    try {
      switch (configId) {
        case 'model': {
          const models = this.options.models
          const model = models ? findModel(models.models, value) : undefined
          if (!model) throw new Error(`Unknown model: ${value}`)
          if (!entry.runtime.setSessionModel) throw new Error('Model changes are not supported')
          const previous = entry.session.model
          const variant =
            previous &&
            previous.providerId === model.providerId &&
            previous.modelId === model.modelId &&
            previous.variant &&
            model.variants?.some((item) => item.id === previous.variant)
              ? previous.variant
              : null
          entry.session = await entry.runtime.setSessionModel(sessionId, {
            providerId: model.providerId,
            modelId: model.modelId,
            variant
          })
          break
        }
        case 'model_variant': {
          const current = entry.session.model ?? this.currentModel(entry.session)
          if (!current) throw new Error('No model selected')
          if (!entry.runtime.setSessionModel) throw new Error('Model changes are not supported')
          entry.session = await entry.runtime.setSessionModel(sessionId, {
            ...current,
            variant: value === DEFAULT_VARIANT ? null : value
          })
          break
        }
        case 'effort': {
          if (!entry.runtime.setSessionSettings) throw new Error('Settings are not supported')
          entry.session = await entry.runtime.setSessionSettings(sessionId, {
            reasoningEffort: value === DEFAULT_EFFORT ? null : (value as ReasoningEffort),
            permissionMode: entry.session.permissionMode
          })
          break
        }
        case 'mode': {
          if (!entry.runtime.setSessionAgent) throw new Error('Modes are not supported')
          entry.session = await entry.runtime.setSessionAgent(sessionId, value)
          modeChanged = true
          break
        }
        default:
          throw new Error(`Unknown config option: ${configId}`)
      }
    } catch (error) {
      this.fail(message.id, -32602, error instanceof Error ? error.message : String(error))
      return
    }
    this.respond(message.id as number, {
      configOptions: this.configOptions(entry.session, entry.agents)
    })
    if (modeChanged) this.notifyCurrentMode(sessionId, entry)
  }

  private async setMode(message: JsonRpcRequest): Promise<void> {
    const sessionId = message.params?.sessionId
    const entry = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined
    if (!entry || typeof sessionId !== 'string') {
      this.fail(message.id, -32602, 'Unknown session')
      return
    }
    const modeId = message.params?.modeId
    if (typeof modeId !== 'string') {
      this.fail(message.id, -32602, 'modeId is required')
      return
    }
    const mode = this.modeState(entry.session, entry.agents)
    if (!mode?.availableModes.some((candidate) => candidate.id === modeId)) {
      this.fail(message.id, -32602, `Unknown mode: ${modeId}`)
      return
    }
    if (!entry.runtime.setSessionAgent) {
      this.fail(message.id, -32603, 'Modes are not supported')
      return
    }
    try {
      entry.session = await entry.runtime.setSessionAgent(sessionId, modeId)
    } catch (error) {
      this.fail(message.id, -32602, error instanceof Error ? error.message : String(error))
      return
    }
    this.respond(message.id as number, {})
    this.notifyCurrentMode(sessionId, entry)
  }

  private notifyCurrentMode(sessionId: string, entry: SessionEntry): void {
    const mode = this.modeState(entry.session, entry.agents)
    if (!mode) return
    this.notify('session/update', {
      sessionId,
      update: { sessionUpdate: 'current_mode_update', currentModeId: mode.currentModeId }
    })
    this.notify('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'config_option_update',
        configOptions: this.configOptions(entry.session, entry.agents)
      }
    })
  }

  private resolveClientRequest(message: JsonRpcRequest): void {
    if (message.id === undefined || message.id === null) return
    const pending = this.pendingPermissions.get(message.id)
    if (pending) {
      this.pendingPermissions.delete(message.id)
      const result = message.result as
        | {
            outcome?: { outcome?: string; optionId?: string }
          }
        | undefined
      if (message.error || !result?.outcome || result.outcome.outcome === 'cancelled') {
        try {
          pending.resolve('reject')
        } catch {
          /* the permission may already have timed out */
        }
        return
      }
      const optionId = result.outcome.optionId
      try {
        pending.resolve(
          optionId === 'allow-always' ? 'always' : optionId === 'allow-once' ? 'once' : 'reject'
        )
      } catch {
        /* the permission may already have timed out */
      }
      return
    }
    const elicitation = this.pendingElicitations.get(message.id)
    if (!elicitation) return
    this.pendingElicitations.delete(message.id)
    const result = message.result as { action?: string; content?: unknown } | undefined
    if (message.error || result?.action !== 'accept') {
      try {
        elicitation.runtime.replyQuestion(elicitation.questionId, {
          selected: [],
          custom: null,
          cancelled: true
        })
      } catch {
        /* the question may already have timed out */
      }
      return
    }
    const content =
      result.content && typeof result.content === 'object'
        ? (result.content as Record<string, unknown>)
        : {}
    try {
      elicitation.runtime.replyQuestion(
        elicitation.questionId,
        answerFromElicitation(elicitation.question, content)
      )
    } catch {
      /* the question may already have timed out */
    }
  }

  private handleEvent(envelope: AgentEventEnvelope): void {
    const event = envelope.event
    if (event.type === 'message.part.delta' && event.kind === 'text') {
      if (!this.sessions.has(event.sessionId)) return
      this.notify('session/update', {
        sessionId: event.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: event.delta }
        }
      })
      return
    }

    if (event.type === 'message.part.upsert' && event.part.type === 'tool') {
      if (!this.sessions.has(event.sessionId)) return
      const part = event.part
      const key = `${event.sessionId}:${part.toolCallId}`
      if (!this.seenTools.has(key)) {
        this.seenTools.add(key)
        this.notify('session/update', {
          sessionId: event.sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: part.toolCallId,
            title: part.toolName,
            kind: toolKind(part.toolName),
            status: part.state === 'running' ? 'in_progress' : 'pending',
            rawInput: part.input
          }
        })
        return
      }
      if (part.state === 'running') {
        this.notify('session/update', {
          sessionId: event.sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: part.toolCallId,
            status: 'in_progress'
          }
        })
      } else if (part.state === 'completed') {
        this.notify('session/update', {
          sessionId: event.sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: part.toolCallId,
            status: 'completed',
            content: part.output
              ? [{ type: 'content', content: { type: 'text', text: part.output } }]
              : []
          }
        })
      } else if (part.state === 'failed' || part.state === 'denied') {
        this.notify('session/update', {
          sessionId: event.sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: part.toolCallId,
            status: 'failed',
            content: part.error
              ? [{ type: 'content', content: { type: 'text', text: part.error } }]
              : []
          }
        })
      }
      return
    }

    if (event.type === 'permission.asked') {
      const session = this.sessions.get(event.permission.sessionId)
      if (!session) return
      const id = this.nextRequestId++
      this.pendingPermissions.set(id, {
        resolve: (decision) => session.runtime.replyPermission(event.permission.id, decision),
        sessionId: event.permission.sessionId,
        permissionId: event.permission.id
      })
      this.write({
        jsonrpc: '2.0',
        id,
        method: 'session/request_permission',
        params: {
          sessionId: event.permission.sessionId,
          toolCall: { toolCallId: event.permission.toolCallId },
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }
          ]
        }
      })
      return
    }

    if (event.type === 'permission.replied') {
      for (const [id, entry] of this.pendingPermissions) {
        if (entry.permissionId === event.requestId) this.pendingPermissions.delete(id)
      }
      return
    }

    if (event.type === 'question.replied') {
      for (const [id, entry] of this.pendingElicitations) {
        if (entry.questionId === event.questionId) this.pendingElicitations.delete(id)
      }
      return
    }

    if (event.type === 'run.finished') {
      for (const [id, entry] of this.pendingPermissions) {
        if (entry.sessionId === event.sessionId) this.pendingPermissions.delete(id)
      }
      for (const [id, entry] of this.pendingElicitations) {
        if (entry.sessionId === event.sessionId) this.pendingElicitations.delete(id)
      }
      return
    }

    if (event.type === 'question.asked') {
      const session = this.sessions.get(event.question.sessionId)
      if (!session) return
      if (!this.elicitationForm) {
        session.runtime.replyQuestion(event.question.id, {
          selected: [],
          custom: null,
          cancelled: true
        })
        return
      }
      const id = this.nextRequestId++
      const question = questionInputFrom(event.question)
      this.pendingElicitations.set(id, {
        runtime: session.runtime,
        sessionId: event.question.sessionId,
        questionId: event.question.id,
        question
      })
      this.write({
        jsonrpc: '2.0',
        id,
        method: 'elicitation/create',
        params: {
          sessionId: event.question.sessionId,
          toolCallId: event.question.toolCallId,
          mode: 'form',
          message: questionMessage(question),
          requestedSchema: questionSchema(question)
        }
      })
    }
  }
}
