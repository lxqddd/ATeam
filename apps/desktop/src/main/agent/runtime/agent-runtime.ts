import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { generateText } from 'ai'
import type { LanguageModel, ToolSet } from 'ai'
import type {
  AgentConfig,
  AgentDefinition,
  AgentEvent,
  ChatMessage,
  CommandDefinition,
  MessagePart,
  MessagesSnapshot,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  MessageAttachment,
  ModelRef,
  PermissionAction,
  PermissionDecision,
  PermissionEffect,
  PermissionRequest,
  PermissionRule,
  PermissionRuleInput,
  QuestionAnswer,
  QuestionInput,
  QuestionRequest,
  RunOutcome,
  RuntimeModelsConfig,
  RuntimeWebSearchConfig,
  SessionMeta,
  SessionSettings,
  SkillDefinition,
  SubagentInput,
  TodoInput,
  TokenUsage,
  WebFetchFormat
} from '@ateam/shared'
import { PERMISSION_MODES, REASONING_EFFORTS } from '@ateam/shared'
import {
  compactionKeepTokens,
  contextTokenLimit,
  DEFAULT_CONTEXT_WINDOW,
  estimateMessagesTokens,
  estimateTextTokens,
  messagesAfterCompaction,
  planCompaction,
  shouldCompact,
  summaryPrompt,
  systemWithSummary
} from '../sessions/context'
import {
  discoverNestedInstructions,
  formatInstructions,
  loadConfiguredInstructions,
  systemWithInstructions
} from '../config/instructions'
import { readAgentConfig } from '../config/config-store'
import {
  alwaysPermissionResource,
  evaluatePermissionRules,
  scanShellCommand
} from '../config/permissions'
import { PermissionsStore } from '../config/permissions-store'
import { SessionsStore, type SessionRecord } from '../sessions/sessions-store'
import { SnapshotStore } from '../sessions/snapshots'
import { ToolOutputStore } from '../sessions/tool-output-store'
import { buildModelMessages, type AttachmentPayload } from '../message-history'
import { readAttachment, readTextAttachment, removeSessionAttachments } from '../attachments'
import { resolveModelRef } from '../providers'
import type { ToolContext } from '../tools'
import { filterToolsForAgent, loadAgents } from '../config/agents'
import { loadCommands } from '../commands'
import { loadSkills, skillsPrompt } from '../skills'
import { formatTodoList, normalizeTodos } from '../todos'
import { computeMessageCost } from '../cost'
import {
  discoverFormatters,
  formatFile,
  type FormatterDefinition
} from '../integrations/formatters'
import { formatDiagnosticReport, LspManager } from '../integrations/lsp'
import type { McpManagerLike } from '../integrations/mcp'
import { formatWebFetchResult } from '../integrations/webfetch'
import { formatSearchResults } from '../integrations/websearch'
import { normalizeError } from '../errors'
import { DEFAULT_DEPENDENCIES } from './defaults'
import { errorMessage, makeAssistantMessage, makeUserMessage, nowIso, usageFrom } from './messages'
import { buildSystemPrompt, modePermissionRules } from './policy'
import { runSubagentTask } from './subagents'
import {
  MAX_STEPS,
  PERMISSION_TIMEOUT_MS,
  type AgentRuntimeDependencies,
  type AgentRuntimeOptions,
  type PendingPermission,
  type PendingQuestion,
  type Run
} from './types'

export class AgentRuntime {
  private readonly store: SessionsStore
  private readonly permissionRules: PermissionsStore
  private readonly snapshots: SnapshotStore
  private readonly toolOutputs: ToolOutputStore
  private readonly runs = new Map<string, Run>()
  private readonly pending = new Map<string, PendingPermission>()
  private readonly pendingQuestions = new Map<string, PendingQuestion>()
  private lspManager: LspManager | null = null
  private formattersCache: Promise<FormatterDefinition[]> | null = null
  private mcpManager: McpManagerLike | null = null
  private webSearchConfig: RuntimeWebSearchConfig | null = null
  private skills: SkillDefinition[] = []
  private models: RuntimeModelsConfig
  private readonly deps: AgentRuntimeDependencies
  private seq = 0

  constructor(private readonly options: AgentRuntimeOptions) {
    this.store = new SessionsStore(options.userDataPath)
    this.webSearchConfig = options.webSearch ?? null
    this.permissionRules = new PermissionsStore(options.userDataPath)
    this.snapshots = new SnapshotStore(options.userDataPath)
    this.toolOutputs = new ToolOutputStore(options.userDataPath)
    this.models = options.models
    this.deps = { ...DEFAULT_DEPENDENCIES, ...options.dependencies }
  }

  async init(): Promise<void> {
    await fs.mkdir(this.options.workspacePath, { recursive: true })
    await this.store.init()
    await this.permissionRules.init()
    await this.snapshots.init()
    this.skills = await loadSkills({
      userDataPath: this.options.userDataPath,
      workspacePath: this.options.workspacePath
    }).catch(() => [])
  }

  listSessions(): SessionMeta[] {
    return this.store.list().filter((session) => !session.hidden)
  }

  listAgents(): Promise<AgentDefinition[]> {
    return this.agents()
  }

  listCommands(): Promise<CommandDefinition[]> {
    return loadCommands({
      userDataPath: this.options.userDataPath,
      workspacePath: this.options.workspacePath
    })
  }

  async setSessionAgent(id: string, agentId: string | null): Promise<SessionMeta> {
    const record = this.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    if (agentId) {
      const agents = await this.agents()
      const agent = agents.find(
        (candidate) =>
          candidate.id === agentId || candidate.name.toLowerCase() === agentId.toLowerCase()
      )
      if (!agent) throw new Error('AGENT_NOT_FOUND')
      if (agent.mode === 'subagent') throw new Error('AGENT_NOT_PRIMARY')
    }
    const session = await this.store.setAgent(id, agentId)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.emit({ type: 'session.upsert', session })
    return session
  }

  private agents(): Promise<AgentDefinition[]> {
    return loadAgents({
      userDataPath: this.options.userDataPath,
      workspacePath: this.options.workspacePath
    })
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

  async compactSession(id: string, options: { force?: boolean } = {}): Promise<SessionMeta> {
    const record = this.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    if (this.runs.has(id)) throw new Error('SESSION_BUSY')

    const model = this.deps.createLanguageModel(
      this.models,
      record.session.model ?? this.models.defaultModel,
      { sessionId: id }
    )
    const compacted = await this.compactMessages(
      id,
      record.messages,
      model,
      undefined,
      options.force
    )
    if (compacted) return compacted

    const session = this.store.getSession(id)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    return session
  }

  async undoSession(
    id: string,
    messageId?: string
  ): Promise<{ session: SessionMeta; prompt: string }> {
    if (this.runs.has(id)) throw new Error('SESSION_BUSY')
    const record = this.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')

    let assistantIndex = -1
    if (messageId) {
      assistantIndex = record.messages.findIndex(
        (message) => message.id === messageId && message.role === 'assistant'
      )
    } else {
      for (let index = record.messages.length - 1; index >= 0; index -= 1) {
        if (record.messages[index].role === 'assistant') {
          assistantIndex = index
          break
        }
      }
    }
    if (assistantIndex < 0) throw new Error('NOTHING_TO_UNDO')

    let userIndex = assistantIndex - 1
    while (userIndex >= 0 && record.messages[userIndex].role !== 'user') userIndex -= 1
    if (userIndex < 0) throw new Error('NOTHING_TO_UNDO')

    const assistant = record.messages[assistantIndex]
    const removedMessages = record.messages.slice(userIndex)
    const removedAssistants = removedMessages.filter((item) => item.role === 'assistant')
    const finalAssistant = removedAssistants[removedAssistants.length - 1]
    const files = [...new Set(removedMessages.flatMap((message) => message.changedFiles ?? []))]
    if (assistant.snapshotBefore && files.length > 0) {
      try {
        await this.snapshots.restorePaths(
          this.options.workspacePath,
          assistant.snapshotBefore,
          files
        )
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
      finalAssistant?.snapshotAfter ?? null,
      prompt,
      files
    )
    if (!staged) throw new Error('NOTHING_TO_UNDO')
    this.emit({ type: 'session.upsert', session: staged.session })
    await this.updateContextUsage(id)
    return { session: staged.session, prompt }
  }

  async redoSession(id: string): Promise<SessionMeta> {
    if (this.runs.has(id)) throw new Error('SESSION_BUSY')
    if (!this.store.get(id)) throw new Error('SESSION_NOT_FOUND')
    const redo = this.store.getRedo(id)
    if (!redo) throw new Error('NOTHING_TO_REDO')

    if (redo.snapshotAfter && redo.files.length > 0) {
      try {
        await this.snapshots.restorePaths(
          this.options.workspacePath,
          redo.snapshotAfter,
          redo.files
        )
      } catch {
        throw new Error('SNAPSHOT_RESTORE_FAILED')
      }
    }

    const session = await this.store.redo(id)
    if (!session) throw new Error('NOTHING_TO_REDO')
    this.emit({ type: 'session.upsert', session })
    await this.updateContextUsage(id)
    return session
  }

  listPermissionRules(sessionId?: string): PermissionRule[] {
    return this.permissionRules.list(sessionId)
  }

  async prepareCompaction(id: string): Promise<boolean> {
    const record = this.store.get(id)
    if (!record || this.runs.has(id)) return false
    const target = record.session.model ?? this.models.defaultModel
    try {
      const contextWindow =
        resolveModelRef(this.models, target).model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
      const plan = planCompaction(
        record.messages,
        contextWindow,
        compactionKeepTokens(contextWindow)
      )
      if (!plan) return false
      const existing = this.store.getPreparedCompaction(id)
      if (existing?.throughMessageId === plan.throughMessageId) return true

      const model = this.deps.createLanguageModel(this.models, target, { sessionId: id })
      const summary = (
        await this.deps.generateSummary({
          model,
          prompt: summaryPrompt(plan.older, record.session.compaction?.summary)
        })
      ).trim()
      if (!summary) return false
      await this.store.setPreparedCompaction(id, {
        summary,
        throughMessageId: plan.throughMessageId,
        createdAt: nowIso()
      })
      return true
    } catch {
      return false
    }
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
    const children = this.store.list().filter((session) => session.parentId === id)
    for (const child of children) {
      const childRun = this.runs.get(child.id)
      if (childRun) {
        childRun.abort.abort()
        this.rejectPendingForRun(childRun)
      }
      await this.store.delete(child.id)
      await this.permissionRules.removeForSession(child.id)
      await this.snapshots.removeSession(child.id)
      await removeSessionAttachments(this.options.userDataPath, child.id)
    }
    await this.store.delete(id)
    await this.permissionRules.removeForSession(id)
    await this.snapshots.removeSession(id)
    await removeSessionAttachments(this.options.userDataPath, id)
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

  async sendChat(
    sessionId: string,
    text: string,
    requestedModel?: ModelRef | null,
    attachments: MessageAttachment[] = []
  ): Promise<void> {
    const content = text.trim()
    if (!content && attachments.length === 0) throw new Error('EMPTY_MESSAGE')
    if (this.runs.has(sessionId)) throw new Error('SESSION_BUSY')

    const record = this.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')

    const target = requestedModel ?? record.session.model ?? this.models.defaultModel
    resolveModelRef(this.models, target)

    if (requestedModel) {
      record.session.model = requestedModel
    }

    const user = makeUserMessage(sessionId, content, attachments)
    const assistant = makeAssistantMessage(sessionId)
    const config = await readAgentConfig(this.options.userDataPath)
    if (config.snapshots) {
      assistant.snapshotBefore = await this.createSnapshotId(sessionId)
    }
    await this.store.appendMessage(sessionId, user)
    await this.store.appendMessage(sessionId, assistant)
    await this.store.setStatus(sessionId, 'running')

    this.emit({ type: 'message.upsert', message: structuredClone(user) })
    this.beginRun(sessionId, assistant, undefined, config)
  }

  private beginRun(
    sessionId: string,
    assistant: ChatMessage,
    skipHistoryIds: Set<string> | undefined,
    config: AgentConfig
  ): void {
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
      config,
      skipHistoryIds,
      agent: null,
      depth: 0
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
    const config = await readAgentConfig(this.options.userDataPath)
    if (config.snapshots) {
      assistant.snapshotBefore = await this.createSnapshotId(sessionId)
    }
    await this.store.appendMessage(sessionId, assistant)
    await this.store.setStatus(sessionId, 'running')
    this.beginRun(sessionId, assistant, new Set([last.id]), config)
  }

  permissions(): PermissionRequest[] {
    return [...this.pending.values()].map((entry) => structuredClone(entry.request))
  }

  questions(): QuestionRequest[] {
    return [...this.pendingQuestions.values()].map((entry) => structuredClone(entry.request))
  }

  replyQuestion(questionId: string, answer: QuestionAnswer): void {
    if (!this.pendingQuestions.has(questionId)) throw new Error('QUESTION_NOT_FOUND')
    this.settleQuestion(questionId, answer)
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
    if (this.lspManager) {
      const manager = this.lspManager
      this.lspManager = null
      await manager.dispose()
    }
    if (this.mcpManager) {
      const manager = this.mcpManager
      this.mcpManager = null
      await manager.dispose()
    }
  }

  private mcp(): McpManagerLike {
    this.mcpManager ??= this.deps.createMcpManager({
      userDataPath: this.options.userDataPath,
      workspacePath: this.options.workspacePath
    })
    return this.mcpManager
  }

  listMcpServers(): Promise<McpServerConfig[]> {
    return this.mcp().servers()
  }

  mcpStatuses(options?: { probe?: boolean }): Promise<McpServerStatus[]> {
    return this.mcp().statuses(options)
  }

  addMcpServer(input: McpServerInput): Promise<McpServerConfig> {
    return this.mcp().addServer(input)
  }

  updateMcpServer(id: string, input: Partial<McpServerInput>): Promise<McpServerConfig> {
    return this.mcp().updateServer(id, input)
  }

  removeMcpServer(id: string): Promise<boolean> {
    return this.mcp().removeServer(id)
  }

  setWebSearch(config: RuntimeWebSearchConfig | null): void {
    this.webSearchConfig = config
  }

  private lsp(): LspManager {
    this.lspManager ??= new LspManager({ workspace: this.options.workspacePath })
    return this.lspManager
  }

  private formatters(): Promise<FormatterDefinition[]> {
    this.formattersCache ??= discoverFormatters(this.options.workspacePath).catch(() => [])
    return this.formattersCache
  }

  private async formatFiles(files: string[]): Promise<string> {
    const formatters = await this.formatters()
    const notes: string[] = []
    for (const file of files) {
      const result = await formatFile(file, formatters, this.options.workspacePath)
      const relative = path.relative(this.options.workspacePath, file).split(path.sep).join('/')
      if (result.formatted) {
        notes.push(`Formatted ${relative} with ${result.formatter}`)
      } else if (result.error) {
        notes.push(`Formatter failed for ${relative}: ${result.error}`)
      }
    }
    return notes.join('\n')
  }

  private async diagnoseFiles(files: string[]): Promise<string> {
    try {
      return formatDiagnosticReport(await this.lsp().diagnostics(files), this.options.workspacePath)
    } catch {
      return ''
    }
  }

  private async fetchWebPage(input: {
    url: string
    format: WebFetchFormat
    timeoutMs?: number
  }): Promise<string> {
    try {
      return formatWebFetchResult(await this.deps.fetchWeb(input))
    } catch (error) {
      return `Error: ${errorMessage(error)}`
    }
  }

  private async searchTheWeb(input: { query: string; count: number }): Promise<string> {
    if (!this.webSearchConfig) {
      return 'Error: web search is not configured. Add a provider in Settings → Web search.'
    }
    try {
      const results = await this.deps.searchWeb(this.webSearchConfig, input)
      return formatSearchResults(input.query, this.webSearchConfig.provider, results)
    } catch (error) {
      return `Error: ${errorMessage(error)}`
    }
  }

  private async writeTodos(run: Run, input: TodoInput[]): Promise<string> {
    const todos = normalizeTodos(input)
    const session = await this.store.setTodos(run.sessionId, todos)
    if (session) this.emit({ type: 'session.upsert', session })
    return formatTodoList(todos)
  }

  private async readTodos(run: Run): Promise<string> {
    return formatTodoList(this.store.getSession(run.sessionId)?.todos ?? [])
  }

  private messageCost(target: ModelRef | null, usage?: TokenUsage): number | undefined {
    try {
      return (
        computeMessageCost(usage ?? {}, resolveModelRef(this.models, target).model) ?? undefined
      )
    } catch {
      return undefined
    }
  }

  private askQuestion(run: Run, input: QuestionInput, toolCallId: string): Promise<string> {
    const id = randomUUID()
    const request: QuestionRequest = {
      id,
      sessionId: run.sessionId,
      messageId: run.messageId,
      toolCallId,
      header: input.header,
      question: input.question,
      options: input.options,
      multiple: input.multiple ?? false,
      allowCustom: input.allowCustom ?? false,
      createdAt: nowIso()
    }
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        this.settleQuestion(id, { selected: [], custom: null, timedOut: true })
      }, PERMISSION_TIMEOUT_MS)
      this.pendingQuestions.set(id, {
        request,
        run,
        resolve: (answer) => {
          clearTimeout(timer)
          resolve(formatQuestionAnswer(answer))
        },
        timer
      })
      this.emit({ type: 'question.asked', question: request })
    })
  }

  private settleQuestion(id: string, answer: QuestionAnswer): void {
    const entry = this.pendingQuestions.get(id)
    if (!entry) return
    this.pendingQuestions.delete(id)
    clearTimeout(entry.timer)
    entry.resolve(answer)
    this.emit({ type: 'question.replied', sessionId: entry.request.sessionId, questionId: id })
  }

  private resolveAgentTarget(
    agent: AgentDefinition | null,
    sessionModel: ModelRef | null
  ): ModelRef | null {
    const fallback = sessionModel ?? this.models.defaultModel
    if (!agent?.model) return fallback
    try {
      resolveModelRef(this.models, agent.model)
      return agent.model
    } catch {
      return fallback
    }
  }

  private runSubagent(parent: Run, input: SubagentInput, toolCallId: string): Promise<string> {
    return runSubagentTask(
      {
        store: this.store,
        agents: () => this.agents(),
        record: (sessionId) => this.record(sessionId),
        hasRun: (sessionId) => this.runs.has(sessionId),
        registerRun: (sessionId, run) => {
          this.runs.set(sessionId, run)
        },
        createSnapshotId: (sessionId) => this.createSnapshotId(sessionId),
        askPermission: (target, action, resource, toolName, callId) =>
          this.askPermission(target, action, resource, toolName, callId),
        runAgent: (run) => this.runAgent(run)
      },
      parent,
      input,
      toolCallId
    )
  }

  private emitSession(sessionId: string): void {
    const session = this.store.getSession(sessionId)
    if (session) this.emit({ type: 'session.upsert', session })
  }

  private emit(event: AgentEvent): void {
    const sessionId = 'sessionId' in event ? event.sessionId : null
    if (sessionId) {
      const record = this.store.get(sessionId)
      if (record?.session.hidden) return
    }
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

  private appendToolOutput(run: Run, toolCallId: string, delta: string): void {
    const message = this.assistantFor(run)
    const part = this.findToolPart(message, toolCallId)
    if (!part || part.type !== 'tool') return
    part.output = (part.output ?? '') + delta
    this.emit({
      type: 'message.part.delta',
      sessionId: run.sessionId,
      messageId: run.messageId,
      partIndex: message.parts.indexOf(part),
      kind: 'tool-output',
      delta
    })
  }

  private async askPermission(
    run: Run,
    action: PermissionAction,
    resource: string,
    toolName: string,
    toolCallId: string
  ): Promise<boolean> {
    if (run.permissionDelegate) {
      return run.permissionDelegate(action, resource, toolName, toolCallId)
    }
    const mode = this.store.get(run.sessionId)?.session.permissionMode ?? 'ask'
    const scan = action === 'shell' ? scanShellCommand(resource, this.options.workspacePath) : null
    const resources = scan && scan.segments.length > 0 ? scan.segments : [resource]
    const rules = [...modePermissionRules(mode), ...this.permissionRules.list(run.sessionId)]
    const effect = evaluatePermissionRules(rules, {
      action,
      resources,
      sessionId: run.sessionId
    })
    if (effect === 'deny') return false

    let externalEffect: PermissionEffect = 'allow'
    if (scan && scan.externalPaths.length > 0) {
      externalEffect =
        evaluatePermissionRules(rules, {
          action: 'external_directory',
          resources: scan.externalPaths,
          sessionId: run.sessionId
        }) ?? 'ask'
      if (externalEffect === 'deny') return false
    }

    if (effect === 'allow' && externalEffect === 'allow') return true

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
    for (const [id, entry] of this.pendingQuestions) {
      if (entry.run !== run) continue
      this.settleQuestion(id, { selected: [], custom: null, cancelled: true })
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

  private async attachmentPayloads(
    messages: ChatMessage[]
  ): Promise<Map<string, AttachmentPayload>> {
    const payloads = new Map<string, AttachmentPayload>()
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== 'attachment') continue
        const attachment = part.attachment
        if (payloads.has(attachment.id)) continue
        try {
          if (attachment.kind === 'text') {
            payloads.set(attachment.id, {
              kind: 'text',
              name: attachment.name,
              mimeType: attachment.mimeType,
              text: await readTextAttachment(attachment)
            })
          } else {
            payloads.set(attachment.id, {
              kind: attachment.kind,
              name: attachment.name,
              mimeType: attachment.mimeType,
              data: await readAttachment(attachment)
            })
          }
        } catch {
          /* missing attachment files are skipped */
        }
      }
    }
    return payloads
  }

  private async compactMessages(
    sessionId: string,
    messages: ChatMessage[],
    model: LanguageModel,
    abortSignal?: AbortSignal,
    force = false
  ): Promise<SessionMeta | null> {
    const record = this.record(sessionId)
    const target = record.session.model ?? this.models.defaultModel
    const contextWindow =
      resolveModelRef(this.models, target).model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const plan = planCompaction(messages, contextWindow, compactionKeepTokens(contextWindow), force)
    if (!plan) return null

    const prepared = this.store.getPreparedCompaction(sessionId)
    let summary: string
    if (prepared?.throughMessageId === plan.throughMessageId) {
      summary = prepared.summary
    } else {
      summary = (
        await this.deps.generateSummary({
          model,
          prompt: summaryPrompt(plan.older, record.session.compaction?.summary),
          abortSignal
        })
      ).trim()
    }
    if (!summary) return null
    await this.store.clearPreparedCompaction(sessionId)

    const session = await this.store.setCompaction(sessionId, {
      summary,
      throughMessageId: plan.throughMessageId,
      createdAt: nowIso(),
      tokensBefore: plan.tokensBefore,
      tokensAfter: estimateMessagesTokens(plan.keep) + estimateTextTokens(summary)
    })
    if (!session) return null
    this.emit({ type: 'session.upsert', session })
    await this.updateContextUsage(sessionId)
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
    message.snapshotAfter = undefined
    message.snapshotSteps = []
    message.changedFiles = undefined
    message.status = 'streaming'
    message.updatedAt = nowIso()
    run.steps = 0
    this.emit({ type: 'message.upsert', message: structuredClone(message) })
  }

  private schedulePreparedCompaction(sessionId: string): void {
    const session = this.store.getSession(sessionId)
    if (!session?.contextTokens || !session.contextWindow) return
    if (session.contextTokens < contextTokenLimit(session.contextWindow) * 0.6) return
    void this.prepareCompaction(sessionId)
  }

  private async updateContextUsage(sessionId: string): Promise<void> {
    const record = this.store.get(sessionId)
    if (!record) return
    try {
      const target = record.session.model ?? this.models.defaultModel
      const window =
        resolveModelRef(this.models, target).model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
      const history = messagesAfterCompaction(record.messages, record.session.compaction).filter(
        (message) => message.status !== 'streaming'
      )
      const tokens =
        estimateMessagesTokens(history) +
        estimateTextTokens(record.session.compaction?.summary ?? '')
      const session = await this.store.setContextUsage(sessionId, tokens, window)
      if (session) this.emit({ type: 'session.upsert', session })
    } catch {
      /* usage display is best effort */
    }
  }

  private async createSnapshotId(sessionId: string): Promise<string | undefined> {
    try {
      const snapshot = await this.snapshots.create(this.options.workspacePath, sessionId)
      return snapshot.id
    } catch {
      return undefined
    }
  }

  private async recordStepSnapshot(run: Run, message: ChatMessage): Promise<void> {
    const steps = message.snapshotSteps ?? []
    const before = steps[steps.length - 1]?.after ?? message.snapshotBefore
    if (!before) return
    try {
      const snapshot = await this.snapshots.create(this.options.workspacePath, run.sessionId)
      const diff = await this.snapshots.diff(before, snapshot.id)
      const files = [...diff.added, ...diff.modified, ...diff.deleted]
      message.snapshotSteps = [...steps, { before, after: snapshot.id, files }]
      message.snapshotAfter = snapshot.id
      message.changedFiles = [...new Set([...(message.changedFiles ?? []), ...files])]
      await this.store.persist(run.sessionId)
    } catch {
      /* snapshots are best effort */
    }
  }

  private async recordAfterSnapshot(run: Run, message: ChatMessage): Promise<void> {
    if (!message.snapshotBefore) return
    if (message.snapshotSteps && message.snapshotSteps.length > 0) {
      message.snapshotAfter = message.snapshotSteps[message.snapshotSteps.length - 1].after
      message.changedFiles = [...new Set(message.snapshotSteps.flatMap((step) => step.files))]
      await this.store.persist(run.sessionId)
      return
    }
    try {
      const snapshot = await this.snapshots.create(this.options.workspacePath, run.sessionId)
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
    let runTarget: ModelRef | null = null
    let finishReason = ''

    try {
      const record = this.record(run.sessionId)
      const agent =
        run.agent ??
        (record.session.agent
          ? ((await this.agents()).find((candidate) => candidate.id === record.session.agent) ??
            null)
          : null)
      run.agent = agent
      const target = this.resolveAgentTarget(agent, record.session.model)
      runTarget = target
      const model = this.deps.createLanguageModel(this.models, target, {
        sessionId: run.sessionId
      })
      const targetInfo = resolveModelRef(this.models, target).model
      const contextWindow = targetInfo.contextWindow ?? DEFAULT_CONTEXT_WINDOW
      const history = this.historyMessages(run, message.id)
      if (shouldCompact(history, contextWindow)) {
        await this.compactMessages(run.sessionId, history, model, run.abort.signal)
      }

      const current = this.record(run.sessionId)
      const instructions = [
        ...(await this.deps.loadInstructions({
          workspacePath: this.options.workspacePath,
          globalDirectory: this.options.userDataPath
        })),
        ...(run.config.instructions.length > 0
          ? await loadConfiguredInstructions(run.config.instructions, this.options.workspacePath)
          : [])
      ]
      const loadedInstructionPaths = new Set(instructions.map((file) => file.path))
      const skills = this.skills
      const toolContext: ToolContext = {
        workspace: this.options.workspacePath,
        signal: run.abort.signal,
        askPermission: (action, resource, toolName, toolCallId) =>
          this.askPermission(run, action, resource, toolName, toolCallId),
        loadNestedInstructions: async (targetPath) => {
          const nested = await discoverNestedInstructions(
            this.options.workspacePath,
            targetPath,
            loadedInstructionPaths
          )
          return formatInstructions(nested)
        },
        storeOutput: (toolCallId, output) =>
          this.toolOutputs.bound(run.sessionId, toolCallId, output),
        onToolOutput: (toolCallId, delta) => this.appendToolOutput(run, toolCallId, delta),
        backgroundOutputPath: (toolCallId) => this.toolOutputs.pathFor(run.sessionId, toolCallId),
        onBackgroundFinished: (info) =>
          this.emit({
            type: 'background.finished',
            sessionId: run.sessionId,
            messageId: run.messageId,
            ...info
          }),
        formatFiles: run.config.formatters ? (files) => this.formatFiles(files) : undefined,
        diagnoseFiles: run.config.lsp ? (files) => this.diagnoseFiles(files) : undefined,
        runSubagent: (input, toolCallId) => this.runSubagent(run, input, toolCallId),
        fetchWeb: (input) => this.fetchWebPage(input),
        webSearch: (input) => this.searchTheWeb(input),
        loadSkill: async (name) => {
          const skill = skills.find(
            (candidate) =>
              candidate.name.toLowerCase() === name.toLowerCase() ||
              candidate.id === name.toLowerCase()
          )
          return skill ? `# ${skill.name}\n\n${skill.content}` : `Error: unknown skill: ${name}`
        },
        writeTodos: (todos) => this.writeTodos(run, todos),
        readTodos: async () => this.readTodos(run),
        askQuestion: (input, toolCallId) => this.askQuestion(run, input, toolCallId)
      }
      const baseTools = this.deps.createTools(toolContext)
      let mcpTools: ToolSet = {}
      try {
        mcpTools = await this.mcp().tools(toolContext)
      } catch {
        /* MCP servers are best effort */
      }
      const tools = filterToolsForAgent({ ...mcpTools, ...baseTools }, agent)

      const systemSections = [
        systemWithInstructions(
          systemWithSummary(
            buildSystemPrompt(this.options.workspacePath, current.session.permissionMode ?? 'ask'),
            current.session.compaction?.summary
          ),
          instructions
        )
      ]
      if (agent?.prompt) systemSections.push(agent.prompt)
      const skillSection = skillsPrompt(skills)
      if (skillSection) systemSections.push(skillSection)
      const system = systemSections.join('\n\n')

      const modelHistory = this.historyMessages(run, message.id)
      const result = this.deps.createTurn({
        model,
        system,
        messages: buildModelMessages(modelHistory, await this.attachmentPayloads(modelHistory)),
        tools,
        abortSignal: run.abort.signal,
        reasoning: current.session.reasoningEffort,
        maxSteps: agent?.maxSteps ?? undefined,
        maxOutputTokens: targetInfo.maxOutputTokens
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
            await this.recordStepSnapshot(run, message)
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
      message.costUsd = this.messageCost(runTarget, usage)
      this.settleTools(message, 'Tool call did not finish')
      await this.recordAfterSnapshot(run, message)
      await this.store.persist(run.sessionId)
      this.emit({ type: 'message.upsert', message: structuredClone(message) })
      await this.updateContextUsage(run.sessionId)
      this.schedulePreparedCompaction(run.sessionId)
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
      message.costUsd = this.messageCost(runTarget, usage)
      this.settleTools(message, interrupted ? 'Interrupted by user' : 'Tool call failed')
      await this.recordAfterSnapshot(run, message)
      await this.store.persist(run.sessionId)
      this.emit({ type: 'message.upsert', message: structuredClone(message) })
      await this.updateContextUsage(run.sessionId)
      this.schedulePreparedCompaction(run.sessionId)
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

function formatQuestionAnswer(answer: QuestionAnswer): string {
  if (answer.timedOut) return 'User did not answer the question in time.'
  if (answer.cancelled) return 'User cancelled the question.'
  const parts: string[] = []
  if (answer.selected.length > 0) parts.push(answer.selected.join(', '))
  if (answer.custom?.trim()) parts.push(`custom: ${answer.custom.trim()}`)
  if (parts.length === 0) return 'User did not answer the question.'
  return `User answered: ${parts.join('; ')}`
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
