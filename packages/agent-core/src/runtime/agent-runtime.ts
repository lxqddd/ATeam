import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import type { TextStreamPart, ToolSet } from 'ai'
import type {
  AgentConfig,
  AgentDefinition,
  AgentMetricsSnapshot,
  BackgroundTaskInfo,
  CacheMetricsSnapshot,
  ChatMessage,
  ChatRetryStatus,
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
  PermissionRulesOverview,
  PluginAuthCredentials,
  PluginAuthMethodInfo,
  PluginAuthResult,
  QuestionAnswer,
  QuestionRequest,
  QueuedMessage,
  RetryMetricsSnapshot,
  RunOutcome,
  RuntimeModelsConfig,
  RuntimeProviderAuth,
  RuntimeWebSearchConfig,
  SessionChangesSummary,
  SessionExportPayload,
  SessionExportRequest,
  SessionImportResult,
  SessionMeta,
  SessionPlan,
  SessionSearchResult,
  SessionSettings,
  UsageStats,
  UsageStatsRange,
  SteerStrategy,
  McpAuthRecord,
  SubagentInput,
  TodoInput,
  TokenUsage,
  TurnChanges,
  VcsDiffOptions,
  VcsDiffResult,
  VcsStatus
} from '@ateam/shared'
import { DEFAULT_RETRY_CONFIG } from '@ateam/shared'
import { DEFAULT_CONTEXT_WINDOW, messagesAfterCompaction, shouldCompact } from '../sessions/context'
import { readEffectiveAgentConfig } from '../config/config-store'
import { loadOrgPolicy } from '../config/org-policy'
import { buildPermissionOverview } from './permission-overview'
import { PermissionsStore } from '../config/permissions-store'
import { SessionsStore, type SessionRecord, makeTitle } from '../sessions/sessions-store'
import { SnapshotStore } from '../sessions/snapshots'
import { ToolOutputStore, toolOutputLimitsFor } from '../sessions/tool-output-store'
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
import { abortableSleep, isRetryableStreamError, retryDelayMs } from '../retry-fetch'
import { expandCommandTemplate, runWorkspaceShell } from '../commands'
import { hasProjectReferences, resolveReferences, type ResolvedReference } from '../references'
import { formatTodoList, normalizeTodos } from '../todos'
import { computeCacheSavings, computeMessageCost } from '../cost'
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
import { CommandService } from './command-service'
import { CacheMetricsCollector } from './cache-metrics'
import {
  BackgroundTaskRegistry,
  backgroundTaskId,
  formatBackgroundResult,
  formatBackgroundTaskList,
  makeBackgroundResultMessage
} from './background-tasks'
import { DEFAULT_DEPENDENCIES } from './defaults'
import { isContextLengthError } from './helpers'
import { HistoryService } from './history-service'
import { errorMessage, makeAssistantMessage, makeUserMessage, nowIso, usageFrom } from './messages'
import { PermissionService } from './permission-service'
import { PlanService } from './plan-service'
import { applyProviderAuth } from './provider-auth'
import {
  appendToolOutput,
  emitPart,
  ensureToolPart,
  findToolPart,
  formatToolOutput,
  settleTools
} from './run-messages'
import { RetryMetricsCollector } from './retry-metrics'
import { prepareRun, type RunPreparationHost } from './run-preparation'
import { RuntimeEvents } from './runtime-events'
import { SessionService } from './session-service'
import { runSubagentTask } from './subagents'
import { StepTracker, type TurnStreamState } from './step-tracker'
import type { ToolContextHost } from './tool-context'
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
  private readonly queues = new Map<string, QueuedMessage[]>()
  private readonly backgroundTasks = new BackgroundTaskRegistry()
  /** Sessions whose next idle moment should start a run for injected background results. */
  private readonly pendingBackgroundWake = new Set<string>()
  /** Sessions where the user stopped or cancelled work and nothing may auto-start. */
  private readonly backgroundSilenced = new Set<string>()
  private closed = false
  private models: RuntimeModelsConfig
  private providerAuth: RuntimeProviderAuth[]
  private readonly effectiveModels: Map<string, RuntimeModelsConfig>
  private readonly projectProviderConfigs = new Map<string, AgentConfig['providers']>()
  private readonly deps: AgentRuntimeDependencies
  private readonly events: RuntimeEvents
  private readonly compaction: CompactionService
  private readonly workspaceServices: WorkspaceServices
  private readonly sessionService: SessionService
  private readonly permissionService: PermissionService
  private readonly historyService: HistoryService
  private readonly planService: PlanService
  private readonly stepTracker: StepTracker
  private readonly commandService: CommandService
  private readonly retryMetrics = new RetryMetricsCollector()
  private readonly cacheMetrics = new CacheMetricsCollector()

  constructor(private readonly options: AgentRuntimeOptions) {
    this.store = new SessionsStore(options.userDataPath)
    this.permissionRules = new PermissionsStore(options.userDataPath)
    this.snapshots = new SnapshotStore(options.userDataPath)
    this.toolOutputs = new ToolOutputStore(options.userDataPath)
    this.models = options.models
    this.providerAuth = options.providerAuth ?? []
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
      appVersion: options.appVersion ?? '0.0.0',
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
      planFilePath: (run) => this.planService.filePathFor(run),
      emitSession: (sessionId) => this.events.emitSession(sessionId)
    })
    this.historyService = new HistoryService({
      store: this.store,
      snapshots: this.snapshots,
      emit: (event) => this.events.emit(event),
      updateContextUsage: (sessionId) => this.compaction.updateContextUsage(sessionId),
      reserveSession: (sessionId) => this.reserveSession(sessionId),
      releaseSession: (sessionId) => {
        this.starting.delete(sessionId)
      },
      sessionBusy: (sessionId) => this.sessionBusy(sessionId),
      sessionWorkspace: (sessionId) => this.sessionWorkspace(sessionId),
      createRevertSnapshot: (sessionId, workspace) =>
        this.createRevertSnapshot(sessionId, workspace),
      vcs: (workspace) => this.deps.createVcs(workspace)
    })
    this.planService = new PlanService({
      store: this.store,
      sessionWorkspace: (sessionId) => this.sessionWorkspace(sessionId),
      agents: (workspace) => this.sessionService.agents(workspace),
      emit: (event) => this.events.emit(event),
      record: (sessionId) => this.record(sessionId)
    })
    this.stepTracker = new StepTracker({
      store: this.store,
      snapshots: this.snapshots,
      events: this.events,
      recordUsage: (usage, modelRef, models) => {
        let savedUsd = 0
        try {
          savedUsd = computeCacheSavings(usage, resolveModelRef(models, modelRef).model)
        } catch {
          /* pricing is best effort; cache counters must still advance */
        }
        this.cacheMetrics.record(usage, savedUsd)
      }
    })
    this.commandService = new CommandService({
      userDataPath: this.options.userDataPath,
      defaultWorkspacePath: this.options.workspacePath,
      applyConfig: (workspace) => this.applyWorkspaceConfig(workspace),
      plugins: (config, workspace) => this.workspaceServices.plugins(config, workspace),
      mcp: (workspace) => this.workspaceServices.mcp(workspace)
    })
  }

  async reloadConfig(workspace?: string): Promise<void> {
    if (!workspace) {
      // Global `permissions.json` / `mcp.json` may have been edited externally.
      await this.permissionRules.reload()
      await this.workspaceServices.reloadUserMcpServers()
    }
    const targets = new Set<string>()
    if (workspace) targets.add(workspace)
    else {
      targets.add(this.options.workspacePath)
      for (const session of this.store.list()) targets.add(this.sessionWorkspace(session.id))
    }
    for (const target of targets) {
      const busy = [...this.runs.values()].some(
        (run) => path.resolve(run.workspace) === path.resolve(target)
      )
      await this.rememberWorkspaceConfig(target, !busy)
      this.events.emit({ type: 'config.changed', workspace: target })
    }
    // Providers or models may have been removed by the edit; drop session
    // references that no longer resolve so the next send can pick a model.
    this.sessionService.setModels()
  }

  async init(): Promise<void> {
    this.closed = false
    await fs.mkdir(this.options.workspacePath, { recursive: true })
    void this.toolOutputs.cleanup().catch(() => undefined)
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
    output.models.providers = applyProviderAuth(
      await plugins.applyAuth(workspace, output.models.providers),
      this.providerAuth
    )
    this.effectiveModels.set(workspace, output.models)
    return output.models
  }

  private modelsForSession(sessionId: string): RuntimeModelsConfig {
    return this.effectiveModels.get(this.sessionWorkspace(sessionId)) ?? this.models
  }

  listSessions(): SessionMeta[] {
    return this.sessionService.listSessions()
  }

  exportSessions(options: SessionExportRequest): SessionExportPayload {
    return this.sessionService.exportSessions(options)
  }

  importSessions(content: string): Promise<SessionImportResult> {
    return this.sessionService.importSessions(content)
  }

  usageStats(range: UsageStatsRange): UsageStats {
    return this.sessionService.usageStats(range)
  }

  listAgents(workspace = this.options.workspacePath): Promise<AgentDefinition[]> {
    return this.sessionService.listAgents(workspace)
  }

  retryMetricsSnapshot(): RetryMetricsSnapshot {
    return this.retryMetrics.snapshot()
  }

  cacheMetricsSnapshot(): CacheMetricsSnapshot {
    return this.cacheMetrics.snapshot()
  }

  metricsSnapshot(): AgentMetricsSnapshot {
    return {
      retry: this.retryMetrics.snapshot(),
      cache: this.cacheMetrics.snapshot()
    }
  }

  async pluginAuthMethods(workspace = this.options.workspacePath): Promise<PluginAuthMethodInfo[]> {
    const effective = await this.applyWorkspaceConfig(workspace)
    const plugins = await this.workspaceServices.plugins(effective.config, workspace)
    return plugins.authMethods()
  }

  async authorizePluginAuth(
    workspace: string,
    id: string,
    answers: Record<string, string>
  ): Promise<PluginAuthResult> {
    const effective = await this.applyWorkspaceConfig(workspace)
    const plugins = await this.workspaceServices.plugins(effective.config, workspace)
    return plugins.authorizeAuth(id, answers)
  }

  async completePluginAuth(
    workspace: string,
    requestId: string,
    code?: string
  ): Promise<PluginAuthResult> {
    const effective = await this.applyWorkspaceConfig(workspace)
    const plugins = await this.workspaceServices.plugins(effective.config, workspace)
    return plugins.completeAuth(requestId, { code })
  }

  /**
   * Refresh plugin OAuth credentials. Without an explicit workspace, try the default
   * workspace and every workspace that currently has sessions.
   */
  async refreshPluginAuth(
    workspace: string | undefined,
    provider: string,
    credentials: PluginAuthCredentials
  ): Promise<PluginAuthResult | null> {
    const targets = new Set<string>()
    if (workspace) {
      targets.add(workspace)
    } else {
      targets.add(this.options.workspacePath)
      for (const session of this.store.list()) targets.add(this.sessionWorkspace(session.id))
    }
    for (const target of targets) {
      const effective = await this.applyWorkspaceConfig(target)
      const plugins = await this.workspaceServices.plugins(effective.config, target)
      const result = await plugins.refreshAuth(provider, credentials)
      if (result) return result
    }
    return null
  }

  setProviderAuth(auths: RuntimeProviderAuth[]): void {
    this.providerAuth = [...auths]
  }

  async listCommands(workspace = this.options.workspacePath): Promise<CommandDefinition[]> {
    return this.commandService.listCommands(workspace)
  }

  async expandCommand(
    template: string,
    args: string,
    workspace = this.options.workspacePath
  ): Promise<string> {
    return this.commandService.expandCommand(template, args, workspace)
  }

  async mcpPrompt(
    server: string,
    prompt: string,
    args?: Record<string, string>,
    workspace = this.options.workspacePath
  ): Promise<string> {
    return this.commandService.mcpPrompt(server, prompt, args, workspace)
  }

  /**
   * Runs a `subtask` command in a hidden child session and returns the
   * background task id. The parent conversation receives the result as a
   * synthetic message and wakes up when it is idle.
   */
  async runCommand(
    sessionId: string,
    input: { name: string; args?: string }
  ): Promise<{ taskId: string; sessionId: string }> {
    const parentRecord = this.record(sessionId)
    const workspace = this.sessionWorkspace(sessionId)
    const effective = await this.applyWorkspaceConfig(workspace)
    const config = effective.config
    const requested = input.name.trim().replace(/^\/+/, '')
    if (!requested) throw new Error('Command name is required.')
    const commands = await this.listCommands(workspace)
    const command = commands.find(
      (candidate) => candidate.name.toLowerCase() === requested.toLowerCase()
    )
    if (!command) throw new Error(`Unknown command: /${requested}`)
    if (!command.subtask) {
      throw new Error(`Command /${command.name} does not run in a subtask.`)
    }
    if ((config.subagentDepth ?? 1) < 1) {
      throw new Error('Subtask commands are disabled because subagentDepth is 0.')
    }

    const args = input.args?.trim() ?? ''
    const plugins = await this.workspaceServices.plugins(config, workspace)
    const expanded = { template: command.template, args }
    await plugins.transformCommand({ command: command.template, args, sessionId }, expanded)
    const prompt = await expandCommandTemplate(expanded.template, expanded.args, (snippet) =>
      runWorkspaceShell(snippet, workspace)
    )

    const requestedAgent = command.agent?.trim() || 'general'
    const agent = (await this.sessionService.agents(workspace)).find(
      (candidate) =>
        candidate.id === requestedAgent ||
        candidate.name.toLowerCase() === requestedAgent.toLowerCase()
    )
    if (!agent) throw new Error(`Unknown subagent: ${requestedAgent}`)

    const models = await this.modelsForWorkspace(workspace, config)
    let model = parentRecord.session.model ?? null
    if (command.model) {
      resolveModelRef(models, command.model)
      model = command.model
    }

    const session = await this.store.create({
      hidden: true,
      parentId: sessionId,
      agent: agent.id,
      permissionMode: parentRecord.session.permissionMode,
      directory: parentRecord.session.directory ?? workspace
    })
    if (model) await this.store.setModel(session.id, model)

    const abort = new AbortController()
    const user = makeUserMessage(session.id, prompt)
    const snapshot = config.snapshots
      ? await this.createSnapshotId(
          session.id,
          workspace,
          await this.resolveRunReferences(config, workspace)
        )
      : undefined
    const assistant = makeAssistantMessage(session.id, snapshot)
    await this.store.appendMessage(session.id, user)
    await this.store.appendMessage(session.id, assistant)
    await this.store.setStatus(session.id, 'running')

    const childRun: Run = {
      sessionId: session.id,
      messageId: assistant.id,
      workspace,
      abort,
      startedAt: Date.now(),
      steps: 0,
      config,
      models,
      agent: command.model ? { ...agent, model: command.model } : agent,
      depth: 1,
      parentSessionId: sessionId
    }
    this.runs.set(session.id, childRun)

    const toolCallId = `command:${randomUUID()}`
    const taskId = backgroundTaskId(sessionId, toolCallId)
    this.publishBackgroundTask(
      this.backgroundTasks.start({
        id: taskId,
        kind: 'subagent',
        sessionId,
        toolCallId,
        title: `${command.name}${args ? ` ${args}` : ''}`.slice(0, 120),
        childSessionId: session.id,
        cancel: () => abort.abort()
      })
    )
    void this.runAgent(childRun)
      .catch(() => undefined)
      .finally(() => {
        const record = this.store.get(session.id)
        const message = record?.messages.find((entry) => entry.id === assistant.id)
        const result = (message?.parts ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
          .trim()
        const state =
          message?.status === 'complete'
            ? 'completed'
            : message?.status === 'interrupted'
              ? 'cancelled'
              : 'failed'
        const finished = this.backgroundTasks.complete(taskId, {
          state,
          ...(result ? { result } : {}),
          ...(state === 'failed' ? { error: message?.error ?? 'The command did not finish.' } : {})
        })
        if (finished) {
          this.publishBackgroundTask(finished)
          this.deliverBackgroundResult(finished)
        }
      })
    return { taskId, sessionId: session.id }
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
        { sessionId: id, retry: effective.config.retry ?? DEFAULT_RETRY_CONFIG }
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
    messageId?: string,
    stepIndex?: number
  ): Promise<{ session: SessionMeta; prompt: string }> {
    return this.historyService.undoSession(id, messageId, stepIndex)
  }

  async redoSession(id: string): Promise<SessionMeta> {
    return this.historyService.redoSession(id)
  }

  async forkSession(id: string, messageId?: string): Promise<SessionMeta> {
    return this.sessionService.forkSession(id, messageId)
  }

  async messageChanges(sessionId: string, messageId?: string): Promise<TurnChanges> {
    return this.historyService.messageChanges(sessionId, messageId)
  }

  async sessionChanges(sessionId: string): Promise<SessionChangesSummary> {
    return this.historyService.sessionChanges(sessionId)
  }

  async vcsStatus(sessionId: string): Promise<VcsStatus> {
    return this.historyService.vcsStatus(sessionId)
  }

  async vcsDiff(sessionId: string, options: VcsDiffOptions = {}): Promise<VcsDiffResult> {
    return this.historyService.vcsDiff(sessionId, options)
  }

  async revertChangedFiles(
    sessionId: string,
    messageId: string,
    paths: string[] = []
  ): Promise<TurnChanges> {
    return this.historyService.revertChangedFiles(sessionId, messageId, paths)
  }

  async unrevertChangedFiles(sessionId: string, paths: string[] = []): Promise<TurnChanges> {
    return this.historyService.unrevertChangedFiles(sessionId, paths)
  }

  /** Snapshot taken before a file-level revert so it can be undone. */
  private async createRevertSnapshot(sessionId: string, workspace: string): Promise<string> {
    const effective = await this.applyWorkspaceConfig(workspace)
    const references = (await this.resolveRunReferences(effective.config, workspace)).map(
      (reference) => ({ alias: reference.alias, root: reference.root })
    )
    return (await this.snapshots.create(workspace, sessionId, references)).id
  }

  searchSessions(query: string): SessionSearchResult[] {
    return this.sessionService.searchSessions(query)
  }

  listPermissionRules(sessionId?: string): PermissionRule[] {
    return this.permissionService.listPermissionRules(sessionId)
  }

  /**
   * Reports every permission layer in evaluation order for the settings view.
   * Config layers come from the workspace documents, so the answer follows the
   * session directory rather than the worker default.
   */
  async permissionRulesOverview(
    workspace = this.options.workspacePath
  ): Promise<PermissionRulesOverview> {
    const [effective, agents] = await Promise.all([
      readEffectiveAgentConfig(this.options.userDataPath, workspace),
      this.sessionService.agents(workspace)
    ])
    const policy = loadOrgPolicy({
      userDataPath: this.options.userDataPath,
      envPolicyFile: process.env.ATEAM_POLICY_FILE
    })
    return buildPermissionOverview({
      workspace,
      storedRules: this.permissionRules.list(),
      effective,
      agents,
      policy
    })
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
    this.queues.delete(id)
    const run = this.runs.get(id)
    if (run) {
      run.abort.abort()
      this.permissionService.rejectPendingForRun(run)
    }
    this.disposeBackgroundSession(id)
    const children = this.store.list().filter((session) => session.parentId === id)
    for (const child of children) {
      this.queues.delete(child.id)
      const childRun = this.runs.get(child.id)
      if (childRun) {
        childRun.abort.abort()
        this.permissionService.rejectPendingForRun(childRun)
      }
      this.disposeBackgroundSession(child.id)
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
    return { ...this.sessionService.messages(id), queued: this.queuedMessages(id) }
  }

  async sessionPlan(sessionId: string): Promise<SessionPlan> {
    return this.planService.currentPlan(sessionId)
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
    this.backgroundSilenced.delete(sessionId)
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
      const snapshot = config.snapshots
        ? await this.createSnapshotId(
            sessionId,
            workspace,
            await this.resolveRunReferences(config, workspace)
          )
        : undefined
      const assistant = makeAssistantMessage(sessionId, snapshot)
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
    models: RuntimeModelsConfig,
    continuationPrompt?: string
  ): void {
    this.pendingBackgroundWake.delete(sessionId)
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
      depth: 0,
      ...(continuationPrompt ? { continuationPrompt } : {})
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
    this.backgroundSilenced.add(sessionId)
    this.pendingBackgroundWake.delete(sessionId)
    if (this.queues.delete(sessionId)) this.emitQueue(sessionId)
    const run = this.runs.get(sessionId)
    if (!run) return
    run.abort.abort()
    this.permissionService.rejectPendingForRun(run)
  }

  queuedMessages(sessionId: string): QueuedMessage[] {
    return this.queues.get(sessionId)?.map((item) => structuredClone(item)) ?? []
  }

  steerChat(
    sessionId: string,
    input: { text: string; strategy?: SteerStrategy; attachments?: MessageAttachment[] }
  ): QueuedMessage {
    const content = input.text.trim()
    const attachments = input.attachments ?? []
    if (!content && attachments.length === 0) throw new Error('EMPTY_MESSAGE')
    if (!this.store.get(sessionId)) throw new Error('SESSION_NOT_FOUND')
    this.backgroundSilenced.delete(sessionId)
    const item: QueuedMessage = {
      id: randomUUID(),
      sessionId,
      text: content,
      strategy: input.strategy ?? 'after-step',
      attachments,
      createdAt: nowIso()
    }
    const queue = this.queues.get(sessionId) ?? []
    queue.push(item)
    this.queues.set(sessionId, queue)
    this.emitQueue(sessionId)
    const run = this.runs.get(sessionId)
    if (!run) {
      this.drainQueue(sessionId)
      return item
    }
    if (item.strategy === 'interrupt') {
      run.abort.abort()
      this.permissionService.rejectPendingForRun(run)
    }
    return item
  }

  removeQueuedMessage(sessionId: string, id: string): boolean {
    const queue = this.queues.get(sessionId)
    if (!queue) return false
    const index = queue.findIndex((item) => item.id === id)
    if (index < 0) return false
    queue.splice(index, 1)
    if (queue.length === 0) this.queues.delete(sessionId)
    this.emitQueue(sessionId)
    return true
  }

  private emitQueue(sessionId: string): void {
    this.events.emit({ type: 'chat.queue', sessionId, items: this.queuedMessages(sessionId) })
  }

  private hasAfterStepSteer(sessionId: string): boolean {
    return this.queues.get(sessionId)?.some((item) => item.strategy === 'after-step') ?? false
  }

  /** Send the next queued message once the session is idle; no-op while busy. */
  private drainQueue(sessionId: string): void {
    if (this.closed) return
    const queue = this.queues.get(sessionId)
    const item = queue?.[0]
    if (!queue || !item) return
    if (this.sessionBusy(sessionId)) return
    if (!this.store.get(sessionId)) {
      this.queues.delete(sessionId)
      this.emitQueue(sessionId)
      return
    }
    queue.shift()
    if (queue.length === 0) this.queues.delete(sessionId)
    this.emitQueue(sessionId)
    setTimeout(() => {
      void this.startQueuedRun(sessionId, item)
    }, 0)
  }

  private async startQueuedRun(sessionId: string, item: QueuedMessage): Promise<void> {
    try {
      await this.sendChat(sessionId, item.text, undefined, item.attachments)
    } catch (error) {
      if (this.closed) return
      if (normalizeError(error) === 'SESSION_BUSY') {
        const queue = this.queues.get(sessionId) ?? []
        queue.unshift(item)
        this.queues.set(sessionId, queue)
        this.emitQueue(sessionId)
        return
      }
      console.warn('[runtime] queued message could not be sent', error)
    }
  }

  async retryChat(sessionId: string): Promise<void> {
    const record = this.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    this.backgroundSilenced.delete(sessionId)
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
      const continuationPrompt = await this.planService.continuationPrompt(sessionId)
      const snapshot = config.snapshots
        ? await this.createSnapshotId(
            sessionId,
            workspace,
            await this.resolveRunReferences(config, workspace)
          )
        : undefined
      const assistant = makeAssistantMessage(sessionId, snapshot)
      if (!this.store.get(sessionId)) throw new Error('SESSION_NOT_FOUND')
      await this.store.appendMessage(sessionId, assistant)
      await this.store.setStatus(sessionId, 'running')
      this.beginRun(sessionId, assistant, new Set([last.id]), config, models, continuationPrompt)
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
          sessionId: randomUUID(),
          retry: effective.config.retry ?? DEFAULT_RETRY_CONFIG
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
    this.closed = true
    this.queues.clear()
    this.backgroundTasks.cancelAll()
    this.pendingBackgroundWake.clear()
    this.backgroundSilenced.clear()
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
      parentMessageId: string
      toolCallId: string
      agentId: string
      description: string
      cleanup: () => void
    }
  ): void {
    const taskId = backgroundTaskId(info.parentSessionId, info.toolCallId)
    this.publishBackgroundTask(
      this.backgroundTasks.start({
        id: taskId,
        kind: 'subagent',
        sessionId: info.parentSessionId,
        toolCallId: info.toolCallId,
        ownerMessageId: info.parentMessageId,
        title: info.description,
        childSessionId: run.sessionId,
        cancel: () => run.abort.abort()
      })
    )
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
        const finished = this.backgroundTasks.complete(taskId, {
          state:
            status === 'completed'
              ? 'completed'
              : status === 'interrupted'
                ? 'cancelled'
                : 'failed',
          ...(result ? { result } : {}),
          ...(status === 'failed'
            ? { error: message?.error ?? 'The subagent did not finish.' }
            : {})
        })
        if (finished) {
          this.publishBackgroundTask(finished)
          this.deliverBackgroundResult(finished)
        }
      })
  }

  private publishBackgroundTask(task: BackgroundTaskInfo): void {
    this.events.emit({ type: 'background.updated', sessionId: task.sessionId, task })
  }

  /**
   * Appends a synthetic user message carrying the task result and, when the
   * parent session is idle, starts a continuation run so the agent can react.
   */
  private deliverBackgroundResult(task: BackgroundTaskInfo): void {
    if (this.closed || task.state === 'cancelled') return
    if (this.backgroundTasks.isConsumed(task.id)) return
    const record = this.store.get(task.sessionId)
    if (!record || record.session.hidden) return
    const taskRecord = this.backgroundTasks.record(task.id)
    this.backgroundTasks.consume(task.id)
    const message = makeBackgroundResultMessage(task)
    void this.store
      .appendMessage(task.sessionId, message)
      .then(() => {
        this.events.emit({ type: 'message.upsert', message: structuredClone(message) })
        this.events.emitSession(task.sessionId)
        this.maybeWakeForBackground(task.sessionId, taskRecord?.ownerMessageId)
      })
      .catch(() => undefined)
  }

  private maybeWakeForBackground(sessionId: string, ownerMessageId?: string): void {
    if (this.backgroundSilenced.has(sessionId) || this.closed) return
    if (ownerMessageId && !this.shouldWakeForBackground(sessionId, ownerMessageId)) return
    const record = this.store.get(sessionId)
    if (!record || record.session.hidden) return
    if (this.sessionBusy(sessionId)) {
      this.pendingBackgroundWake.add(sessionId)
      return
    }
    if ((this.queues.get(sessionId)?.length ?? 0) > 0) {
      this.drainQueue(sessionId)
      return
    }
    setTimeout(() => {
      void this.startBackgroundContinuation(sessionId).catch((error) => {
        console.warn('[runtime] failed to start the background continuation', error)
      })
    }, 0)
  }

  /** True when the run that started the task finished normally and nothing was stopped. */
  private shouldWakeForBackground(sessionId: string, ownerMessageId: string): boolean {
    if (this.backgroundSilenced.has(sessionId) || this.closed) return false
    const record = this.store.get(sessionId)
    if (!record || record.session.hidden) return false
    const owner = record.messages.find((message) => message.id === ownerMessageId)
    return !owner || owner.status === 'complete'
  }

  private async startBackgroundContinuation(sessionId: string): Promise<void> {
    if (this.closed || this.backgroundSilenced.has(sessionId)) return
    if (this.sessionBusy(sessionId)) return
    const record = this.store.get(sessionId)
    if (!record || record.session.hidden) return
    if ((this.queues.get(sessionId)?.length ?? 0) > 0) {
      this.drainQueue(sessionId)
      return
    }
    this.reserveSession(sessionId)
    try {
      const workspace = this.sessionWorkspace(sessionId)
      const effective = await this.applyWorkspaceConfig(workspace)
      const config = effective.config
      const models = await this.modelsForWorkspace(workspace, config)
      resolveModelRef(models, record.session.model ?? models.defaultModel)
      if (this.backgroundSilenced.has(sessionId)) return
      const snapshot = config.snapshots
        ? await this.createSnapshotId(
            sessionId,
            workspace,
            await this.resolveRunReferences(config, workspace)
          )
        : undefined
      const assistant = makeAssistantMessage(sessionId, snapshot)
      if (!this.store.get(sessionId)) return
      await this.store.appendMessage(sessionId, assistant)
      await this.store.setStatus(sessionId, 'running')
      this.beginRun(sessionId, assistant, undefined, config, models)
    } finally {
      this.starting.delete(sessionId)
    }
  }

  private disposeBackgroundSession(sessionId: string): void {
    for (const task of this.backgroundTasks.running(sessionId)) this.backgroundTasks.cancel(task.id)
    this.backgroundTasks.clearSession(sessionId)
    this.pendingBackgroundWake.delete(sessionId)
    this.backgroundSilenced.delete(sessionId)
  }

  private finishShellBackground(
    run: Run,
    info: {
      toolCallId: string
      command: string
      exitCode: number | null
      outputPath: string | null
    }
  ): void {
    const taskId = backgroundTaskId(run.sessionId, info.toolCallId)
    void this.readBackgroundOutput(info.outputPath).then((output) => {
      const state = info.exitCode === 0 ? 'completed' : 'failed'
      const finished = this.backgroundTasks.complete(taskId, {
        state,
        exitCode: info.exitCode,
        ...(output ? { result: output } : {}),
        ...(state === 'failed'
          ? { error: `The command exited with code ${info.exitCode ?? 'unknown'}.` }
          : {})
      })
      this.events.emit({
        type: 'background.finished',
        sessionId: run.sessionId,
        messageId: run.messageId,
        toolCallId: info.toolCallId,
        command: info.command,
        exitCode: info.exitCode,
        outputPath: info.outputPath
      })
      if (!finished) return
      this.publishBackgroundTask(finished)
      this.deliverBackgroundResult(finished)
    })
  }

  private async readBackgroundOutput(outputPath: string | null): Promise<string | undefined> {
    if (!outputPath) return undefined
    try {
      const output = await fs.readFile(outputPath, 'utf8')
      return output.trim() ? output : undefined
    } catch {
      return undefined
    }
  }

  private backgroundTaskList(run: Run): string {
    return formatBackgroundTaskList(this.backgroundTasks.list(run.sessionId))
  }

  private async backgroundTaskWait(run: Run, taskId: string, timeoutMs: number): Promise<string> {
    const target = this.backgroundTasks.get(taskId)
    if (!target || target.sessionId !== run.sessionId) {
      return `Error: unknown background task: ${taskId}`
    }
    const task = await this.backgroundTasks.wait(taskId, timeoutMs, run.abort.signal)
    if (!task) {
      const current = this.backgroundTasks.get(taskId)
      return current
        ? `Background task ${taskId} is still running (${current.title}).`
        : `Error: unknown background task: ${taskId}`
    }
    this.backgroundTasks.consume(taskId)
    return formatBackgroundResult(task)
  }

  private backgroundTaskCancel(run: Run, taskId: string): string {
    const task = this.backgroundTasks.get(taskId)
    if (!task || task.sessionId !== run.sessionId) {
      return `Error: unknown background task: ${taskId}`
    }
    this.backgroundTasks.consume(taskId)
    if (!this.backgroundTasks.cancel(taskId)) {
      return `Background task ${taskId} already finished (${task.state}).`
    }
    const info = this.backgroundTasks.get(taskId)
    if (info) this.publishBackgroundTask(info)
    return `Cancelled background task ${taskId}.`
  }

  listBackgroundTasks(sessionId?: string): BackgroundTaskInfo[] {
    return this.backgroundTasks.list(sessionId)
  }

  cancelBackgroundTask(taskId: string): boolean {
    const task = this.backgroundTasks.get(taskId)
    if (!task) return false
    this.backgroundTasks.consume(taskId)
    if (!this.backgroundTasks.cancel(taskId)) return false
    const info = this.backgroundTasks.get(taskId)
    if (info) this.publishBackgroundTask(info)
    return true
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

  private async startBuildContinuation(previous: Run): Promise<void> {
    const sessionId = previous.sessionId
    if (this.sessionBusy(sessionId)) return
    const record = this.store.get(sessionId)
    if (!record || record.session.agent !== 'build') return
    const workspace = this.sessionWorkspace(sessionId)
    const effective = await this.applyWorkspaceConfig(workspace)
    const config = effective.config
    const models = await this.modelsForWorkspace(workspace, config)
    resolveModelRef(models, record.session.model ?? models.defaultModel)
    const continuationPrompt = await this.planService.continuationPrompt(sessionId)
    if (!continuationPrompt || this.sessionBusy(sessionId)) return
    const snapshot = config.snapshots
      ? await this.createSnapshotId(
          sessionId,
          workspace,
          await this.resolveRunReferences(config, workspace)
        )
      : undefined
    const assistant = makeAssistantMessage(sessionId, snapshot)
    if (!this.store.get(sessionId)) return
    await this.store.appendMessage(sessionId, assistant)
    await this.store.setStatus(sessionId, 'running')
    this.beginRun(sessionId, assistant, undefined, config, models, continuationPrompt)
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

  private async consumeTurnStream(
    run: Run,
    message: ChatMessage,
    stream: AsyncIterable<TextStreamPart<ToolSet>>,
    state: TurnStreamState,
    schedulePersist: () => void
  ): Promise<void> {
    for await (const part of stream) {
      switch (part.type) {
        case 'text-start': {
          const index = message.parts.length
          message.parts.push({ type: 'text', text: '' })
          state.textParts.set(part.id, index)
          emitPart(this.events, run, message.parts[index], index)
          break
        }
        case 'text-delta': {
          const index = state.textParts.get(part.id)
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
          state.textParts.delete(part.id)
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
          state.reasoningParts.set(part.id, index)
          emitPart(this.events, run, message.parts[index], index)
          break
        }
        case 'reasoning-delta': {
          const index = state.reasoningParts.get(part.id)
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
          const index = state.reasoningParts.get(part.id)
          if (index !== undefined && part.providerMetadata) {
            const reasoningPart = message.parts[index]
            if (reasoningPart?.type === 'reasoning') {
              reasoningPart.providerMetadata = structuredClone(part.providerMetadata)
              emitPart(this.events, run, reasoningPart, index)
            }
          }
          state.reasoningParts.delete(part.id)
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
          const overrides = run.pluginToolOverrides
          toolPart.input = overrides?.inputs.has(part.toolCallId)
            ? overrides.inputs.get(part.toolCallId)
            : part.input
          toolPart.state = 'running'
          emitPart(this.events, run, toolPart, message.parts.indexOf(toolPart))
          break
        }
        case 'tool-result': {
          const toolPart = findToolPart(message, part.toolCallId)
          if (toolPart && toolPart.type === 'tool') {
            if (toolPart.state !== 'denied') {
              toolPart.state = 'completed'
              const overrides = run.pluginToolOverrides
              const output = overrides?.outputs.has(part.toolCallId)
                ? overrides.outputs.get(part.toolCallId)
                : (part.output as unknown)
              const formatted = formatToolOutput(output)
              toolPart.output = formatted.text
              toolPart.images = formatted.images
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
        case 'start-step':
          this.stepTracker.ensureStepStarted(run, message)
          schedulePersist()
          break
        case 'finish-step':
          await this.stepTracker.finishStep(run, message, part, state)
          await this.store.persist(run.sessionId)
          break
        case 'finish':
          state.usage = usageFrom(part.totalUsage)
          break
        case 'error':
          throw part.error
        case 'abort':
          throw new Error('ABORTED')
        default:
          break
      }
    }
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
      storeOutput: (run, toolName, toolCallId, output) =>
        this.toolOutputs.bound(
          run.sessionId,
          toolCallId,
          output,
          toolOutputLimitsFor(run.config.toolOutput, toolName)
        ),
      toolOutputPath: (sessionId, toolCallId) => this.toolOutputs.pathFor(sessionId, toolCallId),
      appendToolOutput: (run, toolCallId, delta) =>
        appendToolOutput(this.events, this.assistantFor(run), run, toolCallId, delta),
      registerBackgroundShell: (run, info) => {
        const task = this.backgroundTasks.start({
          id: backgroundTaskId(run.sessionId, info.toolCallId),
          kind: 'shell',
          sessionId: run.sessionId,
          toolCallId: info.toolCallId,
          ownerMessageId: run.messageId,
          title: info.title,
          outputPath: info.outputPath,
          cancel: info.cancel
        })
        this.publishBackgroundTask(task)
      },
      emitBackgroundFinished: (run, info) => this.finishShellBackground(run, info),
      listBackgroundTasks: (run) => this.backgroundTaskList(run),
      waitBackgroundTask: (run, taskId, timeoutMs) =>
        this.backgroundTaskWait(run, taskId, timeoutMs),
      cancelBackgroundTask: (run, taskId) => this.backgroundTaskCancel(run, taskId),
      formatFiles: (run, files) =>
        this.workspaceServices.formatFiles(run.workspace, files, run.config.formatterOverrides),
      diagnoseFiles: (run, files) => this.workspaceServices.diagnoseFiles(run.workspace, files),
      lspHover: (run, file, line, character) =>
        this.workspaceServices.lspHover(run.workspace, file, line, character),
      lspDefinition: (run, file, line, character) =>
        this.workspaceServices.lspDefinition(run.workspace, file, line, character),
      lspReferences: (run, file, line, character) =>
        this.workspaceServices.lspReferences(run.workspace, file, line, character),
      lspImplementation: (run, file, line, character) =>
        this.workspaceServices.lspImplementation(run.workspace, file, line, character),
      lspDocumentSymbols: (run, file) =>
        this.workspaceServices.lspDocumentSymbols(run.workspace, file),
      lspWorkspaceSymbols: (run, query, file) =>
        this.workspaceServices.lspWorkspaceSymbols(run.workspace, query, file),
      lspCallHierarchy: (run, file, line, character, direction) =>
        this.workspaceServices.lspCallHierarchy(run.workspace, file, line, character, direction),
      runSubagent: (run, input, toolCallId) => this.runSubagent(run, input, toolCallId),
      fetchWebPage: (input) => this.workspaceServices.fetchWebPage(input),
      searchTheWeb: (input) => this.workspaceServices.searchTheWeb(input),
      writeTodos: (run, todos) => this.writeTodos(run, todos),
      readTodos: (run) => this.readTodos(run),
      askQuestion: (run, input, toolCallId) =>
        this.permissionService.askQuestion(run, input, toolCallId),
      exitPlan: (run) => this.planService.exitPlan(run),
      planReady: (run) => this.planService.isReady(run),
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
      vcsInfo: (run) => this.deps.createVcs(run.workspace).info(),
      vcsStatus: (run) => this.deps.createVcs(run.workspace).status(),
      vcsDiff: (run, options) => this.deps.createVcs(run.workspace).diff(options),
      vcsApply: (run, patch) => this.deps.createVcs(run.workspace).apply(patch),
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
      planFilePath: (run) => this.planService.filePathFor(run),
      applyPluginToolUpdate: (run, messageId, update) =>
        this.applyPluginToolUpdate(run, messageId, update)
    }
  }

  private applyPluginToolUpdate(
    run: Run,
    messageId: string,
    update: {
      toolCallId: string
      toolName: string
      input?: unknown
      output?: unknown
    }
  ): void {
    const message = this.record(run.sessionId).messages.find((entry) => entry.id === messageId)
    if (!message) return
    const toolPart = ensureToolPart(message, update.toolCallId, update.toolName)
    if ('input' in update) toolPart.input = update.input
    if ('output' in update) {
      const formatted = formatToolOutput(update.output)
      if (formatted.text === undefined) delete toolPart.output
      else toolPart.output = formatted.text
      if (formatted.images) toolPart.images = formatted.images
    }
    if (toolPart.state === 'pending') toolPart.state = 'running'
    message.updatedAt = nowIso()
    emitPart(this.events, run, toolPart, message.parts.indexOf(toolPart))
    void this.store.persist(run.sessionId).catch(() => undefined)
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

    const state: TurnStreamState = {
      textParts: new Map(),
      reasoningParts: new Map()
    }
    let runTarget: ModelRef | null = null
    let prepareCompaction = false
    let retryCount = 0
    let lastRetryReason: string | null = null

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
      const retryConfig = run.config.retry ?? DEFAULT_RETRY_CONFIG
      const model = this.deps.createLanguageModel(run.models, target, {
        sessionId: run.sessionId,
        retry: retryConfig,
        onRetry: (info) => {
          if (info) {
            retryCount += 1
            lastRetryReason = info.reason
            this.retryMetrics.recordRetry(info)
            message.retry = info
          } else delete message.retry
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
      const maxStreamAttempts = retryConfig.maxRetries + 1
      let streamAttempt = 0
      for (;;) {
        streamAttempt += 1
        try {
          const result = this.deps.createTurn({
            model,
            system: prepared.system,
            systemProviderOptions: prepared.systemProviderOptions,
            messages: prepared.messages,
            tools: prepared.tools,
            abortSignal: run.abort.signal,
            shouldStop: () => run.exitedPlan === true || this.hasAfterStepSteer(run.sessionId),
            reasoning: prepared.params.reasoning,
            maxSteps: agent?.maxSteps ?? undefined,
            maxOutputTokens: prepared.params.maxOutputTokens,
            temperature: prepared.params.temperature,
            providerOptions: prepared.providerOptions
          })
          await this.consumeTurnStream(run, message, result.stream, state, schedulePersist)
          break
        } catch (error) {
          if (
            streamAttempt >= maxStreamAttempts ||
            run.abort.signal.aborted ||
            !isRetryableStreamError(error) ||
            message.parts.some((part) => part.type === 'tool')
          ) {
            throw error
          }
          const delayMs = retryDelayMs(streamAttempt, retryConfig.maxDelayMs)
          const reason = normalizeError(error)
          const retry: ChatRetryStatus = {
            attempt: streamAttempt,
            maxAttempts: maxStreamAttempts,
            delayMs,
            reason
          }
          retryCount += 1
          lastRetryReason = reason
          this.retryMetrics.recordRetry(retry)
          state.usage = undefined
          state.lastStepUsage = undefined
          state.textParts.clear()
          state.reasoningParts.clear()
          this.stepTracker.resetAssistantMessage(run, message, retry)
          await abortableSleep(delayMs, run.abort.signal)
        }
      }

      message.status = 'complete'
      delete message.retry
      delete message.retryFailure
      message.updatedAt = nowIso()
      message.durationMs = Date.now() - run.startedAt
      message.usage = state.usage
      message.contextUsage = state.lastStepUsage
      message.costUsd = this.messageCost(runTarget, state.usage, run.models)
      if (retryCount > 0) this.retryMetrics.recordOutcome(true)
      settleTools(message, 'Tool call did not finish')
      await this.stepTracker.recordAfterSnapshot(run, message, state.lastFinishReason ?? 'stop')
      await this.store.persist(run.sessionId)
      this.events.emit({ type: 'message.upsert', message: structuredClone(message) })
      await this.compaction.updateContextUsage(run.sessionId)
      prepareCompaction = true
      await this.store.setStatus(run.sessionId, 'idle')
      this.events.emitSession(run.sessionId)
      await this.maybeGenerateTitle(run, model, message)
      // The last allowed step is forced into a text-only summary by the turn's
      // prepareStep handler, so its finishReason is 'stop'; derive the outcome
      // from the step count against the agent's own limit instead.
      const outcome: RunOutcome =
        run.steps >= (agent?.maxSteps ?? MAX_STEPS) ? 'max-steps' : 'completed'
      this.events.emit({
        type: 'run.finished',
        sessionId: run.sessionId,
        messageId: message.id,
        status: outcome,
        usage: state.usage,
        durationMs: message.durationMs
      })
      if (run.exitedPlan) {
        setTimeout(() => {
          void this.startBuildContinuation(run).catch((error) => {
            console.warn('[runtime] failed to start the build continuation', error)
          })
        }, 0)
      }
    } catch (error) {
      if (!run.retried && isContextLengthError(error)) {
        try {
          const compacted = await this.compaction.compactForOverflow(run)
          if (compacted) {
            run.retried = true
            state.usage = undefined
            state.lastStepUsage = undefined
            state.lastFinishReason = undefined
            state.textParts.clear()
            state.reasoningParts.clear()
            this.stepTracker.resetAssistantMessage(run, message)
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
      if (retryCount > 0 && !interrupted) {
        this.retryMetrics.recordOutcome(false)
        message.retryFailure = {
          retries: retryCount,
          reason: lastRetryReason ?? normalizeError(error)
        }
      } else {
        delete message.retryFailure
      }
      message.error = interrupted ? 'Interrupted by user' : normalizeError(error)
      message.updatedAt = nowIso()
      message.durationMs = Date.now() - run.startedAt
      message.usage = state.usage
      message.contextUsage = state.lastStepUsage
      message.costUsd = this.messageCost(runTarget, state.usage, run.models)
      settleTools(message, interrupted ? 'Interrupted by user' : 'Tool call failed')
      await this.stepTracker.recordAfterSnapshot(
        run,
        message,
        interrupted ? 'interrupted' : 'error'
      )
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
        usage: state.usage,
        durationMs: message.durationMs
      })
    } finally {
      if (persistTimer) clearTimeout(persistTimer)
      this.runs.delete(run.sessionId)
      if (prepareCompaction) this.compaction.schedulePreparedCompaction(run.sessionId)
      this.events.emitSession(run.sessionId)
      void this.workspaceServices.releaseWorkspace(run.workspace)
      const wokenByBackground = this.pendingBackgroundWake.delete(run.sessionId)
      const queued = (this.queues.get(run.sessionId)?.length ?? 0) > 0
      this.drainQueue(run.sessionId)
      if (wokenByBackground && !queued) {
        setTimeout(() => {
          void this.startBackgroundContinuation(run.sessionId).catch((error) => {
            console.warn('[runtime] failed to start the background continuation', error)
          })
        }, 0)
      }
    }
  }
}
