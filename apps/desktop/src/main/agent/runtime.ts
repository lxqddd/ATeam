import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { generateText, stepCountIs, streamText } from 'ai'
import type { LanguageModel, ModelMessage, TextStreamPart, ToolSet } from 'ai'
import type {
  AgentEvent,
  AgentEventEnvelope,
  ChatMessage,
  MessagePart,
  MessagesSnapshot,
  ModelRef,
  PermissionAction,
  PermissionDecision,
  PermissionEffect,
  PermissionMode,
  PermissionRequest,
  PermissionRule,
  PermissionRuleInput,
  ReasoningEffort,
  RunOutcome,
  RuntimeModelsConfig,
  SessionMeta,
  SessionSettings,
  TokenUsage
} from '@ateam/shared'
import { PERMISSION_MODES, REASONING_EFFORTS } from '@ateam/shared'
import {
  compactionKeepTokens,
  DEFAULT_CONTEXT_WINDOW,
  estimateMessagesTokens,
  estimateTextTokens,
  messagesAfterCompaction,
  planCompaction,
  shouldCompact,
  summaryPrompt,
  systemWithSummary
} from './context'
import {
  discoverInstructionFiles,
  systemWithInstructions,
  type InstructionFile
} from './instructions'
import { alwaysPermissionResource, evaluatePermissionRules, scanShellCommand } from './permissions'
import { PermissionsStore } from './permissions-store'
import { SessionsStore, type SessionRecord } from './sessions-store'
import { SnapshotStore } from './snapshots'
import { buildModelMessages } from './message-history'
import { createLanguageModel as createDefaultLanguageModel, resolveModelRef } from './providers'
import { createTools as createDefaultTools, type ToolContext } from './tools'
import { normalizeError } from './errors'

const MAX_STEPS = 25
const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000

interface Run {
  sessionId: string
  messageId: string
  abort: AbortController
  startedAt: number
  steps: number
  skipHistoryIds?: Set<string>
  retried?: boolean
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
  dependencies?: Partial<AgentRuntimeDependencies>
}

export interface AgentTurnInput {
  model: LanguageModel
  system: string
  messages: ModelMessage[]
  tools: ToolSet
  abortSignal: AbortSignal
  reasoning?: ReasoningEffort | null
}

export interface AgentTurnStream {
  stream: AsyncIterable<TextStreamPart<ToolSet>>
}

export interface AgentRuntimeDependencies {
  createLanguageModel: (
    models: RuntimeModelsConfig,
    ref: ModelRef | null,
    options?: { sessionId?: string }
  ) => LanguageModel
  createTools: (context: ToolContext) => ToolSet
  createTurn: (input: AgentTurnInput) => AgentTurnStream
  generateSummary: (input: {
    model: LanguageModel
    prompt: string
    abortSignal?: AbortSignal
  }) => Promise<string>
  loadInstructions: (input: {
    workspacePath: string
    globalDirectory: string
  }) => Promise<InstructionFile[]>
}

async function generateSummary(input: {
  model: LanguageModel
  prompt: string
  abortSignal?: AbortSignal
}): Promise<string> {
  const result = await generateText({
    model: input.model,
    prompt: input.prompt,
    maxOutputTokens: 2_048,
    abortSignal: input.abortSignal
  })
  return result.text
}

async function loadInstructions(input: {
  workspacePath: string
  globalDirectory: string
}): Promise<InstructionFile[]> {
  return discoverInstructionFiles(input.workspacePath, input.globalDirectory)
}

const DEFAULT_DEPENDENCIES: AgentRuntimeDependencies = {
  createLanguageModel: createDefaultLanguageModel,
  createTools: createDefaultTools,
  createTurn: (input) => ({
    stream: streamText({
      model: input.model,
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal: input.abortSignal,
      reasoning: input.reasoning ?? undefined,
      maxRetries: 1,
      maxOutputTokens: 8_192,
      onError: () => undefined
    }).stream
  }),
  generateSummary,
  loadInstructions
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
  private readonly permissionRules: PermissionsStore
  private readonly snapshots: SnapshotStore
  private readonly runs = new Map<string, Run>()
  private readonly pending = new Map<string, PendingPermission>()
  private models: RuntimeModelsConfig
  private readonly deps: AgentRuntimeDependencies
  private seq = 0

  constructor(private readonly options: AgentRuntimeOptions) {
    this.store = new SessionsStore(options.userDataPath)
    this.permissionRules = new PermissionsStore(options.userDataPath)
    this.snapshots = new SnapshotStore(options.userDataPath)
    this.models = options.models
    this.deps = { ...DEFAULT_DEPENDENCIES, ...options.dependencies }
  }

  async init(): Promise<void> {
    await fs.mkdir(this.options.workspacePath, { recursive: true })
    await this.store.init()
    await this.permissionRules.init()
    await this.snapshots.init()
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

  async setSessionSettings(id: string, settings: SessionSettings): Promise<SessionMeta> {
    if (
      settings.reasoningEffort !== null &&
      !REASONING_EFFORTS.includes(settings.reasoningEffort)
    ) {
      throw new Error('INVALID_REASONING_EFFORT')
    }
    if (!PERMISSION_MODES.includes(settings.permissionMode)) {
      throw new Error('INVALID_PERMISSION_MODE')
    }
    const session = await this.store.setSettings(id, settings)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.emit({ type: 'session.upsert', session })
    return session
  }

  async compactSession(id: string): Promise<SessionMeta> {
    const record = this.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    if (this.runs.has(id)) throw new Error('SESSION_BUSY')

    const model = this.deps.createLanguageModel(
      this.models,
      record.session.model ?? this.models.defaultModel,
      { sessionId: id }
    )
    const compacted = await this.compactMessages(id, record.messages, model)
    if (compacted) return compacted

    const session = this.store.getSession(id)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    return session
  }

  async undoSession(id: string): Promise<{ session: SessionMeta; prompt: string }> {
    if (this.runs.has(id)) throw new Error('SESSION_BUSY')
    const record = this.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')

    let assistantIndex = -1
    for (let index = record.messages.length - 1; index >= 0; index -= 1) {
      if (record.messages[index].role === 'assistant') {
        assistantIndex = index
        break
      }
    }
    if (assistantIndex < 0) throw new Error('NOTHING_TO_UNDO')

    let userIndex = assistantIndex - 1
    while (userIndex >= 0 && record.messages[userIndex].role !== 'user') userIndex -= 1
    if (userIndex < 0) throw new Error('NOTHING_TO_UNDO')

    const assistant = record.messages[assistantIndex]
    if (assistant.snapshotBefore) {
      try {
        await this.snapshots.restore(this.options.workspacePath, assistant.snapshotBefore)
      } catch {
        throw new Error('SNAPSHOT_RESTORE_FAILED')
      }
    }

    const prompt = record.messages[userIndex].parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
    const staged = await this.store.stageUndo(
      id,
      userIndex,
      assistant.snapshotAfter ?? null,
      prompt
    )
    if (!staged) throw new Error('NOTHING_TO_UNDO')
    this.emit({ type: 'session.upsert', session: staged.session })
    return { session: staged.session, prompt }
  }

  async redoSession(id: string): Promise<SessionMeta> {
    if (this.runs.has(id)) throw new Error('SESSION_BUSY')
    if (!this.store.get(id)) throw new Error('SESSION_NOT_FOUND')
    const redo = this.store.getRedo(id)
    if (!redo) throw new Error('NOTHING_TO_REDO')

    if (redo.snapshotAfter) {
      try {
        await this.snapshots.restore(this.options.workspacePath, redo.snapshotAfter)
      } catch {
        throw new Error('SNAPSHOT_RESTORE_FAILED')
      }
    }

    const session = await this.store.redo(id)
    if (!session) throw new Error('NOTHING_TO_REDO')
    this.emit({ type: 'session.upsert', session })
    return session
  }

  listPermissionRules(sessionId?: string): PermissionRule[] {
    return this.permissionRules.list(sessionId)
  }

  addPermissionRule(input: PermissionRuleInput): Promise<PermissionRule> {
    return this.permissionRules.add(input)
  }

  removePermissionRule(id: string): Promise<boolean> {
    return this.permissionRules.remove(id)
  }

  async deleteSession(id: string): Promise<void> {
    const run = this.runs.get(id)
    if (run) {
      run.abort.abort()
      this.rejectPendingForRun(run)
    }
    await this.store.delete(id)
    await this.permissionRules.removeForSession(id)
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
    assistant.snapshotBefore = await this.createSnapshotId()
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

    const run: Run = {
      sessionId,
      messageId: assistant.id,
      abort: new AbortController(),
      startedAt: Date.now(),
      steps: 0,
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
    assistant.snapshotBefore = await this.createSnapshotId()
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
      const model = this.deps.createLanguageModel(
        this.models,
        { providerId, modelId },
        {
          sessionId: randomUUID()
        }
      )
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
    const mode = this.store.get(run.sessionId)?.session.permissionMode ?? 'ask'
    if (mode === 'plan') return false

    const scan = action === 'shell' ? scanShellCommand(resource, this.options.workspacePath) : null
    const resources = scan && scan.segments.length > 0 ? scan.segments : [resource]
    const rules = this.permissionRules.list(run.sessionId)
    const effect = evaluatePermissionRules(rules, {
      action,
      resources,
      sessionId: run.sessionId
    })
    if (effect === 'deny') return false

    let externalEffect: PermissionEffect | null = null
    if (scan && scan.externalPaths.length > 0) {
      externalEffect = evaluatePermissionRules(rules, {
        action: 'external_directory',
        resources: scan.externalPaths,
        sessionId: run.sessionId
      })
      if (externalEffect === 'deny') return false
    }

    const externalNeedsPrompt =
      Boolean(scan && scan.externalPaths.length > 0) && externalEffect !== 'allow'
    if (!scan?.risky && !externalNeedsPrompt) {
      if (effect === 'allow') return true
      if (effect !== 'ask') {
        if (mode === 'auto') return true
        if (mode === 'acceptEdits' && action !== 'shell') return true
      }
    }

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

    if (decision === 'always') {
      for (const entry of resources) {
        await this.permissionRules
          .add({
            action,
            resource: alwaysPermissionResource(action, entry),
            effect: 'allow',
            sessionId: run.sessionId
          })
          .catch(() => undefined)
      }
      for (const externalPath of scan?.externalPaths ?? []) {
        await this.permissionRules
          .add({
            action: 'external_directory',
            resource: alwaysPermissionResource('external_directory', externalPath),
            effect: 'allow',
            sessionId: run.sessionId
          })
          .catch(() => undefined)
      }
    }
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

  private historyMessages(run: Run, assistantMessageId: string): ChatMessage[] {
    const record = this.record(run.sessionId)
    return messagesAfterCompaction(record.messages, record.session.compaction).filter(
      (item) =>
        item.id !== assistantMessageId &&
        !run.skipHistoryIds?.has(item.id) &&
        item.status !== 'streaming'
    )
  }

  private async compactMessages(
    sessionId: string,
    messages: ChatMessage[],
    model: LanguageModel,
    abortSignal?: AbortSignal
  ): Promise<SessionMeta | null> {
    const record = this.record(sessionId)
    const target = record.session.model ?? this.models.defaultModel
    const contextWindow =
      resolveModelRef(this.models, target).model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const plan = planCompaction(messages, contextWindow, compactionKeepTokens(contextWindow))
    if (!plan) return null

    const summary = (
      await this.deps.generateSummary({
        model,
        prompt: summaryPrompt(plan.older, record.session.compaction?.summary),
        abortSignal
      })
    ).trim()
    if (!summary) return null

    const session = await this.store.setCompaction(sessionId, {
      summary,
      throughMessageId: plan.throughMessageId,
      createdAt: nowIso(),
      tokensBefore: plan.tokensBefore,
      tokensAfter: estimateMessagesTokens(plan.keep) + estimateTextTokens(summary)
    })
    if (!session) return null
    this.emit({ type: 'session.upsert', session })
    return session
  }

  private async compactForOverflow(run: Run): Promise<boolean> {
    const record = this.record(run.sessionId)
    const target = record.session.model ?? this.models.defaultModel
    const model = this.deps.createLanguageModel(this.models, target, {
      sessionId: run.sessionId
    })
    const session = await this.compactMessages(
      run.sessionId,
      this.historyMessages(run, run.messageId),
      model,
      run.abort.signal
    )
    return session !== null
  }

  private resetAssistantMessage(run: Run, message: ChatMessage): void {
    message.parts = []
    message.error = undefined
    message.usage = undefined
    message.durationMs = undefined
    message.status = 'streaming'
    message.updatedAt = nowIso()
    run.steps = 0
    this.emit({ type: 'message.upsert', message: structuredClone(message) })
  }

  private async createSnapshotId(): Promise<string | undefined> {
    try {
      const snapshot = await this.snapshots.create(this.options.workspacePath)
      return snapshot.id
    } catch {
      return undefined
    }
  }

  private async recordAfterSnapshot(run: Run, message: ChatMessage): Promise<void> {
    if (!message.snapshotBefore) return
    try {
      const snapshot = await this.snapshots.create(this.options.workspacePath)
      const diff = await this.snapshots.diff(message.snapshotBefore, snapshot.id)
      message.snapshotAfter = snapshot.id
      message.changedFiles = [...diff.added, ...diff.modified, ...diff.deleted]
      await this.store.persist(run.sessionId)
    } catch {
      /* snapshots are best effort */
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
      const target = record.session.model ?? this.models.defaultModel
      const model = this.deps.createLanguageModel(this.models, target, {
        sessionId: run.sessionId
      })
      const contextWindow =
        resolveModelRef(this.models, target).model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
      const history = this.historyMessages(run, message.id)
      if (shouldCompact(history, contextWindow)) {
        await this.compactMessages(run.sessionId, history, model, run.abort.signal)
      }

      const current = this.record(run.sessionId)
      const instructions = await this.deps.loadInstructions({
        workspacePath: this.options.workspacePath,
        globalDirectory: this.options.userDataPath
      })
      const tools = this.deps.createTools({
        workspace: this.options.workspacePath,
        signal: run.abort.signal,
        askPermission: (action, resource, toolName, toolCallId) =>
          this.askPermission(run, action, resource, toolName, toolCallId)
      })

      const result = this.deps.createTurn({
        model,
        system: systemWithInstructions(
          systemWithSummary(
            buildSystemPrompt(this.options.workspacePath, current.session.permissionMode ?? 'ask'),
            current.session.compaction?.summary
          ),
          instructions
        ),
        messages: buildModelMessages(this.historyMessages(run, message.id)),
        tools,
        abortSignal: run.abort.signal,
        reasoning: current.session.reasoningEffort
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
      await this.recordAfterSnapshot(run, message)
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
      if (!run.retried && isContextLengthError(error)) {
        try {
          const compacted = await this.compactForOverflow(run)
          if (compacted) {
            run.retried = true
            this.resetAssistantMessage(run, message)
            await this.runAgent(run)
            return
          }
        } catch {
          /* fall through to the original failure */
        }
      }

      const interrupted =
        run.abort.signal.aborted || /ABORTED|AbortError|interrupted/i.test(normalizeError(error))
      message.status = interrupted ? 'interrupted' : 'error'
      message.error = interrupted ? 'Interrupted by user' : normalizeError(error)
      message.updatedAt = nowIso()
      message.durationMs = Date.now() - run.startedAt
      message.usage = usage
      this.settleTools(message, interrupted ? 'Interrupted by user' : 'Tool call failed')
      await this.recordAfterSnapshot(run, message)
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

function isContextLengthError(error: unknown): boolean {
  const message = normalizeError(error).toLowerCase()
  return [
    'context length',
    'context_length',
    'maximum context',
    'context window',
    'too many tokens',
    'token limit',
    'prompt is too long',
    'input is too long',
    'exceeds the maximum',
    'request too large',
    '413'
  ].some((fragment) => message.includes(fragment))
}

function buildSystemPrompt(workspacePath: string, permissionMode: PermissionMode): string {
  const permission =
    permissionMode === 'plan'
      ? 'This session is in read-only plan mode: inspect the workspace and propose a plan, but do not modify files or run shell commands.'
      : permissionMode === 'acceptEdits'
        ? 'File writes and edits are pre-approved and run without asking. Shell commands still require explicit user approval and may be denied.'
        : permissionMode === 'auto'
          ? 'File writes, edits, and shell commands are pre-approved and run without asking. Still act carefully and stay inside the workspace.'
          : 'write, edit, and shell require explicit user approval and may be denied; respect the decision and explain it.'
  return [
    'You are ATeam, a concise and reliable coding agent running on the user desktop.',
    `The workspace is: ${workspacePath}`,
    'Use the available tools to inspect and modify files. Read, list, and grep are allowed automatically.',
    permission,
    'Prefer small, verifiable changes. Do not claim that you changed a file unless a tool result confirms it.',
    'Use exact unique matches for edit. Keep shell commands non-interactive and scoped to the workspace.',
    'Answer in the language the user used.'
  ].join('\n')
}
