import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { generateText } from 'ai'
import type { LanguageModel, ToolSet } from 'ai'
import type {
  AgentConfig,
  AgentDefinition,
  AgentEvent,
  AgentPermissionRule,
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
  SessionSearchResult,
  SessionSettings,
  SkillDefinition,
  McpAuthRecord,
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
  estimateContextTokens,
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
import { loadOrgPolicy } from '../config/org-policy'
import {
  alwaysPermissionResource,
  evaluatePermissionRules,
  scanShellCommand
} from '../config/permissions'
import { PermissionsStore } from '../config/permissions-store'
import { SessionsStore, type SessionRecord, makeTitle } from '../sessions/sessions-store'
import { SnapshotStore } from '../sessions/snapshots'
import { ToolOutputStore } from '../sessions/tool-output-store'
import { buildModelMessages, type AttachmentPayload } from '../message-history'
import {
  attachmentDirectory,
  isPathInsideDirectory,
  extractPdfText,
  readAttachment,
  readTextAttachment,
  removeSessionAttachments
} from '../attachments'
import { resolveModelRef } from '../providers'
import { filterToolsForModel, type ToolContext } from '../tools'
import { filterToolsForAgent, loadAgents } from '../config/agents'
import { loadCommands } from '../commands'
import { loadSkills, skillsPrompt } from '../skills'
import {
  hasProjectReferences,
  isInsideReferences,
  referencesPrompt,
  resolveReferences,
  type ResolvedReference
} from '../references'
import { formatTodoList, normalizeTodos } from '../todos'
import { computeMessageCost } from '../cost'
import { tokenCounterFor, type TokenCounter } from '../tokenizer'
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
import {
  createWorktree,
  isPathInside,
  listWorktrees,
  removeWorktree,
  repositoryRoot,
  worktreeRootFor
} from '../worktrees'
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
  private readonly starting = new Set<string>()
  private readonly pending = new Map<string, PendingPermission>()
  private readonly pendingQuestions = new Map<string, PendingQuestion>()
  private readonly lspManagers = new Map<string, LspManager>()
  private readonly formatterCaches = new Map<string, Promise<FormatterDefinition[]>>()
  private readonly skillCaches = new Map<string, Promise<SkillDefinition[]>>()
  private readonly mcpManagers = new Map<string, McpManagerLike>()
  private mcpAuth: McpAuthRecord[] = []
  private webSearchConfig: RuntimeWebSearchConfig | null = null
  private models: RuntimeModelsConfig
  private readonly deps: AgentRuntimeDependencies
  private seq = 0

  constructor(private readonly options: AgentRuntimeOptions) {
    this.store = new SessionsStore(options.userDataPath)
    this.webSearchConfig = options.webSearch ?? null
    this.mcpAuth = options.mcpAuth ?? []
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
    await this.skillsFor(this.options.workspacePath)
  }

  private skillsFor(workspace: string): Promise<SkillDefinition[]> {
    let cached = this.skillCaches.get(workspace)
    if (!cached) {
      cached = loadSkills({
        userDataPath: this.options.userDataPath,
        workspacePath: workspace
      }).catch(() => [])
      this.skillCaches.set(workspace, cached)
    }
    return cached
  }

  listSessions(): SessionMeta[] {
    return this.store.list().filter((session) => !session.hidden)
  }

  listAgents(workspace = this.options.workspacePath): Promise<AgentDefinition[]> {
    return this.agents(workspace)
  }

  async listCommands(workspace = this.options.workspacePath): Promise<CommandDefinition[]> {
    const commands = await loadCommands({
      userDataPath: this.options.userDataPath,
      workspacePath: workspace
    })
    let prompts: Awaited<ReturnType<McpManagerLike['prompts']>> = []
    let timer: NodeJS.Timeout | undefined
    try {
      prompts = await Promise.race([
        this.mcp(workspace).prompts(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('MCP prompt discovery timed out')), 3_000)
        })
      ])
    } catch {
      /* MCP prompts are best effort */
    } finally {
      if (timer) clearTimeout(timer)
    }
    const names = new Set(commands.map((command) => command.name.toLowerCase()))
    const mcpCommands: CommandDefinition[] = prompts.map((prompt) => {
      let name = prompt.name
      if (names.has(name.toLowerCase())) {
        const base = `${prompt.name}-${prompt.server}`
        name = base
        let attempt = 2
        while (names.has(name.toLowerCase())) name = `${base}-${attempt++}`
      }
      names.add(name.toLowerCase())
      return {
        id: `mcp:${prompt.server}:${prompt.name}`,
        name,
        description: `MCP · ${prompt.server}${prompt.description ? ` · ${prompt.description}` : ''}`,
        template: '',
        agent: null,
        model: null,
        mcp: {
          server: prompt.server,
          prompt: prompt.name,
          arguments: prompt.arguments?.map((arg) => arg.name) ?? []
        },
        source: 'mcp'
      }
    })
    return [...commands, ...mcpCommands]
  }

  async mcpPrompt(
    server: string,
    prompt: string,
    args?: Record<string, string>,
    workspace = this.options.workspacePath
  ): Promise<string> {
    return this.mcp(workspace).getPrompt(server, prompt, args)
  }

  async setSessionAgent(id: string, agentId: string | null): Promise<SessionMeta> {
    const record = this.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    if (agentId) {
      const agents = await this.agents(record.session.directory ?? this.options.workspacePath)
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

  private agents(workspace = this.options.workspacePath): Promise<AgentDefinition[]> {
    return loadAgents({
      userDataPath: this.options.userDataPath,
      workspacePath: workspace
    })
  }

  private async resolveSessionDirectoryInput(directory?: string | null): Promise<string> {
    if (!directory) return this.options.workspacePath
    if (!path.isAbsolute(directory)) throw new Error('INVALID_SESSION_DIRECTORY')
    const stat = await fs.stat(directory).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('INVALID_SESSION_DIRECTORY')
    return fs.realpath(directory).catch(() => path.resolve(directory))
  }

  async createSession(directory?: string | null): Promise<SessionMeta> {
    const target = await this.resolveSessionDirectoryInput(directory)
    const session = await this.store.create({ directory: target })
    this.emit({ type: 'session.upsert', session })
    return session
  }

  async setSessionDirectory(id: string, directory: string | null): Promise<SessionMeta> {
    if (!this.store.get(id)) throw new Error('SESSION_NOT_FOUND')
    if (this.sessionBusy(id)) throw new Error('SESSION_BUSY')
    const target = await this.resolveSessionDirectoryInput(directory)
    if (this.sessionBusy(id)) throw new Error('SESSION_BUSY')
    const previous = this.sessionWorkspace(id)
    const session = await this.store.setDirectory(id, target)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.emit({ type: 'session.upsert', session })
    void this.releaseWorkspace(previous)
    return session
  }

  async renameSession(id: string, title: string): Promise<SessionMeta> {
    const session = await this.store.rename(id, title)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.emit({ type: 'session.upsert', session })
    return session
  }

  async setSessionModel(id: string, model: ModelRef | null): Promise<SessionMeta> {
    if (model) {
      const resolved = resolveModelRef(this.models, model).model
      if (model.variant && !(resolved.variants ?? []).some((item) => item.id === model.variant)) {
        throw new Error('INVALID_VARIANT')
      }
    }
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
    this.reserveSession(id)

    try {
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
    } finally {
      this.starting.delete(id)
    }
  }

  async undoSession(
    id: string,
    messageId?: string
  ): Promise<{ session: SessionMeta; prompt: string }> {
    const record = this.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    this.reserveSession(id)

    try {
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
          await this.snapshots.restorePaths(assistant.snapshotBefore, files)
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
      return { session: this.store.getSession(id) ?? staged.session, prompt }
    } finally {
      this.starting.delete(id)
    }
  }

  async redoSession(id: string): Promise<SessionMeta> {
    if (!this.store.get(id)) throw new Error('SESSION_NOT_FOUND')
    this.reserveSession(id)

    try {
      const redo = this.store.getRedo(id)
      if (!redo) throw new Error('NOTHING_TO_REDO')

      if (redo.snapshotAfter && redo.files.length > 0) {
        try {
          await this.snapshots.restorePaths(redo.snapshotAfter, redo.files)
        } catch {
          throw new Error('SNAPSHOT_RESTORE_FAILED')
        }
      }

      const session = await this.store.redo(id)
      if (!session) throw new Error('NOTHING_TO_REDO')
      this.emit({ type: 'session.upsert', session })
      await this.updateContextUsage(id)
      return this.store.getSession(id) ?? session
    } finally {
      this.starting.delete(id)
    }
  }

  async forkSession(id: string, messageId?: string): Promise<SessionMeta> {
    if (!this.store.get(id)) throw new Error('SESSION_NOT_FOUND')
    this.reserveSession(id)

    try {
      const session = await this.store.fork(id, messageId)
      if (!session) throw new Error('SESSION_NOT_FOUND')
      await this.copyForkAttachments(id, session.id)
      this.emit({ type: 'session.upsert', session })
      return session
    } finally {
      this.starting.delete(id)
    }
  }

  private async copyForkAttachments(sourceId: string, targetId: string): Promise<void> {
    const sourceDirectory = attachmentDirectory(this.options.userDataPath, sourceId)
    const targetDirectory = attachmentDirectory(this.options.userDataPath, targetId)
    const copied = new Map<string, string>()
    for (const message of this.store.getMessages(targetId) ?? []) {
      for (const part of message.parts) {
        if (part.type !== 'attachment') continue
        const source = part.attachment.path
        if (!(await isPathInsideDirectory(sourceDirectory, source))) continue
        const target = path.join(targetDirectory, path.basename(source))
        try {
          await fs.mkdir(targetDirectory, { recursive: true })
          await fs.copyFile(source, target)
          copied.set(source, target)
        } catch {
          /* missing attachment files keep their original path */
        }
      }
    }
    if (copied.size === 0) return
    await this.store.rewriteAttachmentPaths(targetId, (oldPath) => copied.get(oldPath) ?? oldPath)
  }

  searchSessions(query: string): SessionSearchResult[] {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    const results: SessionSearchResult[] = []
    for (const session of this.listSessions()) {
      if (session.title.toLowerCase().includes(needle)) {
        results.push({ session, snippet: session.title })
        continue
      }
      const messages = this.store.getMessages(session.id) ?? []
      for (const message of messages) {
        const text = message.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(' ')
        const index = text.toLowerCase().indexOf(needle)
        if (index === -1) continue
        const start = Math.max(0, index - 40)
        results.push({
          session,
          snippet: text.slice(start, index + needle.length + 60).trim()
        })
        break
      }
    }
    return results.slice(0, 20)
  }

  listPermissionRules(sessionId?: string): PermissionRule[] {
    return this.permissionRules.list(sessionId)
  }

  async prepareCompaction(id: string): Promise<boolean> {
    const record = this.store.get(id)
    if (!record || this.sessionBusy(id)) return false
    const target = record.session.model ?? this.models.defaultModel
    try {
      const contextWindow =
        resolveModelRef(this.models, target).model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
      const plan = planCompaction(
        record.messages,
        contextWindow,
        compactionKeepTokens(contextWindow),
        false,
        await this.tokenEncoder(target)
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
      const childRecord = this.store.get(child.id)
      await this.store.delete(child.id)
      await this.permissionRules.removeForSession(child.id)
      await this.snapshots.removeSession(child.id)
      await removeSessionAttachments(this.options.userDataPath, child.id)
      await this.options.browserRequest?.(child.id, 'close').catch(() => undefined)
      if (childRecord?.session.directory) {
        void this.releaseWorkspace(childRecord.session.directory)
      }
    }
    const removed = this.store.get(id)
    await this.store.delete(id)
    await this.permissionRules.removeForSession(id)
    await this.snapshots.removeSession(id)
    await removeSessionAttachments(this.options.userDataPath, id)
    await this.options.browserRequest?.(id, 'close').catch(() => undefined)
    if (removed?.session.directory) void this.releaseWorkspace(removed.session.directory)
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
        const resolved = resolveModelRef(models, session.model)
        if (
          session.model.variant &&
          !(resolved.model.variants ?? []).some((variant) => variant.id === session.model?.variant)
        ) {
          const record = this.store.get(session.id)
          const fallback = { ...session.model, variant: null }
          if (record) record.session.model = fallback
          void this.store.setModel(session.id, fallback)
        }
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

  private reserveSession(sessionId: string): void {
    if (this.runs.has(sessionId) || this.starting.has(sessionId)) {
      throw new Error('SESSION_BUSY')
    }
    this.starting.add(sessionId)
  }

  private sessionBusy(sessionId: string): boolean {
    return this.runs.has(sessionId) || this.starting.has(sessionId)
  }

  async sendChat(
    sessionId: string,
    text: string,
    requestedModel?: ModelRef | null,
    attachments: MessageAttachment[] = []
  ): Promise<void> {
    const content = text.trim()
    if (!content && attachments.length === 0) throw new Error('EMPTY_MESSAGE')
    const record = this.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    this.reserveSession(sessionId)

    try {
      const target = requestedModel ?? record.session.model ?? this.models.defaultModel
      resolveModelRef(this.models, target)

      if (requestedModel) {
        record.session.model = requestedModel
      }

      const user = makeUserMessage(sessionId, content, attachments)
      const assistant = makeAssistantMessage(sessionId)
      const config = await readAgentConfig(this.options.userDataPath)
      if (config.snapshots) {
        const workspace = this.sessionWorkspace(sessionId)
        assistant.snapshotBefore = await this.createSnapshotId(
          sessionId,
          workspace,
          await this.resolveRunReferences(config, workspace)
        )
      }
      if (!this.store.get(sessionId)) throw new Error('SESSION_NOT_FOUND')
      await this.store.appendMessage(sessionId, user)
      await this.store.appendMessage(sessionId, assistant)
      await this.store.setStatus(sessionId, 'running')

      this.emit({ type: 'message.upsert', message: structuredClone(user) })
      this.beginRun(sessionId, assistant, undefined, config)
    } finally {
      this.starting.delete(sessionId)
    }
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
      workspace: this.sessionWorkspace(sessionId),
      abort: new AbortController(),
      startedAt: Date.now(),
      steps: 0,
      config,
      skipHistoryIds,
      agent: null,
      depth: 0
    }
    this.runs.set(sessionId, run)
    void this.runAgent(run).catch((error) => {
      this.runs.delete(sessionId)
      const message = normalizeError(error)
      void this.store.setStatus(sessionId, 'error').catch(() => undefined)
      this.emit({
        type: 'run.finished',
        sessionId,
        messageId: assistant.id,
        status: 'failed',
        error: message,
        usage: undefined,
        durationMs: Date.now() - run.startedAt
      })
      this.emitSession(sessionId)
    })
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
    this.reserveSession(sessionId)

    try {
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
        const workspace = this.sessionWorkspace(sessionId)
        assistant.snapshotBefore = await this.createSnapshotId(
          sessionId,
          workspace,
          await this.resolveRunReferences(config, workspace)
        )
      }
      if (!this.store.get(sessionId)) throw new Error('SESSION_NOT_FOUND')
      await this.store.appendMessage(sessionId, assistant)
      await this.store.setStatus(sessionId, 'running')
      this.beginRun(sessionId, assistant, new Set([last.id]), config)
    } finally {
      this.starting.delete(sessionId)
    }
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
    const deadline = Date.now() + 1_000
    while (this.runs.size > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    }
    if (this.runs.size === 0) {
      await this.store.close().catch(() => undefined)
    } else {
      await this.store.flush()
    }
    const lspManagers = [...this.lspManagers.values()]
    this.lspManagers.clear()
    for (const manager of lspManagers) {
      await manager.dispose()
    }
    const mcpManagers = [...new Set(this.mcpManagers.values())]
    this.mcpManagers.clear()
    for (const manager of mcpManagers) {
      await manager.dispose()
    }
  }

  private mcp(workspace = this.options.workspacePath): McpManagerLike {
    let manager = this.mcpManagers.get(workspace)
    if (!manager) {
      manager = this.deps.createMcpManager({
        userDataPath: this.options.userDataPath,
        workspacePath: workspace,
        mcpAuth: this.mcpAuth,
        onMcpAuth: (auth) => this.options.onMcpAuth?.(auth)
      })
      this.mcpManagers.set(workspace, manager)
    }
    return manager
  }

  async setTransientMcpServers(
    servers: import('@ateam/shared').McpServerInput[],
    workspace = this.options.workspacePath
  ): Promise<void> {
    await this.mcp(workspace).setTransientServers(servers)
  }

  async setMcpAuth(auths: McpAuthRecord[]): Promise<void> {
    this.mcpAuth = auths
    await Promise.all(
      [...new Set(this.mcpManagers.values())].map((manager) => manager.setMcpAuth(auths))
    )
  }

  listMcpServers(): Promise<McpServerConfig[]> {
    return this.mcp().servers()
  }

  mcpStatuses(options?: { probe?: boolean }): Promise<McpServerStatus[]> {
    return this.mcp().statuses(options)
  }

  async addMcpServer(input: McpServerInput): Promise<McpServerConfig> {
    const server = await this.mcp().addServer(input)
    await this.resetWorkspaceMcpManagers()
    return server
  }

  async updateMcpServer(id: string, input: Partial<McpServerInput>): Promise<McpServerConfig> {
    const server = await this.mcp().updateServer(id, input)
    await this.resetWorkspaceMcpManagers()
    return server
  }

  async removeMcpServer(id: string): Promise<boolean> {
    const removed = await this.mcp().removeServer(id)
    await this.resetWorkspaceMcpManagers()
    return removed
  }

  private async resetWorkspaceMcpManagers(): Promise<void> {
    for (const [workspace, manager] of this.mcpManagers) {
      if (path.resolve(workspace) === path.resolve(this.options.workspacePath)) continue
      this.mcpManagers.delete(workspace)
      await manager.dispose().catch(() => undefined)
    }
  }

  setWebSearch(config: RuntimeWebSearchConfig | null): void {
    this.webSearchConfig = config
  }

  private lsp(workspace: string): LspManager {
    let manager = this.lspManagers.get(workspace)
    if (!manager) {
      manager = new LspManager({ workspace })
      this.lspManagers.set(workspace, manager)
    }
    return manager
  }

  private formatters(workspace: string): Promise<FormatterDefinition[]> {
    let cached = this.formatterCaches.get(workspace)
    if (!cached) {
      cached = discoverFormatters(workspace).catch(() => [])
      this.formatterCaches.set(workspace, cached)
    }
    return cached
  }

  private async releaseWorkspace(workspace: string): Promise<void> {
    if (path.resolve(workspace) === path.resolve(this.options.workspacePath)) return
    const inUse =
      [...this.runs.values()].some(
        (run) => path.resolve(run.workspace) === path.resolve(workspace)
      ) ||
      this.store
        .list()
        .some(
          (session) =>
            session.directory && path.resolve(session.directory) === path.resolve(workspace)
        )
    if (inUse) return
    const manager = this.lspManagers.get(workspace)
    this.lspManagers.delete(workspace)
    this.formatterCaches.delete(workspace)
    this.skillCaches.delete(workspace)
    await manager?.dispose().catch(() => undefined)
    const mcp = this.mcpManagers.get(workspace)
    this.mcpManagers.delete(workspace)
    await mcp?.dispose().catch(() => undefined)
  }

  private async formatFiles(
    workspace: string,
    files: string[],
    overrides: Record<string, string> = {}
  ): Promise<string> {
    const formatters = await this.formatters(workspace)
    const notes: string[] = []
    for (const file of files) {
      const result = await formatFile(file, formatters, workspace, { overrides })
      const relative = path.relative(workspace, file).split(path.sep).join('/')
      if (result.formatted) {
        notes.push(`Formatted ${relative} with ${result.formatter}`)
      } else if (result.error) {
        notes.push(`Formatter failed for ${relative}: ${result.error}`)
      }
    }
    return notes.join('\n')
  }

  private async lspHover(
    workspace: string,
    file: string,
    line: number,
    character: number
  ): Promise<string> {
    return this.lsp(workspace).hover(file, line, character)
  }

  private async lspDefinition(
    workspace: string,
    file: string,
    line: number,
    character: number
  ): Promise<string> {
    return this.lsp(workspace).definition(file, line, character)
  }

  private async diagnoseFiles(workspace: string, files: string[]): Promise<string> {
    try {
      return formatDiagnosticReport(await this.lsp(workspace).diagnostics(files), workspace)
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

  private async listMcpPrompts(
    server?: string,
    workspace = this.options.workspacePath
  ): Promise<string> {
    try {
      const prompts = await this.mcp(workspace).prompts()
      const filtered = server
        ? prompts.filter((prompt) => prompt.server.toLowerCase() === server.toLowerCase())
        : prompts
      if (filtered.length === 0) return 'No MCP prompts available.'
      return [
        'MCP prompts:',
        ...filtered.map(
          (prompt) =>
            `- ${prompt.server}/${prompt.name}${prompt.description ? `: ${prompt.description}` : ''}`
        )
      ].join('\n')
    } catch (error) {
      return `Error: ${errorMessage(error)}`
    }
  }

  private async getMcpPrompt(
    server: string,
    prompt: string,
    args?: Record<string, string>,
    workspace = this.options.workspacePath
  ): Promise<string> {
    try {
      return await this.mcp(workspace).getPrompt(server, prompt, args)
    } catch (error) {
      return this.mcpError(error, server)
    }
  }

  private async listMcpResources(
    server?: string,
    workspace = this.options.workspacePath
  ): Promise<string> {
    try {
      const resources = await this.mcp(workspace).resources()
      const filtered = server
        ? resources.filter((resource) => resource.server.toLowerCase() === server.toLowerCase())
        : resources
      if (filtered.length === 0) return 'No MCP resources available.'
      return [
        'MCP resources:',
        ...filtered.map((resource) => {
          const details = [resource.name, resource.mimeType].filter(Boolean).join(', ')
          return `- ${resource.server}: ${resource.uri}${details ? ` (${details})` : ''}`
        })
      ].join('\n')
    } catch (error) {
      return `Error: ${errorMessage(error)}`
    }
  }

  private async readMcpResource(
    server: string,
    uri: string,
    workspace = this.options.workspacePath
  ): Promise<string> {
    try {
      return await this.mcp(workspace).readResource(server, uri)
    } catch (error) {
      return this.mcpError(error, server)
    }
  }

  private mcpError(error: unknown, server: string): string {
    const message = errorMessage(error)
    return message.includes('UNKNOWN_MCP_SERVER')
      ? `Error: unknown MCP server: ${server}`
      : `Error: ${message}`
  }

  private startBackgroundSubagent(
    run: Run,
    info: {
      parentSessionId: string
      toolCallId: string
      agentId: string
      cleanup: () => void
    }
  ): void {
    void this.runAgent(run)
      .catch(() => undefined)
      .finally(() => {
        info.cleanup()
        const record = this.store.get(run.sessionId)
        const message = record?.messages.find((entry) => entry.id === run.messageId)
        const result = (message?.parts ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
          .trim()
        const status =
          message?.status === 'complete'
            ? 'completed'
            : message?.status === 'interrupted'
              ? 'interrupted'
              : 'failed'
        this.emit({
          type: 'subagent.finished',
          sessionId: run.sessionId,
          parentSessionId: info.parentSessionId,
          toolCallId: info.toolCallId,
          agentId: info.agentId,
          status,
          result: result.slice(0, 2_000)
        })
      })
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

  private async maybeGenerateTitle(
    run: Run,
    model: LanguageModel,
    message: ChatMessage
  ): Promise<void> {
    const record = this.store.get(run.sessionId)
    if (!record || record.session.hidden || record.messages.length !== 2) return
    const firstUser = record.messages.find((entry) => entry.role === 'user')
    const userText = (firstUser?.parts ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
    if (!userText.trim() || record.session.title !== makeTitle(userText)) return

    const assistantText = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ')
      .slice(0, 1_000)
    try {
      const title = await this.deps.generateTitle({
        model,
        prompt: [
          'Create a concise title for this conversation. Reply with the title only, at most 6 words, without quotes.',
          `User: ${userText.slice(0, 1_000)}`,
          `Assistant: ${assistantText}`
        ].join('\n')
      })
      const cleaned = title
        .replace(/["'`#*]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
      if (!cleaned) return
      const session = await this.store.rename(run.sessionId, cleaned)
      if (session) this.emit({ type: 'session.upsert', session })
    } catch {
      /* keep the derived title */
    }
  }

  private askQuestion(run: Run, input: QuestionInput, toolCallId: string): Promise<string> {
    const id = randomUUID()
    const request: QuestionRequest = {
      id,
      sessionId: run.parentSessionId ?? run.sessionId,
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
        agents: (workspace) => this.agents(workspace),
        createSnapshotId: (sessionId, references) =>
          this.createSnapshotId(sessionId, this.sessionWorkspace(sessionId), references),
        referencesFor: (workspace, config) => this.resolveRunReferences(config, workspace),
        record: (sessionId) => this.record(sessionId),
        hasRun: (sessionId) => this.runs.has(sessionId),
        registerRun: (sessionId, run) => {
          this.runs.set(sessionId, run)
        },
        askPermission: (target, action, resource, toolName, callId, rules) =>
          this.askPermission(target, action, resource, toolName, callId, rules),
        runAgent: (run) => this.runAgent(run),
        startBackground: (run, info) => this.startBackgroundSubagent(run, info)
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
      if (record?.session.hidden && event.type !== 'subagent.finished') return
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
    toolCallId: string,
    agentRulesOverride?: AgentPermissionRule[]
  ): Promise<boolean> {
    if (run.permissionDelegate) {
      return run.permissionDelegate(
        action,
        resource,
        toolName,
        toolCallId,
        run.agent?.permissions ?? []
      )
    }
    if (
      action === 'external_directory' &&
      isInsideReferences(resource, run.references ?? [], run.workspace)
    ) {
      return true
    }
    const mode = this.store.get(run.sessionId)?.session.permissionMode ?? 'ask'
    const scan = action === 'shell' ? scanShellCommand(resource, run.workspace) : null
    const resources = scan && scan.segments.length > 0 ? scan.segments : [resource]
    const storedRules = this.permissionRules.list(run.sessionId)
    const globalRules = storedRules.filter((rule) => rule.sessionId === null)
    const sessionRules = storedRules.filter((rule) => rule.sessionId !== null)
    const agentRules = agentRulesOverride ?? run.agent?.permissions ?? []
    const rules = [
      ...modePermissionRules(mode),
      ...globalRules,
      ...agentRules.map((rule, index) => ({
        id: `agent-${run.sessionId}-${index}`,
        action: rule.action,
        resource: rule.resource,
        effect: rule.effect,
        sessionId: null,
        createdAt: ''
      })),
      ...sessionRules,
      ...(run.policyRules ?? [])
    ]
    const effect = evaluatePermissionRules(rules, {
      action,
      resources,
      sessionId: run.sessionId
    })
    if (effect === 'deny') return false

    let externalEffect: PermissionEffect = 'allow'
    const externalPaths = (scan?.externalPaths ?? []).filter(
      (externalPath) => !isInsideReferences(externalPath, run.references ?? [], run.workspace)
    )
    if (externalPaths.length > 0) {
      externalEffect =
        evaluatePermissionRules(rules, {
          action: 'external_directory',
          resources: externalPaths,
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
    sessionId: string,
    messages: ChatMessage[]
  ): Promise<Map<string, AttachmentPayload>> {
    const payloads = new Map<string, AttachmentPayload>()
    const directory = attachmentDirectory(this.options.userDataPath, sessionId)
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== 'attachment') continue
        const attachment = part.attachment
        if (payloads.has(attachment.id)) continue
        if (!(await isPathInsideDirectory(directory, attachment.path))) continue
        try {
          if (attachment.kind === 'text') {
            payloads.set(attachment.id, {
              kind: 'text',
              name: attachment.name,
              mimeType: attachment.mimeType,
              text: await readTextAttachment(attachment)
            })
          } else if (attachment.kind === 'pdf') {
            const data = await readAttachment(attachment)
            payloads.set(attachment.id, {
              kind: 'pdf',
              name: attachment.name,
              mimeType: attachment.mimeType,
              data,
              text: await extractPdfText(data)
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
    force = false,
    requestedTarget?: ModelRef | null
  ): Promise<SessionMeta | null> {
    const record = this.record(sessionId)
    const target = requestedTarget ?? record.session.model ?? this.models.defaultModel
    const contextWindow =
      resolveModelRef(this.models, target).model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const encode = await this.tokenEncoder(target)
    const plan = planCompaction(
      messages,
      contextWindow,
      compactionKeepTokens(contextWindow),
      force,
      encode
    )
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
      tokensAfter: estimateMessagesTokens(plan.keep, encode) + estimateTextTokens(summary, encode)
    })
    if (!session) return null
    this.emit({ type: 'session.upsert', session })
    await this.updateContextUsage(sessionId)
    return this.store.getSession(sessionId) ?? session
  }

  private async compactForOverflow(run: Run): Promise<boolean> {
    const record = this.record(run.sessionId)
    const target = this.resolveAgentTarget(run.agent, record.session.model)
    const model = this.deps.createLanguageModel(this.models, target, {
      sessionId: run.sessionId
    })
    const session = await this.compactMessages(
      run.sessionId,
      this.historyMessages(run, run.messageId),
      model,
      run.abort.signal,
      true,
      target
    )
    return session !== null
  }

  private resetAssistantMessage(run: Run, message: ChatMessage): void {
    message.parts = []
    message.error = undefined
    message.usage = undefined
    message.contextUsage = undefined
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
      const encode = await this.tokenEncoder(target)
      const tokens =
        estimateContextTokens(history, {
          usageCreatedAfter: record.session.compaction?.createdAt,
          encode
        }) + estimateTextTokens(record.session.compaction?.summary ?? '', encode)
      const session = await this.store.setContextUsage(sessionId, tokens, window)
      if (session) this.emit({ type: 'session.upsert', session })
    } catch {
      /* usage display is best effort */
    }
  }

  private sessionWorkspace(sessionId: string): string {
    return this.store.getSession(sessionId)?.directory ?? this.options.workspacePath
  }

  private async tokenEncoder(target: ModelRef | null): Promise<TokenCounter | undefined> {
    try {
      const resolved = resolveModelRef(this.models, target)
      return await tokenCounterFor(resolved.provider.type, resolved.model.modelId)
    } catch {
      return undefined
    }
  }

  private async resolveRunReferences(
    config: AgentConfig,
    workspace = this.options.workspacePath
  ): Promise<ResolvedReference[]> {
    if ((config.references?.length ?? 0) === 0 && !hasProjectReferences(workspace)) return []
    return resolveReferences({
      references: config.references ?? [],
      workspacePath: workspace,
      globalDirectory: path.join(this.options.userDataPath, 'agent'),
      cacheDirectory: path.join(this.options.userDataPath, 'agent', 'references')
    }).catch(() => [])
  }

  private async createSnapshotId(
    sessionId: string,
    workspace = this.sessionWorkspace(sessionId),
    references: Array<{ alias: string; root: string }> = []
  ): Promise<string | undefined> {
    try {
      const snapshot = await this.snapshots.create(workspace, sessionId, references)
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
      const snapshot = await this.snapshots.create(run.workspace, run.sessionId, run.references)
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
      const snapshot = await this.snapshots.create(run.workspace, run.sessionId, run.references)
      const diff = await this.snapshots.diff(message.snapshotBefore, snapshot.id)
      message.snapshotAfter = snapshot.id
      message.changedFiles = [...diff.added, ...diff.modified, ...diff.deleted]
      await this.store.persist(run.sessionId)
    } catch {
      /* snapshots are best effort */
    }
  }

  private async browserAction(
    run: Run,
    method: string,
    params?: Record<string, unknown>
  ): Promise<string> {
    if (!this.options.browserRequest) return 'Error: browser automation is not available.'
    try {
      const result = await this.options.browserRequest(run.sessionId, method, params)
      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (error) {
      return `Error: ${errorMessage(error)}`
    }
  }

  private async browserCapture(
    run: Run,
    tabId?: string
  ): Promise<string | { summary: string; image: { mimeType: string; data: string } }> {
    if (!this.options.browserRequest) return 'Error: browser automation is not available.'
    try {
      const result = await this.options.browserRequest(run.sessionId, 'screenshot', { tabId })
      if (result && typeof result === 'object' && 'image' in result) {
        return result as { summary: string; image: { mimeType: string; data: string } }
      }
      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (error) {
      return `Error: ${errorMessage(error)}`
    }
  }

  private worktreeErrorMessage(error: unknown): string {
    const messages: Record<string, string> = {
      NOT_A_GIT_REPOSITORY: 'The workspace is not a Git repository.',
      INVALID_WORKTREE_NAME: 'The worktree name is not valid.',
      WORKTREE_EXISTS: 'A worktree already exists at that directory.',
      WORKTREE_NOT_FOUND: 'No managed worktree matches that path.',
      WORKTREE_MAIN: 'The main checkout cannot be removed.',
      WORKTREE_OUTSIDE_ROOT: 'Only worktrees created by ATeam can be removed.',
      SESSION_DIRECTORY_INVALID: 'The target directory does not exist.',
      SESSION_DIRECTORY_NOT_ALLOWED:
        'Sessions can only move inside their workspace, a managed worktree, or another worktree of the same repository.'
    }
    const message = errorMessage(error)
    return messages[message] ?? message
  }

  private async createSessionWorktree(
    run: Run,
    input: { name: string; base?: string | null }
  ): Promise<string> {
    try {
      const repository = await repositoryRoot(run.workspace)
      const root = worktreeRootFor(this.options.userDataPath, repository)
      const info = await createWorktree(run.workspace, input, { root })
      return `Created worktree ${info.branch ?? info.path} at ${info.path}.\nUse session_move with this directory to continue there.`
    } catch (error) {
      return `Error: ${this.worktreeErrorMessage(error)}`
    }
  }

  private async listSessionWorktrees(run: Run): Promise<string> {
    try {
      const entries = await listWorktrees(run.workspace)
      const lines = entries.map(
        (entry) => `- ${entry.path} · ${entry.branch ?? 'detached'}${entry.main ? ' (main)' : ''}`
      )
      return ['Worktrees:', ...lines].join('\n')
    } catch (error) {
      return `Error: ${this.worktreeErrorMessage(error)}`
    }
  }

  private async removeSessionWorktree(run: Run, target: string, force: boolean): Promise<string> {
    try {
      const real = await fs.realpath(target).catch(() => path.resolve(target))
      const inUse =
        [...this.runs.values()].some((active) => path.resolve(active.workspace) === real) ||
        this.store
          .list()
          .some((session) => session.directory && path.resolve(session.directory) === real)
      if (inUse) {
        return 'Error: this worktree is in use by a session; move the session before removing it.'
      }
      const repository = await repositoryRoot(run.workspace)
      const root = worktreeRootFor(this.options.userDataPath, repository)
      await removeWorktree(run.workspace, target, { root, force })
      return `Removed worktree ${target}.`
    } catch (error) {
      return `Error: ${this.worktreeErrorMessage(error)}`
    }
  }

  private async resolveSessionDirectory(current: string, target: string): Promise<string> {
    if (!path.isAbsolute(target)) throw new Error('SESSION_DIRECTORY_INVALID')
    const real = await fs.realpath(target).catch(() => path.resolve(target))
    const stat = await fs.stat(real).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('SESSION_DIRECTORY_INVALID')

    const currentReal = await fs.realpath(current).catch(() => path.resolve(current))
    if (real === currentReal || isPathInside(currentReal, real)) return real

    try {
      const repository = await repositoryRoot(current)
      const root = worktreeRootFor(this.options.userDataPath, repository)
      if (isPathInside(root, real)) return real
      const worktrees = await listWorktrees(current)
      if (worktrees.some((entry) => path.resolve(entry.path) === real)) return real
    } catch {
      /* not a repository */
    }
    throw new Error('SESSION_DIRECTORY_NOT_ALLOWED')
  }

  private async moveSession(run: Run, target: string): Promise<string> {
    try {
      const previous = run.workspace
      const directory = await this.resolveSessionDirectory(run.workspace, target)
      const session = await this.store.setDirectory(run.sessionId, directory)
      if (session) this.emit({ type: 'session.upsert', session })
      void this.releaseWorkspace(previous)
      return `Session will move to ${directory} on the next message.`
    } catch (error) {
      return `Error: ${this.worktreeErrorMessage(error)}`
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
    let lastStepUsage: TokenUsage | undefined
    let runTarget: ModelRef | null = null
    let finishReason = ''
    let prepareCompaction = false

    try {
      const record = this.record(run.sessionId)
      const policy = loadOrgPolicy({
        userDataPath: this.options.userDataPath,
        envPolicyFile: process.env.ATEAM_POLICY_FILE
      })
      run.policyRules = policy.rules.map((rule, index) => ({
        id: `policy-${index}`,
        action: rule.action,
        resource: rule.resource,
        effect: rule.effect,
        sessionId: null,
        createdAt: ''
      }))
      const agent =
        run.agent ??
        (record.session.agent
          ? ((await this.agents(run.workspace)).find(
              (candidate) => candidate.id === record.session.agent
            ) ?? null)
          : null)
      run.agent = agent
      const target = this.resolveAgentTarget(agent, record.session.model)
      runTarget = target
      const model = this.deps.createLanguageModel(this.models, target, {
        sessionId: run.sessionId
      })
      const resolvedTarget = resolveModelRef(this.models, target)
      const targetInfo = resolvedTarget.model
      const variantId = target?.variant
      const variant = variantId
        ? (targetInfo.variants ?? []).find((candidate) => candidate.id === variantId)
        : undefined
      if (variantId && !variant) throw new Error('INVALID_VARIANT')
      const variantSettings = variant?.settings ?? {}
      const contextWindow = targetInfo.contextWindow ?? DEFAULT_CONTEXT_WINDOW
      const nativeCompaction =
        targetInfo.compaction === true && resolvedTarget.provider.type === 'anthropic'
      const history = this.historyMessages(run, message.id)
      if (
        !nativeCompaction &&
        shouldCompact(history, contextWindow, {
          usageCreatedAfter: record.session.compaction?.createdAt,
          encode: await this.tokenEncoder(target)
        })
      ) {
        await this.compactMessages(run.sessionId, history, model, run.abort.signal, false, target)
      }

      const current = this.record(run.sessionId)
      const instructions = [
        ...(await this.deps.loadInstructions({
          workspacePath: run.workspace,
          globalDirectory: this.options.userDataPath
        })),
        ...(run.config.instructions.length > 0
          ? await loadConfiguredInstructions(run.config.instructions, run.workspace)
          : [])
      ]
      const loadedInstructionPaths = new Set(instructions.map((file) => file.path))
      const skills = await this.skillsFor(run.workspace)
      const references = await this.resolveRunReferences(run.config, run.workspace)
      run.references = references
      const toolContext: ToolContext = {
        workspace: run.workspace,
        signal: run.abort.signal,
        askPermission: (action, resource, toolName, toolCallId) =>
          this.askPermission(run, action, resource, toolName, toolCallId),
        loadNestedInstructions: async (targetPath) => {
          const nested = await discoverNestedInstructions(
            run.workspace,
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
        formatFiles: run.config.formatters
          ? (files) => this.formatFiles(run.workspace, files, run.config.formatterOverrides)
          : undefined,
        diagnoseFiles: run.config.lsp
          ? (files) => this.diagnoseFiles(run.workspace, files)
          : undefined,
        lspHover: run.config.lsp
          ? (file, line, character) => this.lspHover(run.workspace, file, line, character)
          : undefined,
        lspDefinition: run.config.lsp
          ? (file, line, character) => this.lspDefinition(run.workspace, file, line, character)
          : undefined,
        runSubagent: (input, toolCallId) => this.runSubagent(run, input, toolCallId),
        fetchWeb: (input) => this.fetchWebPage(input),
        webSearch: (input) => this.searchTheWeb(input),
        loadSkill: async (name) => {
          const skill = skills.find(
            (candidate) =>
              candidate.name.toLowerCase() === name.toLowerCase() ||
              candidate.id === name.toLowerCase()
          )
          if (!skill) return `Error: unknown skill: ${name}`
          const sections = [`# ${skill.name}`, '', skill.content]
          sections.push('', `Skill directory: ${path.dirname(skill.path)}`)
          if (skill.resources.length > 0) {
            sections.push('Resource files:', ...skill.resources.map((file) => `- ${file}`))
          }
          return sections.join('\n')
        },
        writeTodos: (todos) => this.writeTodos(run, todos),
        readTodos: async () => this.readTodos(run),
        askQuestion: (input, toolCallId) => this.askQuestion(run, input, toolCallId),
        listMcpPrompts: (server) => this.listMcpPrompts(server, run.workspace),
        getMcpPrompt: (server, prompt, args) =>
          this.getMcpPrompt(server, prompt, args, run.workspace),
        listMcpResources: (server) => this.listMcpResources(server, run.workspace),
        readMcpResource: (server, uri) => this.readMcpResource(server, uri, run.workspace),
        worktreeCreate: (input) => this.createSessionWorktree(run, input),
        worktreeList: () => this.listSessionWorktrees(run),
        worktreeRemove: (target, force) => this.removeSessionWorktree(run, target, force),
        moveSession: (directory) => this.moveSession(run, directory),
        browserOpen: (url) => this.browserAction(run, 'open', { url }),
        browserSnapshot: () => this.browserAction(run, 'snapshot'),
        browserClick: (ref) => this.browserAction(run, 'click', { ref }),
        browserType: (ref, text, submit) => this.browserAction(run, 'type', { ref, text, submit }),
        browserScreenshot: () => this.browserCapture(run),
        browserEval: (code) => this.browserAction(run, 'eval', { code }),
        browserNetwork: () => this.browserAction(run, 'network'),
        browserUpload: (ref, filePath) =>
          this.browserAction(run, 'upload', { ref, path: filePath }),
        browserClose: () => this.browserAction(run, 'close')
      }
      const baseTools = this.deps.createTools(toolContext)
      let mcpTools: ToolSet = {}
      try {
        mcpTools = await this.mcp(run.workspace).tools(toolContext)
      } catch {
        /* MCP servers are best effort */
      }
      const tools = filterToolsForAgent(
        filterToolsForModel({ ...mcpTools, ...baseTools }, targetInfo.applyPatch === true),
        agent
      )
      toolContext.codeModeTools = () => tools

      const systemSections = [
        systemWithInstructions(
          systemWithSummary(
            buildSystemPrompt(run.workspace, current.session.permissionMode ?? 'ask'),
            current.session.compaction?.summary
          ),
          instructions
        )
      ]
      if (agent?.prompt) systemSections.push(agent.prompt)
      const referenceSection = referencesPrompt(references)
      if (referenceSection) systemSections.push(referenceSection)
      const skillSection = skillsPrompt(skills)
      if (skillSection) systemSections.push(skillSection)
      const system = systemSections.join('\n\n')

      const modelHistory = this.historyMessages(run, message.id)
      const result = this.deps.createTurn({
        model,
        system,
        messages: buildModelMessages(
          modelHistory,
          await this.attachmentPayloads(run.sessionId, modelHistory)
        ),
        tools,
        abortSignal: run.abort.signal,
        reasoning: variantSettings.reasoningEffort ?? current.session.reasoningEffort,
        maxSteps: agent?.maxSteps ?? undefined,
        maxOutputTokens: variantSettings.maxOutputTokens ?? targetInfo.maxOutputTokens,
        temperature: agent?.temperature ?? variantSettings.temperature ?? undefined,
        providerOptions: nativeCompaction
          ? resolvedTarget.provider.type === 'anthropic'
            ? {
                anthropic: {
                  contextManagement: {
                    edits: [
                      {
                        type: 'compact_20260112',
                        trigger: { type: 'input_tokens', value: contextTokenLimit(contextWindow) }
                      }
                    ]
                  }
                }
              }
            : {
                openai: {
                  contextManagement: [
                    { type: 'compaction', compactThreshold: contextTokenLimit(contextWindow) }
                  ]
                }
              }
          : undefined
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
                const output = part.output as unknown
                if (
                  output &&
                  typeof output === 'object' &&
                  'summary' in output &&
                  'image' in output
                ) {
                  const media = output as {
                    summary: string
                    image: { mimeType: string; data: string }
                  }
                  toolPart.output = media.summary
                  toolPart.images = [media.image]
                } else {
                  toolPart.output =
                    typeof part.output === 'string' ? part.output : JSON.stringify(part.output)
                }
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
            if (part.usage) lastStepUsage = usageFrom(part.usage)
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
      message.contextUsage = lastStepUsage
      message.costUsd = this.messageCost(runTarget, usage)
      this.settleTools(message, 'Tool call did not finish')
      await this.recordAfterSnapshot(run, message)
      await this.store.persist(run.sessionId)
      this.emit({ type: 'message.upsert', message: structuredClone(message) })
      await this.updateContextUsage(run.sessionId)
      prepareCompaction = true
      await this.store.setStatus(run.sessionId, 'idle')
      this.emitSession(run.sessionId)
      await this.maybeGenerateTitle(run, model, message)
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
      message.contextUsage = lastStepUsage
      message.costUsd = this.messageCost(runTarget, usage)
      this.settleTools(message, interrupted ? 'Interrupted by user' : 'Tool call failed')
      await this.recordAfterSnapshot(run, message)
      await this.store.persist(run.sessionId)
      this.emit({ type: 'message.upsert', message: structuredClone(message) })
      await this.updateContextUsage(run.sessionId)
      prepareCompaction = true
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
      if (prepareCompaction) this.schedulePreparedCompaction(run.sessionId)
      this.emitSession(run.sessionId)
      void this.releaseWorkspace(run.workspace)
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
