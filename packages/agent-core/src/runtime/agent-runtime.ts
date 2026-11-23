import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import type {
  AgentConfig,
  AgentDefinition,
  ChatMessage,
  CommandDefinition,
  EffectiveAgentConfig,
  MessagesSnapshot,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  MessageAttachment,
  ModelRef,
  PermissionDecision,
  PermissionRequest,
  PermissionRule,
  PermissionRuleInput,
  QuestionAnswer,
  QuestionRequest,
  RunOutcome,
  RuntimeModelsConfig,
  RuntimeWebSearchConfig,
  SessionMeta,
  SessionSearchResult,
  SessionSettings,
  McpAuthRecord,
  SubagentInput,
  TodoInput,
  TokenUsage,
  TurnChanges
} from '@ateam/shared'
import { DEFAULT_CONTEXT_WINDOW, messagesAfterCompaction, shouldCompact } from '../sessions/context'
import { readEffectiveAgentConfig } from '../config/config-store'
import { loadOrgPolicy } from '../config/org-policy'
import { PermissionsStore } from '../config/permissions-store'
import { SessionsStore, type SessionRecord, makeTitle } from '../sessions/sessions-store'
import { SnapshotStore } from '../sessions/snapshots'
import { ToolOutputStore } from '../sessions/tool-output-store'
import type { AttachmentPayload } from '../message-history'
import {
  attachmentDirectory,
  isPathInsideDirectory,
  extractPdfText,
  readAttachment,
  readTextAttachment,
  removeSessionAttachments
} from '../attachments'
import { mergeRuntimeProviders, resolveModelRef } from '../providers'
import { expandCommandTemplate, loadCommands, runWorkspaceShell } from '../commands'
import { hasProjectReferences, resolveReferences, type ResolvedReference } from '../references'
import { formatTodoList, normalizeTodos } from '../todos'
import { computeMessageCost } from '../cost'
import type { McpManagerLike } from '../integrations/mcp'
import { normalizeError } from '../errors'
import {
  createWorktree,
  isPathInside,
  listWorktrees,
  removeWorktree,
  repositoryRoot,
  worktreeRootFor
} from '../worktrees'
import { CompactionService } from './compaction-service'
import { DEFAULT_DEPENDENCIES } from './defaults'
import { isContextLengthError } from './helpers'
import { errorMessage, makeAssistantMessage, makeUserMessage, nowIso, usageFrom } from './messages'
import { PermissionService } from './permission-service'
import {
  appendToolOutput,
  emitPart,
  ensureToolPart,
  findToolPart,
  settleTools
} from './run-messages'
import { prepareRun, type RunPreparationHost } from './run-preparation'
import { RuntimeEvents } from './runtime-events'
import { SessionService } from './session-service'
import { runSubagentTask } from './subagents'
import type { ToolContextHost } from './tool-context'
import {
  allowedChangePaths,
  buildTurnChanges,
  latestSnapshotMessage,
  type TurnChangesHost
} from './turn-changes'
import {
  MAX_STEPS,
  type AgentRuntimeDependencies,
  type AgentRuntimeOptions,
  type Run
} from './types'
import { WorkspaceServices } from './workspace-services'

export class AgentRuntime {
  private readonly store: SessionsStore
  private readonly permissionRules: PermissionsStore
  private readonly snapshots: SnapshotStore
  private readonly toolOutputs: ToolOutputStore
  private readonly runs = new Map<string, Run>()
  private readonly starting = new Set<string>()
  private models: RuntimeModelsConfig
  private readonly effectiveModels: Map<string, RuntimeModelsConfig>
  private readonly projectProviderConfigs = new Map<string, AgentConfig['providers']>()
  private readonly deps: AgentRuntimeDependencies
  private readonly events: RuntimeEvents
  private readonly compaction: CompactionService
  private readonly workspaceServices: WorkspaceServices
  private readonly sessionService: SessionService
  private readonly permissionService: PermissionService

  constructor(private readonly options: AgentRuntimeOptions) {
    this.store = new SessionsStore(options.userDataPath)
    this.permissionRules = new PermissionsStore(options.userDataPath)
    this.snapshots = new SnapshotStore(options.userDataPath)
    this.toolOutputs = new ToolOutputStore(options.userDataPath)
    this.models = options.models
    this.effectiveModels = new Map()
    this.deps = { ...DEFAULT_DEPENDENCIES, ...options.dependencies }
    this.events = new RuntimeEvents({
      session: (sessionId) => this.store.getSession(sessionId) ?? null,
      isHidden: (sessionId) => this.store.get(sessionId)?.session.hidden ?? false,
      send: options.send,
      pluginsForSession: (sessionId) => this.runs.get(sessionId)?.plugins
    })
    this.compaction = new CompactionService({
      store: this.store,
      modelsFor: (sessionId) =>
        this.effectiveModels.get(this.sessionWorkspace(sessionId)) ?? this.models,
      deps: this.deps,
      emit: (event) => this.events.emit(event),
      sessionBusy: (sessionId) => this.sessionBusy(sessionId),
      record: (sessionId) => this.record(sessionId),
      historyMessages: (run, assistantMessageId) => this.historyMessages(run, assistantMessageId),
      resolveAgentTarget: (agent, sessionModel, models) =>
        this.resolveAgentTarget(agent, sessionModel, models)
    })
    this.workspaceServices = new WorkspaceServices(
      {
        userDataPath: options.userDataPath,
        defaultWorkspacePath: options.workspacePath,
        appVersion: options.appVersion ?? '0.0.0',
        createMcpManager: this.deps.createMcpManager,
        fetchWeb: this.deps.fetchWeb,
        searchWeb: this.deps.searchWeb,
        onMcpAuth: (auth) => options.onMcpAuth?.(auth),
        workspaceInUse: (workspace) => this.workspaceInUse(workspace)
      },
      { mcpAuth: options.mcpAuth, webSearch: options.webSearch }
    )
    this.sessionService = new SessionService({
      store: this.store,
      userDataPath: options.userDataPath,
      defaultWorkspacePath: options.workspacePath,
      models: () => this.models,
      modelsFor: (sessionId) => this.modelsForSession(sessionId),
      emit: (event) => this.events.emit(event),
      currentSeq: () => this.events.currentSeq,
      reserveSession: (sessionId) => this.reserveSession(sessionId),
      releaseSession: (sessionId) => {
        this.starting.delete(sessionId)
      },
      sessionBusy: (sessionId) => this.sessionBusy(sessionId),
      hasRun: (sessionId) => this.runs.has(sessionId),
      sessionWorkspace: (sessionId) => this.sessionWorkspace(sessionId),
      releaseWorkspace: (workspace) => this.workspaceServices.releaseWorkspace(workspace)
    })
    this.permissionService = new PermissionService({
      store: this.store,
      permissionRules: this.permissionRules,
      events: this.events,
      assistantFor: (run) => this.assistantFor(run),
      planFilePath: (run) => this.planFilePath(run),
      emitSession: (sessionId) => this.events.emitSession(sessionId)
    })
  }

  async init(): Promise<void> {
    await fs.mkdir(this.options.workspacePath, { recursive: true })
    await this.store.init()
    await this.permissionRules.init()
    await this.snapshots.init()
    await this.applyWorkspaceConfig(this.options.workspacePath)
    for (const session of this.store.list()) {
      const workspace = this.sessionWorkspace(session.id)
      if (workspace !== this.options.workspacePath) {
        await this.rememberWorkspaceConfig(workspace, false)
      }
    }
    await this.workspaceServices.skillsFor(this.options.workspacePath)
  }

  private async applyWorkspaceConfig(workspace: string): Promise<EffectiveAgentConfig> {
    return this.rememberWorkspaceConfig(workspace, true)
  }

  private async rememberWorkspaceConfig(
    workspace: string,
    applyServices: boolean
  ): Promise<EffectiveAgentConfig> {
    const effective = await readEffectiveAgentConfig(this.options.userDataPath, workspace)
    this.projectProviderConfigs.set(workspace, effective.config.providers)
    this.effectiveModels.set(
      workspace,
      mergeRuntimeProviders(this.models, effective.config.providers, process.env)
    )
    if (applyServices) await this.workspaceServices.applyConfig(workspace, effective)
    return effective
  }

  private modelsForConfig(workspace: string, config: AgentConfig): RuntimeModelsConfig {
    const models = mergeRuntimeProviders(this.models, config.providers, process.env)
    this.projectProviderConfigs.set(workspace, config.providers)
    this.effectiveModels.set(workspace, models)
    return models
  }

  private async modelsForWorkspace(
    workspace: string,
    config: AgentConfig
  ): Promise<RuntimeModelsConfig> {
    const base = this.modelsForConfig(workspace, config)
    const plugins = await this.workspaceServices.plugins(config, workspace)
    const output = { models: base }
    await plugins.transformProviders({ workspace, models: base }, output)
    output.models.providers = await plugins.applyAuth(workspace, output.models.providers)
    this.effectiveModels.set(workspace, output.models)
    return output.models
  }

  private modelsForSession(sessionId: string): RuntimeModelsConfig {
    return this.effectiveModels.get(this.sessionWorkspace(sessionId)) ?? this.models
  }

  listSessions(): SessionMeta[] {
    return this.sessionService.listSessions()
  }

  listAgents(workspace = this.options.workspacePath): Promise<AgentDefinition[]> {
    return this.sessionService.listAgents(workspace)
  }

  async listCommands(workspace = this.options.workspacePath): Promise<CommandDefinition[]> {
    const effective = await this.applyWorkspaceConfig(workspace)
    const commands = await loadCommands({
      userDataPath: this.options.userDataPath,
      workspacePath: workspace,
      config: effective.config
    })
    let prompts: Awaited<ReturnType<McpManagerLike['prompts']>> = []
    let timer: NodeJS.Timeout | undefined
    try {
      prompts = await Promise.race([
        this.workspaceServices.mcp(workspace).prompts(),
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

  async expandCommand(
    template: string,
    args: string,
    workspace = this.options.workspacePath
  ): Promise<string> {
    const effective = await this.applyWorkspaceConfig(workspace)
    const plugins = await this.workspaceServices.plugins(effective.config, workspace)
    const output = { template, args }
    await plugins.transformCommand({ command: template, args, sessionId: null }, output)
    return expandCommandTemplate(output.template, output.args, (command) =>
      runWorkspaceShell(command, workspace)
    )
  }

  async mcpPrompt(
    server: string,
    prompt: string,
    args?: Record<string, string>,
    workspace = this.options.workspacePath
  ): Promise<string> {
    await this.applyWorkspaceConfig(workspace)
    return this.workspaceServices.mcp(workspace).getPrompt(server, prompt, args)
  }

  async setSessionAgent(id: string, agentId: string | null): Promise<SessionMeta> {
    return this.sessionService.setSessionAgent(id, agentId)
  }

  async createSession(directory?: string | null): Promise<SessionMeta> {
    return this.sessionService.createSession(directory)
  }

  async setSessionDirectory(id: string, directory: string | null): Promise<SessionMeta> {
    return this.sessionService.setSessionDirectory(id, directory)
  }

  async renameSession(id: string, title: string): Promise<SessionMeta> {
    return this.sessionService.renameSession(id, title)
  }

  async setSessionModel(id: string, model: ModelRef | null): Promise<SessionMeta> {
    await this.applyWorkspaceConfig(this.sessionWorkspace(id))
    return this.sessionService.setSessionModel(id, model)
  }

  async setSessionSettings(id: string, settings: SessionSettings): Promise<SessionMeta> {
    return this.sessionService.setSessionSettings(id, settings)
  }

  async compactSession(id: string, options: { force?: boolean } = {}): Promise<SessionMeta> {
    const record = this.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    this.reserveSession(id)

    try {
      const effective = await this.applyWorkspaceConfig(this.sessionWorkspace(id))
      const models = await this.modelsForWorkspace(this.sessionWorkspace(id), effective.config)
      const model = this.deps.createLanguageModel(
        models,
        record.session.model ?? models.defaultModel,
        { sessionId: id }
      )
      const compacted = await this.compaction.compactMessages(
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
      this.events.emit({ type: 'session.upsert', session: staged.session })
      await this.compaction.updateContextUsage(id)
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
      this.events.emit({ type: 'session.upsert', session })
      await this.compaction.updateContextUsage(id)
      return this.store.getSession(id) ?? session
    } finally {
      this.starting.delete(id)
    }
  }

  async forkSession(id: string, messageId?: string): Promise<SessionMeta> {
    return this.sessionService.forkSession(id, messageId)
  }

  async messageChanges(sessionId: string, messageId?: string): Promise<TurnChanges> {
    const record = this.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    const message = messageId
      ? record.messages.find((entry) => entry.id === messageId && entry.role === 'assistant')
      : latestSnapshotMessage(record.messages)
    if (!message) throw new Error(messageId ? 'MESSAGE_NOT_FOUND' : 'NO_CHANGES')
    return buildTurnChanges(this.turnChangesHost, record, message)
  }

  async revertChangedFiles(
    sessionId: string,
    messageId: string,
    paths: string[] = []
  ): Promise<TurnChanges> {
    const record = this.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    if (this.sessionBusy(sessionId)) throw new Error('SESSION_BUSY')
    const message = record.messages.find(
      (entry) => entry.id === messageId && entry.role === 'assistant'
    )
    if (!message) throw new Error('MESSAGE_NOT_FOUND')
    const latest = latestSnapshotMessage(record.messages)
    if (latest?.id !== message.id) throw new Error('TURN_NOT_LATEST')
    if (message.status === 'streaming') throw new Error('SESSION_BUSY')
    if (!message.snapshotBefore) throw new Error('NO_SNAPSHOT')

    const allowed = await allowedChangePaths(this.turnChangesHost, message)
    const targets = paths.length > 0 ? [...new Set(paths)] : [...allowed]
    for (const target of targets) {
      if (!allowed.has(target)) throw new Error('INVALID_CHANGE_PATH')
    }
    if (targets.length > 0) {
      this.reserveSession(sessionId)
      try {
        await this.snapshots.restorePaths(message.snapshotBefore, targets)
      } finally {
        this.starting.delete(sessionId)
      }
    }

    const changes = await buildTurnChanges(this.turnChangesHost, record, message)
    message.changedFiles = changes.files.map((file) => file.snapshotPath)
    await this.store.persist(sessionId)
    this.events.emit({ type: 'message.upsert', message: structuredClone(message) })
    return changes
  }

  private get turnChangesHost(): TurnChangesHost {
    return {
      snapshots: this.snapshots,
      sessionBusy: (sessionId) => this.sessionBusy(sessionId)
    }
  }

  searchSessions(query: string): SessionSearchResult[] {
    return this.sessionService.searchSessions(query)
  }

  listPermissionRules(sessionId?: string): PermissionRule[] {
    return this.permissionService.listPermissionRules(sessionId)
  }

  async prepareCompaction(id: string): Promise<boolean> {
    return this.compaction.prepareCompaction(id)
  }

  addPermissionRule(input: PermissionRuleInput): Promise<PermissionRule> {
    return this.permissionService.addPermissionRule(input)
  }

  removePermissionRule(id: string): Promise<boolean> {
    return this.permissionService.removePermissionRule(id)
  }

  async deleteSession(id: string): Promise<void> {
    const run = this.runs.get(id)
    if (run) {
      run.abort.abort()
      this.permissionService.rejectPendingForRun(run)
    }
    const children = this.store.list().filter((session) => session.parentId === id)
    for (const child of children) {
      const childRun = this.runs.get(child.id)
      if (childRun) {
        childRun.abort.abort()
        this.permissionService.rejectPendingForRun(childRun)
      }
      const childRecord = this.store.get(child.id)
      await this.store.delete(child.id)
      await this.permissionRules.removeForSession(child.id)
      await this.snapshots.removeSession(child.id)
      await removeSessionAttachments(this.options.userDataPath, child.id)
      await this.options.browserRequest?.(child.id, 'close').catch(() => undefined)
      if (childRecord?.session.directory) {
        void this.workspaceServices.releaseWorkspace(childRecord.session.directory)
      }
    }
    const removed = this.store.get(id)
    await this.store.delete(id)
    await this.permissionRules.removeForSession(id)
    await this.snapshots.removeSession(id)
    await removeSessionAttachments(this.options.userDataPath, id)
    await this.options.browserRequest?.(id, 'close').catch(() => undefined)
    if (removed?.session.directory)
      void this.workspaceServices.releaseWorkspace(removed.session.directory)
    this.events.emit({ type: 'session.deleted', sessionId: id })
  }

  messages(id: string): MessagesSnapshot {
    return this.sessionService.messages(id)
  }

  setModels(models: RuntimeModelsConfig): void {
    this.models = models
    this.effectiveModels.clear()
    const workspaces = new Set([this.options.workspacePath])
    for (const session of this.store.list()) workspaces.add(this.sessionWorkspace(session.id))
    for (const workspace of workspaces) {
      this.effectiveModels.set(
        workspace,
        mergeRuntimeProviders(models, this.projectProviderConfigs.get(workspace), process.env)
      )
    }
    this.sessionService.setModels()
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
      const workspace = this.sessionWorkspace(sessionId)
      const effective = await this.applyWorkspaceConfig(workspace)
      const config = effective.config
      const models = await this.modelsForWorkspace(workspace, config)
      const target = requestedModel ?? record.session.model ?? models.defaultModel
      resolveModelRef(models, target)

      if (requestedModel) {
        record.session.model = requestedModel
      }

      const user = makeUserMessage(sessionId, content, attachments)
      const assistant = makeAssistantMessage(sessionId)
      if (config.snapshots) {
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

      this.events.emit({ type: 'message.upsert', message: structuredClone(user) })
      this.beginRun(sessionId, assistant, undefined, config, models)
    } finally {
      this.starting.delete(sessionId)
    }
  }

  private beginRun(
    sessionId: string,
    assistant: ChatMessage,
    skipHistoryIds: Set<string> | undefined,
    config: AgentConfig,
    models: RuntimeModelsConfig
  ): void {
    this.events.emit({ type: 'message.upsert', message: structuredClone(assistant) })
    this.events.emitSession(sessionId)
    this.events.emit({
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
      models,
      skipHistoryIds,
      agent: null,
      depth: 0
    }
    this.runs.set(sessionId, run)
    void this.runAgent(run).catch((error) => {
      this.runs.delete(sessionId)
      const message = normalizeError(error)
      void this.store.setStatus(sessionId, 'error').catch(() => undefined)
      this.events.emit({
        type: 'run.finished',
        sessionId,
        messageId: assistant.id,
        status: 'failed',
        error: message,
        usage: undefined,
        durationMs: Date.now() - run.startedAt
      })
      this.events.emitSession(sessionId)
    })
  }

  stopChat(sessionId: string): void {
    const run = this.runs.get(sessionId)
    if (!run) return
    run.abort.abort()
    this.permissionService.rejectPendingForRun(run)
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
      const workspace = this.sessionWorkspace(sessionId)
      const effective = await this.applyWorkspaceConfig(workspace)
      const config = effective.config
      const models = await this.modelsForWorkspace(workspace, config)
      resolveModelRef(models, record.session.model ?? models.defaultModel)
      const assistant = makeAssistantMessage(sessionId)
      if (config.snapshots) {
        assistant.snapshotBefore = await this.createSnapshotId(
          sessionId,
          workspace,
          await this.resolveRunReferences(config, workspace)
        )
      }
      if (!this.store.get(sessionId)) throw new Error('SESSION_NOT_FOUND')
      await this.store.appendMessage(sessionId, assistant)
      await this.store.setStatus(sessionId, 'running')
      this.beginRun(sessionId, assistant, new Set([last.id]), config, models)
    } finally {
      this.starting.delete(sessionId)
    }
  }

  permissions(): PermissionRequest[] {
    return this.permissionService.permissions()
  }

  questions(): QuestionRequest[] {
    return this.permissionService.questions()
  }

  replyQuestion(questionId: string, answer: QuestionAnswer): void {
    this.permissionService.replyQuestion(questionId, answer)
  }

  replyPermission(requestId: string, decision: PermissionDecision): void {
    this.permissionService.replyPermission(requestId, decision)
  }

  async testModel(
    providerId: string,
    modelId: string
  ): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    const start = Date.now()
    try {
      const effective = await this.applyWorkspaceConfig(this.options.workspacePath)
      const models = await this.modelsForWorkspace(this.options.workspacePath, effective.config)
      const model = this.deps.createLanguageModel(
        models,
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
      this.permissionService.rejectPendingForRun(run)
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
    await this.workspaceServices.dispose()
  }

  async setTransientMcpServers(
    servers: import('@ateam/shared').McpServerInput[],
    workspace = this.options.workspacePath
  ): Promise<void> {
    await this.applyWorkspaceConfig(workspace)
    await this.workspaceServices.setTransientMcpServers(servers, workspace)
  }

  async setMcpAuth(auths: McpAuthRecord[]): Promise<void> {
    await this.workspaceServices.setMcpAuth(auths)
  }

  async listMcpServers(workspace = this.options.workspacePath): Promise<McpServerConfig[]> {
    await this.applyWorkspaceConfig(workspace)
    return this.workspaceServices.listMcpServers(workspace)
  }

  async mcpStatuses(
    options?: { probe?: boolean },
    workspace = this.options.workspacePath
  ): Promise<McpServerStatus[]> {
    await this.applyWorkspaceConfig(workspace)
    return this.workspaceServices.mcpStatuses(options, workspace)
  }

  async addMcpServer(input: McpServerInput): Promise<McpServerConfig> {
    await this.applyWorkspaceConfig(this.options.workspacePath)
    return this.workspaceServices.addMcpServer(input)
  }

  async updateMcpServer(id: string, input: Partial<McpServerInput>): Promise<McpServerConfig> {
    await this.applyWorkspaceConfig(this.options.workspacePath)
    return this.workspaceServices.updateMcpServer(id, input)
  }

  async removeMcpServer(id: string): Promise<boolean> {
    await this.applyWorkspaceConfig(this.options.workspacePath)
    return this.workspaceServices.removeMcpServer(id)
  }

  setWebSearch(config: RuntimeWebSearchConfig | null): void {
    this.workspaceServices.setWebSearch(config)
  }

  private workspaceInUse(workspace: string): boolean {
    return (
      [...this.runs.values()].some(
        (run) => path.resolve(run.workspace) === path.resolve(workspace)
      ) ||
      this.store
        .list()
        .some(
          (session) =>
            session.directory && path.resolve(session.directory) === path.resolve(workspace)
        )
    )
  }

  private async writeTodos(run: Run, input: TodoInput[]): Promise<string> {
    const todos = normalizeTodos(input)
    const session = await this.store.setTodos(run.sessionId, todos)
    if (session) this.events.emit({ type: 'session.upsert', session })
    return formatTodoList(todos)
  }

  private async readTodos(run: Run): Promise<string> {
    return formatTodoList(this.store.getSession(run.sessionId)?.todos ?? [])
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
        this.events.emit({
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

  private messageCost(
    target: ModelRef | null,
    usage?: TokenUsage,
    models: RuntimeModelsConfig = this.models
  ): number | undefined {
    try {
      return computeMessageCost(usage ?? {}, resolveModelRef(models, target).model) ?? undefined
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
      if (session) this.events.emit({ type: 'session.upsert', session })
    } catch {
      /* keep the derived title */
    }
  }

  private resolveAgentTarget(
    agent: AgentDefinition | null,
    sessionModel: ModelRef | null,
    models: RuntimeModelsConfig = this.models
  ): ModelRef | null {
    const fallback = sessionModel ?? models.defaultModel
    if (!agent?.model) return fallback
    try {
      resolveModelRef(models, agent.model)
      return agent.model
    } catch {
      return fallback
    }
  }

  private runSubagent(parent: Run, input: SubagentInput, toolCallId: string): Promise<string> {
    return runSubagentTask(
      {
        store: this.store,
        agents: (workspace) => this.sessionService.agents(workspace),
        createSnapshotId: (sessionId, references) =>
          this.createSnapshotId(sessionId, this.sessionWorkspace(sessionId), references),
        referencesFor: (workspace, config) => this.resolveRunReferences(config, workspace),
        record: (sessionId) => this.record(sessionId),
        hasRun: (sessionId) => this.runs.has(sessionId),
        registerRun: (sessionId, run) => {
          this.runs.set(sessionId, run)
        },
        askPermission: (target, action, resource, toolName, callId, rules) =>
          this.permissionService.askPermission(target, action, resource, toolName, callId, rules),
        runAgent: (run) => this.runAgent(run),
        startBackground: (run, info) => this.startBackgroundSubagent(run, info)
      },
      parent,
      input,
      toolCallId
    )
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

  private planFilePath(run: Run): string {
    return path.posix.join('.ateam', 'plans', `${run.sessionId}.md`)
  }

  private async isGitRepository(workspace: string): Promise<boolean> {
    let directory = path.resolve(workspace)
    for (;;) {
      try {
        const stat = await fs.stat(path.join(directory, '.git'))
        if (stat.isDirectory() || stat.isFile()) return true
      } catch {
        /* keep walking up */
      }
      const parent = path.dirname(directory)
      if (parent === directory) return false
      directory = parent
    }
  }

  private async exitPlan(run: Run): Promise<string> {
    const record = this.record(run.sessionId)
    if ((record.session.permissionMode ?? 'ask') !== 'plan') {
      throw new Error('NOT_IN_PLAN_MODE')
    }
    const withAgent = await this.store.setAgent(run.sessionId, 'build')
    if (!withAgent) throw new Error('SESSION_NOT_FOUND')
    const session = await this.store.setSettings(run.sessionId, {
      reasoningEffort: withAgent.reasoningEffort,
      permissionMode: 'ask'
    })
    if (!session) throw new Error('SESSION_NOT_FOUND')
    run.agent =
      (await this.sessionService.agents(run.workspace)).find(
        (candidate) => candidate.id === 'build'
      ) ?? run.agent
    this.events.emit({ type: 'session.upsert', session })
    return `Switched to build agent. The plan is saved at ${this.planFilePath(run)}. Ask the user to send the next message to start implementing.`
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

  private resetAssistantMessage(run: Run, message: ChatMessage): void {
    message.parts = []
    message.error = undefined
    message.usage = undefined
    message.contextUsage = undefined
    message.durationMs = undefined
    message.snapshotAfter = undefined
    message.snapshotSteps = []
    message.changedFiles = undefined
    delete message.retry
    message.status = 'streaming'
    message.updatedAt = nowIso()
    run.steps = 0
    this.events.emit({ type: 'message.upsert', message: structuredClone(message) })
  }

  private sessionWorkspace(sessionId: string): string {
    return this.store.getSession(sessionId)?.directory ?? this.options.workspacePath
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
      if (session) this.events.emit({ type: 'session.upsert', session })
      void this.workspaceServices.releaseWorkspace(previous)
      return `Session will move to ${directory} on the next message.`
    } catch (error) {
      return `Error: ${this.worktreeErrorMessage(error)}`
    }
  }

  private get toolContextHost(): ToolContextHost {
    return {
      askPermission: (run, action, resource, toolName, toolCallId) =>
        this.permissionService.askPermission(run, action, resource, toolName, toolCallId),
      storeOutput: (sessionId, toolCallId, output) =>
        this.toolOutputs.bound(sessionId, toolCallId, output),
      toolOutputPath: (sessionId, toolCallId) => this.toolOutputs.pathFor(sessionId, toolCallId),
      appendToolOutput: (run, toolCallId, delta) =>
        appendToolOutput(this.events, this.assistantFor(run), run, toolCallId, delta),
      emitBackgroundFinished: (run, info) =>
        this.events.emit({
          type: 'background.finished',
          sessionId: run.sessionId,
          messageId: run.messageId,
          ...info
        }),
      formatFiles: (run, files) =>
        this.workspaceServices.formatFiles(run.workspace, files, run.config.formatterOverrides),
      diagnoseFiles: (run, files) => this.workspaceServices.diagnoseFiles(run.workspace, files),
      lspHover: (run, file, line, character) =>
        this.workspaceServices.lspHover(run.workspace, file, line, character),
      lspDefinition: (run, file, line, character) =>
        this.workspaceServices.lspDefinition(run.workspace, file, line, character),
      runSubagent: (run, input, toolCallId) => this.runSubagent(run, input, toolCallId),
      fetchWebPage: (input) => this.workspaceServices.fetchWebPage(input),
      searchTheWeb: (input) => this.workspaceServices.searchTheWeb(input),
      writeTodos: (run, todos) => this.writeTodos(run, todos),
      readTodos: (run) => this.readTodos(run),
      askQuestion: (run, input, toolCallId) =>
        this.permissionService.askQuestion(run, input, toolCallId),
      exitPlan: (run) => this.exitPlan(run),
      listMcpPrompts: (server, workspace) =>
        this.workspaceServices.listMcpPrompts(server, workspace),
      getMcpPrompt: (server, prompt, args, workspace) =>
        this.workspaceServices.getMcpPrompt(server, prompt, args, workspace),
      listMcpResources: (server, workspace) =>
        this.workspaceServices.listMcpResources(server, workspace),
      readMcpResource: (server, uri, workspace) =>
        this.workspaceServices.readMcpResource(server, uri, workspace),
      createSessionWorktree: (run, input) => this.createSessionWorktree(run, input),
      listSessionWorktrees: (run) => this.listSessionWorktrees(run),
      removeSessionWorktree: (run, target, force) => this.removeSessionWorktree(run, target, force),
      moveSession: (run, directory) => this.moveSession(run, directory),
      listWorkspaceAdapters: async (run) => {
        const adapters = run.plugins?.workspaceAdapters() ?? []
        if (adapters.length === 0) return 'No plugin workspace adapters are available.'
        return adapters
          .map(
            (adapter) => `- ${adapter.name}${adapter.description ? `: ${adapter.description}` : ''}`
          )
          .join('\n')
      },
      createPluginWorkspace: async (run, adapter, name, base) => {
        if (!run.plugins) throw new Error('WORKSPACE_ADAPTER_NOT_AVAILABLE')
        const result = await run.plugins.createWorkspace(adapter, {
          name,
          base: base ?? null,
          workspace: run.workspace
        })
        return `Created workspace at ${result.directory}${result.details ? `\n${result.details}` : ''}\nUse session_move with this directory to continue there.`
      },
      removePluginWorkspace: async (run, adapter, directory, force) => {
        if (!run.plugins) throw new Error('WORKSPACE_ADAPTER_NOT_AVAILABLE')
        await run.plugins.removeWorkspace(adapter, {
          directory,
          force,
          workspace: run.workspace
        })
        return `Removed workspace ${directory}.`
      },
      browserAction: (run, method, params) => this.browserAction(run, method, params),
      browserCapture: (run, tabId) => this.browserCapture(run, tabId)
    }
  }

  private get runPreparationHost(): RunPreparationHost {
    return {
      userDataPath: this.options.userDataPath,
      toolContextHost: this.toolContextHost,
      record: (sessionId) => this.record(sessionId),
      loadInstructions: (input) => this.deps.loadInstructions(input),
      skillsFor: (workspace) => this.workspaceServices.skillsFor(workspace),
      resolveRunReferences: (config, workspace) => this.resolveRunReferences(config, workspace),
      plugins: (config, workspace) => this.workspaceServices.plugins(config, workspace),
      createTools: (context) => this.deps.createTools(context),
      mcp: (workspace) => this.workspaceServices.mcp(workspace),
      historyMessages: (run, assistantMessageId) => this.historyMessages(run, assistantMessageId),
      attachmentPayloads: (sessionId, messages) => this.attachmentPayloads(sessionId, messages),
      isGitRepository: (workspace) => this.isGitRepository(workspace),
      planFilePath: (run) => this.planFilePath(run)
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
          ? ((await this.sessionService.agents(run.workspace)).find(
              (candidate) => candidate.id === record.session.agent
            ) ?? null)
          : null)
      run.agent = agent
      const target = this.resolveAgentTarget(agent, record.session.model, run.models)
      runTarget = target
      if (target) message.model = { ...target }
      schedulePersist()
      const model = this.deps.createLanguageModel(run.models, target, {
        sessionId: run.sessionId,
        onRetry: (info) => {
          if (info) message.retry = info
          else delete message.retry
          message.updatedAt = nowIso()
          this.events.emit({ type: 'message.upsert', message: structuredClone(message) })
        }
      })
      const resolvedTarget = resolveModelRef(run.models, target)
      const targetInfo = resolvedTarget.model
      const variantId = target?.variant
      const variant = variantId
        ? (targetInfo.variants ?? []).find((candidate) => candidate.id === variantId)
        : undefined
      if (variantId && !variant) throw new Error('INVALID_VARIANT')
      const contextWindow = targetInfo.contextWindow ?? DEFAULT_CONTEXT_WINDOW
      const nativeCompaction =
        targetInfo.compaction === true && resolvedTarget.provider.type === 'anthropic'
      const history = this.historyMessages(run, message.id)
      if (
        !nativeCompaction &&
        shouldCompact(history, contextWindow, {
          usageCreatedAfter: record.session.compaction?.createdAt,
          encode: await this.compaction.tokenEncoder(target, run.models)
        })
      ) {
        await this.compaction.compactMessages(
          run.sessionId,
          history,
          model,
          run.abort.signal,
          false,
          target
        )
      }

      const prepared = await prepareRun(this.runPreparationHost, {
        run,
        messageId: message.id,
        agent,
        target,
        resolvedTarget,
        variant,
        nativeCompaction,
        contextWindow
      })
      const result = this.deps.createTurn({
        model,
        system: prepared.system,
        messages: prepared.messages,
        tools: prepared.tools,
        abortSignal: run.abort.signal,
        reasoning: prepared.params.reasoning,
        maxSteps: agent?.maxSteps ?? undefined,
        maxOutputTokens: prepared.params.maxOutputTokens,
        temperature: prepared.params.temperature,
        providerOptions: prepared.providerOptions
      })

      for await (const part of result.stream) {
        switch (part.type) {
          case 'text-start': {
            const index = message.parts.length
            message.parts.push({ type: 'text', text: '' })
            textParts.set(part.id, index)
            emitPart(this.events, run, message.parts[index], index)
            break
          }
          case 'text-delta': {
            const index = textParts.get(part.id)
            if (index === undefined) break
            const textPart = message.parts[index]
            if (textPart?.type !== 'text') break
            textPart.text += part.text
            message.updatedAt = nowIso()
            this.events.emit({
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
            message.parts.push({
              type: 'reasoning',
              text: '',
              ...(part.providerMetadata
                ? { providerMetadata: structuredClone(part.providerMetadata) }
                : {})
            })
            reasoningParts.set(part.id, index)
            emitPart(this.events, run, message.parts[index], index)
            break
          }
          case 'reasoning-delta': {
            const index = reasoningParts.get(part.id)
            if (index === undefined) break
            const reasoningPart = message.parts[index]
            if (reasoningPart?.type !== 'reasoning') break
            reasoningPart.text += part.text
            message.updatedAt = nowIso()
            this.events.emit({
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
          case 'reasoning-end': {
            const index = reasoningParts.get(part.id)
            if (index !== undefined && part.providerMetadata) {
              const reasoningPart = message.parts[index]
              if (reasoningPart?.type === 'reasoning') {
                reasoningPart.providerMetadata = structuredClone(part.providerMetadata)
                emitPart(this.events, run, reasoningPart, index)
              }
            }
            reasoningParts.delete(part.id)
            break
          }
          case 'tool-input-start': {
            const toolPart = ensureToolPart(message, part.id, part.toolName)
            toolPart.state = 'pending'
            emitPart(this.events, run, toolPart, message.parts.indexOf(toolPart))
            break
          }
          case 'tool-call': {
            const toolPart = ensureToolPart(message, part.toolCallId, part.toolName)
            toolPart.input = part.input
            toolPart.state = 'running'
            emitPart(this.events, run, toolPart, message.parts.indexOf(toolPart))
            break
          }
          case 'tool-result': {
            const toolPart = findToolPart(message, part.toolCallId)
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
                emitPart(this.events, run, toolPart, message.parts.indexOf(toolPart))
              }
              await this.store.persist(run.sessionId)
            }
            break
          }
          case 'tool-error': {
            const toolPart = findToolPart(message, part.toolCallId)
            if (toolPart && toolPart.type === 'tool') {
              toolPart.state = 'failed'
              toolPart.error = normalizeError(part.error)
              toolPart.finishedAt = nowIso()
              emitPart(this.events, run, toolPart, message.parts.indexOf(toolPart))
              await this.store.persist(run.sessionId)
            }
            break
          }
          case 'tool-output-denied': {
            const toolPart = findToolPart(message, part.toolCallId)
            if (toolPart && toolPart.type === 'tool') {
              toolPart.state = 'denied'
              toolPart.error = 'Permission denied by user'
              toolPart.finishedAt = nowIso()
              emitPart(this.events, run, toolPart, message.parts.indexOf(toolPart))
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
      delete message.retry
      message.updatedAt = nowIso()
      message.durationMs = Date.now() - run.startedAt
      message.usage = usage
      message.contextUsage = lastStepUsage
      message.costUsd = this.messageCost(runTarget, usage, run.models)
      settleTools(message, 'Tool call did not finish')
      await this.recordAfterSnapshot(run, message)
      await this.store.persist(run.sessionId)
      this.events.emit({ type: 'message.upsert', message: structuredClone(message) })
      await this.compaction.updateContextUsage(run.sessionId)
      prepareCompaction = true
      await this.store.setStatus(run.sessionId, 'idle')
      this.events.emitSession(run.sessionId)
      await this.maybeGenerateTitle(run, model, message)
      const outcome: RunOutcome =
        finishReason === 'tool-calls' && run.steps >= MAX_STEPS ? 'max-steps' : 'completed'
      this.events.emit({
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
          const compacted = await this.compaction.compactForOverflow(run)
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
      delete message.retry
      message.error = interrupted ? 'Interrupted by user' : normalizeError(error)
      message.updatedAt = nowIso()
      message.durationMs = Date.now() - run.startedAt
      message.usage = usage
      message.contextUsage = lastStepUsage
      message.costUsd = this.messageCost(runTarget, usage, run.models)
      settleTools(message, interrupted ? 'Interrupted by user' : 'Tool call failed')
      await this.recordAfterSnapshot(run, message)
      await this.store.persist(run.sessionId)
      this.events.emit({ type: 'message.upsert', message: structuredClone(message) })
      await this.compaction.updateContextUsage(run.sessionId)
      prepareCompaction = true
      await this.store.setStatus(run.sessionId, interrupted ? 'idle' : 'error')
      this.events.emitSession(run.sessionId)
      this.events.emit({
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
      if (prepareCompaction) this.compaction.schedulePreparedCompaction(run.sessionId)
      this.events.emitSession(run.sessionId)
      void this.workspaceServices.releaseWorkspace(run.workspace)
    }
  }
}
