import path from 'node:path'
import { createInterface, type Interface } from 'node:readline'
import type {
  AgentEventEnvelope,
  McpServerInput,
  ChatMessage,
  MessageAttachment,
  MessagesSnapshot,
  PermissionDecision,
  QuestionInput,
  SessionMeta
} from '@ateam/shared'
import type { EventBus } from '../server/event-bus'

export interface AcpRuntime {
  createSession(): Promise<SessionMeta>
  listSessions(): SessionMeta[]
  messages(id: string): MessagesSnapshot
  attachImage(sessionId: string, mimeType: string, data: Uint8Array): Promise<MessageAttachment>
  setTransientMcpServers?(servers: McpServerInput[]): Promise<void>
  sendChat(id: string, text: string, model?: null, attachments?: MessageAttachment[]): Promise<void>
  stopChat(id: string): void
  replyPermission(id: string, decision: PermissionDecision): void
  replyQuestion(id: string, answer: import('@ateam/shared').QuestionAnswer): void
  shutdown(): Promise<void>
}

export interface AcpServerOptions {
  createRuntime: (cwd: string) => Promise<AcpRuntime>
  bus: EventBus
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  version?: string
  configureSession?: (runtime: AcpRuntime, sessionId: string) => Promise<void>
}

interface PendingPermission {
  resolve: (decision: PermissionDecision) => void
}

interface PendingElicitation {
  runtime: AcpRuntime
  questionId: string
  question: QuestionInput
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

function questionDescription(question: QuestionInput): string {
  const options = question.options
    .map((option) => option.label + (option.description ? ` — ${option.description}` : ''))
    .join('; ')
  return [options, question.multiple ? 'Separate multiple choices with commas.' : '']
    .filter(Boolean)
    .join(' ')
}

function questionMessage(question: QuestionInput): string {
  return `${question.header}: ${question.question}`
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
  private readonly sessions = new Map<string, { runtime: AcpRuntime; cwd: string }>()
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
      this.fail(null, -32700, 'Invalid JSON')
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
    const runtime = await this.options.createRuntime(cwd)
    const session = await runtime.createSession()
    if (this.options.configureSession) {
      await this.options.configureSession(runtime, session.id)
    }
    this.sessions.set(session.id, { runtime, cwd })
    await this.applyMcpServers(runtime, session.id, message.params?.mcpServers)
    this.respond(message.id as number, { sessionId: session.id })
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
    const runtime = await this.options.createRuntime(cwd)
    if (!runtime.listSessions().some((session) => session.id === sessionId)) {
      this.fail(message.id, -32602, 'Unknown session')
      return
    }
    this.sessions.set(sessionId, { runtime, cwd })
    await this.applyMcpServers(runtime, sessionId, message.params?.mcpServers)
    this.replay(runtime.messages(sessionId).messages, sessionId)
    this.respond(message.id as number, {})
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
        }
      }
    }
  }

  private async prompt(message: JsonRpcRequest): Promise<void> {
    const sessionId = message.params?.sessionId
    const entry = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined
    if (!entry) {
      this.fail(message.id, -32602, 'Unknown session')
      return
    }
    const text = textFromPrompt(message.params?.prompt)
    const images: MessageAttachment[] = []
    for (const block of Array.isArray(message.params?.prompt) ? message.params.prompt : []) {
      if (!block || typeof block !== 'object') continue
      const raw = block as Record<string, unknown>
      if (raw.type !== 'image' || typeof raw.data !== 'string') continue
      const mimeType = typeof raw.mimeType === 'string' ? raw.mimeType : 'image/png'
      try {
        images.push(
          await entry.runtime.attachImage(sessionId, mimeType, Buffer.from(raw.data, 'base64'))
        )
      } catch (error) {
        this.fail(message.id, -32602, error instanceof Error ? error.message : String(error))
        return
      }
    }
    if (!text && images.length === 0) {
      this.fail(message.id, -32602, 'Prompt contains no text or image content')
      return
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
    this.respond(message.id as number, {
      stopReason: event.type === 'run.finished' ? stopReason(event.status) : 'end_turn'
    })
  }

  private cancel(message: JsonRpcRequest): void {
    const sessionId = message.params?.sessionId
    if (typeof sessionId !== 'string') return
    const entry = this.sessions.get(sessionId)
    entry?.runtime.stopChat(sessionId)
  }

  private resolveClientRequest(message: JsonRpcRequest): void {
    if (message.id === undefined) return
    const pending = this.pendingPermissions.get(message.id)
    if (pending) {
      this.pendingPermissions.delete(message.id)
      const result = message.result as
        | {
            outcome?: { outcome?: string; optionId?: string }
          }
        | undefined
      if (message.error || !result?.outcome || result.outcome.outcome === 'cancelled') {
        pending.resolve('reject')
        return
      }
      const optionId = result.outcome.optionId
      pending.resolve(
        optionId === 'allow-always' ? 'always' : optionId === 'allow-once' ? 'once' : 'reject'
      )
      return
    }
    const elicitation = this.pendingElicitations.get(message.id)
    if (!elicitation) return
    this.pendingElicitations.delete(message.id)
    const result = message.result as { action?: string; content?: { answer?: unknown } } | undefined
    if (message.error || result?.action !== 'accept') {
      elicitation.runtime.replyQuestion(elicitation.questionId, {
        selected: [],
        custom: null,
        cancelled: true
      })
      return
    }
    const answer = typeof result.content?.answer === 'string' ? result.content.answer.trim() : ''
    const labels = elicitation.question.options.map((option) => option.label)
    let selected = labels.filter((label) => label.toLowerCase() === answer.toLowerCase())
    if (elicitation.question.multiple && answer) {
      selected = labels.filter((label) =>
        answer
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .includes(label.toLowerCase())
      )
    }
    elicitation.runtime.replyQuestion(elicitation.questionId, {
      selected,
      custom:
        answer && !labels.some((label) => label.toLowerCase() === answer.toLowerCase())
          ? answer
          : null,
      cancelled: false
    })
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
        resolve: (decision) => session.runtime.replyPermission(event.permission.id, decision)
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
          requestedSchema: {
            type: 'object',
            properties: {
              answer: {
                type: 'string',
                title: question.header,
                description: questionDescription(question)
              }
            },
            required: ['answer'],
            additionalProperties: false
          }
        }
      })
    }
  }
}
