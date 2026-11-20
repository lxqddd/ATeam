import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { generateText, stepCountIs, streamText } from 'ai'
import type {
  AgentEvent,
  AgentEventEnvelope,
  ChatMessage,
  MessagePart,
  MessagesSnapshot,
  ModelRef,
  PermissionAction,
  PermissionDecision,
  PermissionRequest,
  RunOutcome,
  RuntimeModelsConfig,
  SessionMeta,
  TokenUsage
} from '@ateam/shared'
import { SessionsStore, type SessionRecord } from './sessions-store'
import { buildModelMessages } from './message-history'
import { createLanguageModel, resolveModelRef } from './providers'
import { createTools } from './tools'
import { normalizeError } from './errors'

const MAX_STEPS = 25
const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000

interface Run {
  sessionId: string
  messageId: string
  abort: AbortController
  startedAt: number
  steps: number
  allowed: Set<PermissionAction>
  skipHistoryIds?: Set<string>
}

interface PendingPermission {
  request: PermissionRequest
  run: Run
  resolve: (decision: PermissionDecision) => void
}

export interface AgentRuntimeOptions {
  userDataPath: string
  workspacePath: string
  models: RuntimeModelsConfig
  send: (envelope: AgentEventEnvelope) => void
}

function nowIso(): string {
  return new Date().toISOString()
}

function makeUserMessage(sessionId: string, text: string): ChatMessage {
  const timestamp = nowIso()
  return {
    id: randomUUID(),
    sessionId,
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'complete'
  }
}

function makeAssistantMessage(sessionId: string): ChatMessage {
  const timestamp = nowIso()
  return {
    id: randomUUID(),
    sessionId,
    role: 'assistant',
    parts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'streaming'
  }
}

function usageFrom(total: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}): TokenUsage {
  return {
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    totalTokens: total.totalTokens
  }
}

export class AgentRuntime {
  private readonly store: SessionsStore
  private readonly runs = new Map<string, Run>()
  private readonly pending = new Map<string, PendingPermission>()
  private readonly allowedBySession = new Map<string, Set<PermissionAction>>()
  private models: RuntimeModelsConfig
  private seq = 0

  constructor(private readonly options: AgentRuntimeOptions) {
    this.store = new SessionsStore(options.userDataPath)
    this.models = options.models
  }

  async init(): Promise<void> {
    await fs.mkdir(this.options.workspacePath, { recursive: true })
    await this.store.init()
  }

  listSessions(): SessionMeta[] {
    return this.store.list()
  }

  async createSession(): Promise<SessionMeta> {
    const session = await this.store.create()
    this.emit({ type: 'session.upsert', session })
    return session
  }

  async renameSession(id: string, title: string): Promise<SessionMeta> {
    const session = await this.store.rename(id, title)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.emit({ type: 'session.upsert', session })
    return session
  }

  async setSessionModel(id: string, model: ModelRef | null): Promise<SessionMeta> {
    if (model) resolveModelRef(this.models, model)
    const session = await this.store.setModel(id, model)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.emit({ type: 'session.upsert', session })
    return session
  }

  async deleteSession(id: string): Promise<void> {
    const run = this.runs.get(id)
    if (run) {
      run.abort.abort()
      this.rejectPendingForRun(run)
    }
    await this.store.delete(id)
    this.allowedBySession.delete(id)
    this.emit({ type: 'session.deleted', sessionId: id })
  }

  messages(id: string): MessagesSnapshot {
    const messages = this.store.getMessages(id)
    if (!messages) throw new Error('SESSION_NOT_FOUND')
    return {
      sessionId: id,
      seq: this.seq,
      messages,
      running: this.runs.has(id)
    }
  }

  setModels(models: RuntimeModelsConfig): void {
    this.models = models
    for (const session of this.store.list()) {
      if (!session.model) continue
      try {
        resolveModelRef(models, session.model)
      } catch {
        const record = this.store.get(session.id)
        if (!record) continue
        record.session.model = null
        record.session.updatedAt = nowIso()
        void this.store.persist(session.id)
        this.emit({ type: 'session.upsert', session: structuredClone(record.session) })
      }
    }
  }

  async sendChat(sessionId: string, text: string, requestedModel?: ModelRef | null): Promise<void> {
    const content = text.trim()
    if (!content) throw new Error('EMPTY_MESSAGE')
    if (this.runs.has(sessionId)) throw new Error('SESSION_BUSY')

    const record = this.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')

    const target = requestedModel ?? record.session.model ?? this.models.defaultModel
    resolveModelRef(this.models, target)

    if (requestedModel) {
      record.session.model = requestedModel
    }

    const user = makeUserMessage(sessionId, content)
    const assistant = makeAssistantMessage(sessionId)
    await this.store.appendMessage(sessionId, user)
    await this.store.appendMessage(sessionId, assistant)
    await this.store.setStatus(sessionId, 'running')

    this.emit({ type: 'message.upsert', message: structuredClone(user) })
    this.beginRun(sessionId, assistant)
  }

  private beginRun(sessionId: string, assistant: ChatMessage, skipHistoryIds?: Set<string>): void {
    this.emit({ type: 'message.upsert', message: structuredClone(assistant) })
    this.emitSession(sessionId)
    this.emit({
      type: 'run.started',
      sessionId,
      messageId: assistant.id,
      startedAt: nowIso()
    })

    const allowed = this.allowedBySession.get(sessionId) ?? new Set<PermissionAction>()
    this.allowedBySession.set(sessionId, allowed)

    const run: Run = {
      sessionId,
      messageId: assistant.id,
      abort: new AbortController(),
      startedAt: Date.now(),
      steps: 0,
      allowed,
      skipHistoryIds
    }
    this.runs.set(sessionId, run)
    void this.runAgent(run)
  }

  stopChat(sessionId: string): void {
    const run = this.runs.get(sessionId)
    if (!run) return
    run.abort.abort()
    this.rejectPendingForRun(run)
  }

  async retryChat(sessionId: string): Promise<void> {
    const record = this.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    if (this.runs.has(sessionId)) throw new Error('SESSION_BUSY')

    const last = record.messages[record.messages.length - 1]
    if (
      !last ||
      last.role !== 'assistant' ||
      (last.status !== 'error' && last.status !== 'interrupted')
    ) {
      throw new Error('NOTHING_TO_RETRY')
    }
    const lastUser = [...record.messages].reverse().find((message) => message.role === 'user')
    if (!lastUser) throw new Error('NOTHING_TO_RETRY')

    resolveModelRef(this.models, record.session.model ?? this.models.defaultModel)
    const assistant = makeAssistantMessage(sessionId)
    await this.store.appendMessage(sessionId, assistant)
    await this.store.setStatus(sessionId, 'running')
    this.beginRun(sessionId, assistant, new Set([last.id]))
  }

  permissions(): PermissionRequest[] {
    return [...this.pending.values()].map((entry) => structuredClone(entry.request))
  }

  replyPermission(requestId: string, decision: PermissionDecision): void {
    const entry = this.pending.get(requestId)
    if (!entry) throw new Error('PERMISSION_NOT_FOUND')
    entry.resolve(decision)

    if (decision === 'always') {
      const siblings = [...this.pending.values()].filter(
        (other) =>
          other !== entry &&
          other.run === entry.run &&
          other.request.action === entry.request.action
      )
      for (const sibling of siblings) {
        sibling.resolve('always')
      }
    }
  }

  async testModel(
    providerId: string,
    modelId: string
  ): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    const start = Date.now()
    try {
      const model = createLanguageModel(this.models, { providerId, modelId })
      await generateText({
        model,
        prompt: 'Reply with OK',
        maxOutputTokens: 8,
        abortSignal: AbortSignal.timeout(20_000)
      })
      return { ok: true, message: 'Connection succeeded', latencyMs: Date.now() - start }
    } catch (error) {
      return { ok: false, message: normalizeError(error) }
    }
  }

  async shutdown(): Promise<void> {
    for (const run of this.runs.values()) {
      run.abort.abort()
      this.rejectPendingForRun(run)
    }
    await this.store.flush()
  }

  private emitSession(sessionId: string): void {
    const session = this.store.getSession(sessionId)
    if (session) this.emit({ type: 'session.upsert', session })
  }

  private emit(event: AgentEvent): void {
    this.seq += 1
    this.options.send({ seq: this.seq, at: nowIso(), event })
  }

  private record(sessionId: string): SessionRecord {
    const record = this.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    return record
  }

  private assistantFor(run: Run): ChatMessage {
    const record = this.record(run.sessionId)
    const message = record.messages.find((candidate) => candidate.id === run.messageId)
    if (!message) throw new Error('MESSAGE_NOT_FOUND')
    return message
  }

  private findToolPart(message: ChatMessage, toolCallId: string): MessagePart | undefined {
    return message.parts.find((part) => part.type === 'tool' && part.toolCallId === toolCallId)
  }

  private ensureToolPart(
    message: ChatMessage,
    toolCallId: string,
    toolName: string
  ): Extract<MessagePart, { type: 'tool' }> {
    const existing = this.findToolPart(message, toolCallId)
    if (existing && existing.type === 'tool') return existing
    const part: Extract<MessagePart, { type: 'tool' }> = {
      type: 'tool',
      toolCallId,
      toolName,
      state: 'pending',
      startedAt: nowIso()
    }
    message.parts.push(part)
    return part
  }

  private emitPart(run: Run, part: MessagePart, index: number): void {
    this.emit({
      type: 'message.part.upsert',
      sessionId: run.sessionId,
      messageId: run.messageId,
      partIndex: index,
      part: structuredClone(part)
    })
  }

  private async askPermission(
    run: Run,
    action: PermissionAction,
    resource: string,
    toolName: string,
    toolCallId: string
  ): Promise<boolean> {
    if (run.allowed.has(action)) return true

    const message = this.assistantFor(run)
    const part = this.ensureToolPart(message, toolCallId, toolName)
    part.state = 'awaiting-approval'
    this.emitPart(run, part, message.parts.indexOf(part))
    await this.store.setStatus(run.sessionId, 'waiting-permission')
    this.emitSession(run.sessionId)

    const request: PermissionRequest = {
      id: randomUUID(),
      sessionId: run.sessionId,
      messageId: run.messageId,
      toolCallId,
      action,
      resource,
      toolName,
      createdAt: nowIso()
    }

    const decision = await new Promise<PermissionDecision>((resolve) => {
      let settled = false
      const finish = (value: PermissionDecision): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        run.abort.signal.removeEventListener('abort', onAbort)
        this.pending.delete(request.id)
        resolve(value)
      }
      const onAbort = (): void => finish('reject')
      const timeout = setTimeout(() => finish('reject'), PERMISSION_TIMEOUT_MS)
      this.pending.set(request.id, { request, run, resolve: finish })
      run.abort.signal.addEventListener('abort', onAbort, { once: true })
      this.emit({ type: 'permission.asked', permission: structuredClone(request) })
    })

    if (decision === 'always') run.allowed.add(action)
    const current = this.findToolPart(message, toolCallId)
    if (current && current.type === 'tool') {
      current.state = decision === 'reject' ? 'denied' : 'running'
      current.error = decision === 'reject' ? 'Permission denied by user' : undefined
      current.finishedAt = decision === 'reject' ? nowIso() : undefined
      this.emitPart(run, current, message.parts.indexOf(current))
    }
    this.emit({
      type: 'permission.replied',
      sessionId: run.sessionId,
      requestId: request.id,
      decision
    })
    await this.store.setStatus(run.sessionId, 'running')
    this.emitSession(run.sessionId)
    await this.store.persist(run.sessionId)
    return decision !== 'reject'
  }

  private rejectPendingForRun(run: Run): void {
    for (const [id, entry] of this.pending) {
      if (entry.run !== run) continue
      entry.resolve('reject')
      this.pending.delete(id)
    }
  }

  private settleTools(message: ChatMessage, reason: string): void {
    for (const part of message.parts) {
      if (
        part.type === 'tool' &&
        (part.state === 'pending' || part.state === 'running' || part.state === 'awaiting-approval')
      ) {
        part.state = 'failed'
        part.error = reason
        part.finishedAt = nowIso()
      }
    }
  }

  private async runAgent(run: Run): Promise<void> {
    const message = this.assistantFor(run)
    let persistTimer: NodeJS.Timeout | null = null
    let lastPersist = 0
    const schedulePersist = (): void => {
      if (persistTimer) return
      const wait = Math.max(0, 1_000 - (Date.now() - lastPersist))
      persistTimer = setTimeout(() => {
        persistTimer = null
        lastPersist = Date.now()
        message.updatedAt = nowIso()
        void this.store.persist(run.sessionId)
      }, wait)
    }

    const textParts = new Map<string, number>()
    const reasoningParts = new Map<string, number>()
    let usage: TokenUsage | undefined
    let finishReason = ''

    try {
      const record = this.record(run.sessionId)
      const model = createLanguageModel(
        this.models,
        record.session.model ?? this.models.defaultModel
      )
      const tools = createTools({
        workspace: this.options.workspacePath,
        signal: run.abort.signal,
        askPermission: (action, resource, toolName, toolCallId) =>
          this.askPermission(run, action, resource, toolName, toolCallId)
      })

      const result = streamText({
        model,
        system: buildSystemPrompt(this.options.workspacePath),
        messages: buildModelMessages(
          record.messages.filter(
            (item) => item.id !== message.id && !run.skipHistoryIds?.has(item.id)
          )
        ),
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal: run.abort.signal,
        maxRetries: 1,
        maxOutputTokens: 8_192,
        onError: () => undefined
      })

      for await (const part of result.stream) {
        switch (part.type) {
          case 'text-start': {
            const index = message.parts.length
            message.parts.push({ type: 'text', text: '' })
            textParts.set(part.id, index)
            this.emitPart(run, message.parts[index], index)
            break
          }
          case 'text-delta': {
            const index = textParts.get(part.id)
            if (index === undefined) break
            const textPart = message.parts[index]
            if (textPart?.type !== 'text') break
            textPart.text += part.text
            message.updatedAt = nowIso()
            this.emit({
              type: 'message.part.delta',
              sessionId: run.sessionId,
              messageId: message.id,
              partIndex: index,
              kind: 'text',
              delta: part.text
            })
            schedulePersist()
            break
          }
          case 'text-end':
            textParts.delete(part.id)
            break
          case 'reasoning-start': {
            const index = message.parts.length
            message.parts.push({ type: 'reasoning', text: '' })
            reasoningParts.set(part.id, index)
            this.emitPart(run, message.parts[index], index)
            break
          }
          case 'reasoning-delta': {
            const index = reasoningParts.get(part.id)
            if (index === undefined) break
            const reasoningPart = message.parts[index]
            if (reasoningPart?.type !== 'reasoning') break
            reasoningPart.text += part.text
            message.updatedAt = nowIso()
            this.emit({
              type: 'message.part.delta',
              sessionId: run.sessionId,
              messageId: message.id,
              partIndex: index,
              kind: 'reasoning',
              delta: part.text
            })
            schedulePersist()
            break
          }
          case 'reasoning-end':
            reasoningParts.delete(part.id)
            break
          case 'tool-input-start': {
            const toolPart = this.ensureToolPart(message, part.id, part.toolName)
            toolPart.state = 'pending'
            this.emitPart(run, toolPart, message.parts.indexOf(toolPart))
            break
          }
          case 'tool-call': {
            const toolPart = this.ensureToolPart(message, part.toolCallId, part.toolName)
            toolPart.input = part.input
            toolPart.state = 'running'
            this.emitPart(run, toolPart, message.parts.indexOf(toolPart))
            break
          }
          case 'tool-result': {
            const toolPart = this.findToolPart(message, part.toolCallId)
            if (toolPart && toolPart.type === 'tool') {
              if (toolPart.state !== 'denied') {
                toolPart.state = 'completed'
                toolPart.output =
                  typeof part.output === 'string' ? part.output : JSON.stringify(part.output)
                toolPart.finishedAt = nowIso()
                this.emitPart(run, toolPart, message.parts.indexOf(toolPart))
              }
              await this.store.persist(run.sessionId)
            }
            break
          }
          case 'tool-error': {
            const toolPart = this.findToolPart(message, part.toolCallId)
            if (toolPart && toolPart.type === 'tool') {
              toolPart.state = 'failed'
              toolPart.error = normalizeError(part.error)
              toolPart.finishedAt = nowIso()
              this.emitPart(run, toolPart, message.parts.indexOf(toolPart))
              await this.store.persist(run.sessionId)
            }
            break
          }
          case 'tool-output-denied': {
            const toolPart = this.findToolPart(message, part.toolCallId)
            if (toolPart && toolPart.type === 'tool') {
              toolPart.state = 'denied'
              toolPart.error = 'Permission denied by user'
              toolPart.finishedAt = nowIso()
              this.emitPart(run, toolPart, message.parts.indexOf(toolPart))
            }
            break
          }
          case 'finish-step':
            run.steps += 1
            break
          case 'finish':
            finishReason = part.finishReason
            usage = usageFrom(part.totalUsage)
            break
          case 'error':
            throw part.error
          case 'abort':
            throw new Error('ABORTED')
          default:
            break
        }
      }

      message.status = 'complete'
      message.updatedAt = nowIso()
      message.durationMs = Date.now() - run.startedAt
      message.usage = usage
      this.settleTools(message, 'Tool call did not finish')
      await this.store.persist(run.sessionId)
      this.emit({ type: 'message.upsert', message: structuredClone(message) })
      await this.store.setStatus(run.sessionId, 'idle')
      this.emitSession(run.sessionId)
      const outcome: RunOutcome =
        finishReason === 'tool-calls' && run.steps >= MAX_STEPS ? 'max-steps' : 'completed'
      this.emit({
        type: 'run.finished',
        sessionId: run.sessionId,
        messageId: message.id,
        status: outcome,
        usage,
        durationMs: message.durationMs
      })
    } catch (error) {
      const interrupted =
        run.abort.signal.aborted || /ABORTED|AbortError|interrupted/i.test(normalizeError(error))
      message.status = interrupted ? 'interrupted' : 'error'
      message.error = interrupted ? 'Interrupted by user' : normalizeError(error)
      message.updatedAt = nowIso()
      message.durationMs = Date.now() - run.startedAt
      message.usage = usage
      this.settleTools(message, interrupted ? 'Interrupted by user' : 'Tool call failed')
      await this.store.persist(run.sessionId)
      this.emit({ type: 'message.upsert', message: structuredClone(message) })
      await this.store.setStatus(run.sessionId, interrupted ? 'idle' : 'error')
      this.emitSession(run.sessionId)
      this.emit({
        type: 'run.finished',
        sessionId: run.sessionId,
        messageId: message.id,
        status: interrupted ? 'interrupted' : 'failed',
        error: message.error,
        usage,
        durationMs: message.durationMs
      })
    } finally {
      if (persistTimer) clearTimeout(persistTimer)
      this.runs.delete(run.sessionId)
      this.emitSession(run.sessionId)
    }
  }
}

function buildSystemPrompt(workspacePath: string): string {
  return [
    'You are ATeam, a concise and reliable coding agent running on the user desktop.',
    `The workspace is: ${workspacePath}`,
    'Use the available tools to inspect and modify files. Read, list, and grep are allowed automatically.',
    'write, edit, and shell require explicit user approval and may be denied; respect the decision and explain it.',
    'Prefer small, verifiable changes. Do not claim that you changed a file unless a tool result confirms it.',
    'Use exact unique matches for edit. Keep shell commands non-interactive and scoped to the workspace.',
    'Answer in the language the user used.'
  ].join('\n')
}
