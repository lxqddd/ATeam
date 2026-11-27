import type {
  AgentConfig,
  AgentDefinition,
  ConfigFileChange,
  EffectiveAgentConfig,
  GlobalConfigFile,
  PluginAuthAuthorizeInput,
  PluginAuthCompleteInput,
  PluginAuthMethodState,
  PluginAuthResult,
  PluginEntry,
  PluginInstallInput,
  PluginUpdateInput,
  ProjectConfigEdit,
  ProjectConfigEditInput,
  ProjectConfigFile,
  AgentEventEnvelope,
  AgentInfo,
  AgentStatus,
  BackgroundTaskInfo,
  CommandDefinition,
  McpAuthStatus,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  MessagesSnapshot,
  PermissionDecision,
  PermissionRequest,
  PermissionRule,
  PermissionRulesOverview,
  QuestionAnswer,
  QuestionRequest,
  PermissionRuleInput,
  MessageAttachment,
  QueuedMessage,
  SessionChangesSummary,
  SessionMeta,
  SessionPlan,
  SessionSearchResult,
  SessionSettings,
  SessionUndoResult,
  SteerStrategy,
  TurnChanges,
  WebSearchInput,
  WebSearchProviderPublic
} from './agent-types'
import type { UpdateDownloadResult, UpdateInfo, UpdateProgress } from './update-types'
import type {
  GitHubCommentInput,
  GitHubCommentResult,
  GitHubContextResult,
  GitHubCreatePullInput,
  GitHubCreatePullResult,
  GitHubItemKind,
  GitHubItemSummary,
  GitHubRepoInfo,
  GitHubTokenStatus
} from './github-types'
import type {
  SessionExportRequest,
  SessionExportResult,
  SessionImportResult
} from './session-export'
import type { UsageStats, UsageStatsRange } from './usage-stats'
import type { VcsDiffOptions, VcsDiffResult, VcsStatus } from './vcs-types'
import type {
  ModelCatalogEntry,
  ModelCreateInput,
  ModelRef,
  ModelTestResult,
  ModelUpdateInput,
  ModelsConfigPublic,
  ProviderCreateInput,
  ProviderUpdateInput,
  ProviderModelListInput,
  ProviderOAuthStatus,
  AvailableModel
} from './model-types'

export interface AgentBridge {
  status: () => Promise<AgentStatus>
  restart: () => Promise<AgentStatus>
  info: () => Promise<AgentInfo>
  agents: (directory?: string | null) => Promise<AgentDefinition[]>
  onEvent: (callback: (envelope: AgentEventEnvelope) => void) => () => void
  sessions: {
    list: () => Promise<SessionMeta[]>
    create: (directory?: string | null) => Promise<SessionMeta>
    rename: (id: string, title: string) => Promise<SessionMeta>
    remove: (id: string) => Promise<void>
    setModel: (id: string, model: ModelRef | null) => Promise<SessionMeta>
    setSettings: (id: string, settings: SessionSettings) => Promise<SessionMeta>
    setDirectory: (id: string, directory: string | null) => Promise<SessionMeta>
    setAgent: (id: string, agent: string | null) => Promise<SessionMeta>
    plan: (id: string) => Promise<SessionPlan>
    compact: (id: string) => Promise<SessionMeta>
    undo: (id: string, messageId?: string, stepIndex?: number) => Promise<SessionUndoResult>
    redo: (id: string) => Promise<SessionMeta>
    fork: (id: string, messageId?: string) => Promise<SessionMeta>
    search: (query: string) => Promise<SessionSearchResult[]>
    export: (options: SessionExportRequest) => Promise<SessionExportResult>
    import: () => Promise<SessionImportResult>
    usage: (range: UsageStatsRange) => Promise<UsageStats>
    changes: (sessionId: string, messageId?: string) => Promise<TurnChanges>
    changesSummary: (sessionId: string) => Promise<SessionChangesSummary>
    revertFiles: (sessionId: string, messageId: string, paths?: string[]) => Promise<TurnChanges>
    unrevertFiles: (sessionId: string, paths?: string[]) => Promise<TurnChanges>
  }
  messages: {
    list: (sessionId: string) => Promise<MessagesSnapshot>
  }
  vcs: {
    status: (sessionId: string) => Promise<VcsStatus>
    diff: (sessionId: string, options?: VcsDiffOptions) => Promise<VcsDiffResult>
  }
  chat: {
    send: (input: {
      sessionId: string
      text: string
      model?: ModelRef | null
      attachments?: MessageAttachment[]
    }) => Promise<void>
    stop: (sessionId: string) => Promise<void>
    retry: (sessionId: string) => Promise<void>
    steer: (input: {
      sessionId: string
      text: string
      strategy: SteerStrategy
      attachments?: MessageAttachment[]
    }) => Promise<QueuedMessage>
    removeQueued: (sessionId: string, id: string) => Promise<boolean>
  }
  background: {
    list: (sessionId?: string) => Promise<BackgroundTaskInfo[]>
    cancel: (taskId: string) => Promise<boolean>
  }
  permissions: {
    list: () => Promise<PermissionRequest[]>
    reply: (requestId: string, decision: PermissionDecision) => Promise<void>
    rules: (sessionId?: string) => Promise<PermissionRule[]>
    overview: (directory?: string | null) => Promise<PermissionRulesOverview>
    addRule: (input: PermissionRuleInput) => Promise<PermissionRule>
    removeRule: (id: string) => Promise<boolean>
  }
  questions: {
    list: () => Promise<QuestionRequest[]>
    reply: (questionId: string, answer: QuestionAnswer) => Promise<void>
  }
  config: {
    get: () => Promise<AgentConfig>
    update: (patch: Partial<AgentConfig>) => Promise<AgentConfig>
    resolve: (directory?: string | null) => Promise<EffectiveAgentConfig>
    /** Subscribes to config files changed outside the app; returns an unsubscribe function. */
    onExternalChange: (callback: (change: ConfigFileChange) => void) => () => void
    project: {
      get: (directory?: string | null) => Promise<ProjectConfigFile>
      update: (input: { directory?: string | null; content: string }) => Promise<ProjectConfigFile>
      edit: (input: ProjectConfigEditInput) => Promise<ProjectConfigFile>
    }
    global: {
      get: () => Promise<GlobalConfigFile>
      update: (input: { content: string }) => Promise<GlobalConfigFile>
      edit: (input: { edits: ProjectConfigEdit[] }) => Promise<GlobalConfigFile>
    }
  }
  plugins: {
    list: () => Promise<PluginEntry[]>
    install: (input: PluginInstallInput) => Promise<PluginEntry[]>
    update: (id: string, input: PluginUpdateInput) => Promise<PluginEntry[]>
    remove: (id: string) => Promise<PluginEntry[]>
    authMethods: (directory?: string | null) => Promise<PluginAuthMethodState[]>
    authorizeAuth: (input: PluginAuthAuthorizeInput) => Promise<PluginAuthResult>
    completeAuth: (input: PluginAuthCompleteInput) => Promise<PluginAuthResult>
    logoutAuth: (provider: string, directory?: string | null) => Promise<PluginAuthMethodState[]>
  }
  mcp: {
    list: (directory?: string | null) => Promise<{
      servers: McpServerConfig[]
      statuses: McpServerStatus[]
    }>
    statuses: (options?: {
      probe?: boolean
      directory?: string | null
    }) => Promise<McpServerStatus[]>
    add: (input: McpServerInput) => Promise<McpServerConfig>
    update: (id: string, input: Partial<McpServerInput>) => Promise<McpServerConfig>
    remove: (id: string) => Promise<boolean>
    prompt: (
      server: string,
      prompt: string,
      args?: Record<string, string>,
      directory?: string | null
    ) => Promise<string>
    authStatuses: (directory?: string | null) => Promise<McpAuthStatus[]>
    authorize: (id: string, directory?: string | null) => Promise<McpAuthStatus[]>
    logout: (id: string, directory?: string | null) => Promise<McpAuthStatus[]>
  }
  websearch: {
    get: () => Promise<WebSearchProviderPublic>
    update: (input: WebSearchInput) => Promise<WebSearchProviderPublic>
  }
  github: {
    status: () => Promise<GitHubTokenStatus>
    updateToken: (token: string) => Promise<GitHubTokenStatus>
    clearToken: () => Promise<GitHubTokenStatus>
    repo: (directory?: string | null) => Promise<GitHubRepoInfo | null>
    list: (input: { repo: string; kind?: GitHubItemKind }) => Promise<GitHubItemSummary[]>
    context: (ref: string) => Promise<GitHubContextResult>
    comment: (input: GitHubCommentInput) => Promise<GitHubCommentResult>
    createPull: (input: GitHubCreatePullInput) => Promise<GitHubCreatePullResult>
  }
  attachments: {
    import: (
      sessionId: string,
      input: { name: string; mimeType: string; data: Uint8Array }
    ) => Promise<MessageAttachment>
    remove: (sessionId: string, attachmentId: string) => Promise<void>
    preview: (sessionId: string, path: string) => Promise<string | null>
  }
  files: {
    search: (query: string, directory?: string | null) => Promise<string[]>
  }
  commands: {
    list: (directory?: string | null) => Promise<CommandDefinition[]>
    expand: (input: {
      template: string
      args: string
      directory?: string | null
    }) => Promise<string>
    run: (input: {
      sessionId: string
      name: string
      args?: string
    }) => Promise<{ taskId: string; sessionId: string }>
  }
}

export interface ModelsBridge {
  get: () => Promise<ModelsConfigPublic>
  addProvider: (input: ProviderCreateInput) => Promise<ModelsConfigPublic>
  updateProvider: (input: ProviderUpdateInput) => Promise<ModelsConfigPublic>
  deleteProvider: (id: string) => Promise<ModelsConfigPublic>
  revealApiKey: (providerId: string) => Promise<string | null>
  oauthStatuses: () => Promise<ProviderOAuthStatus[]>
  authorizeOAuth: (providerId: string) => Promise<ProviderOAuthStatus[]>
  logoutOAuth: (providerId: string) => Promise<ProviderOAuthStatus[]>
  addModel: (input: ModelCreateInput) => Promise<ModelsConfigPublic>
  updateModel: (input: ModelUpdateInput) => Promise<ModelsConfigPublic>
  deleteModel: (id: string) => Promise<ModelsConfigPublic>
  setDefault: (model: ModelRef | null) => Promise<ModelsConfigPublic>
  test: (providerId: string, modelId: string) => Promise<ModelTestResult>
  listModels: (providerId: string) => Promise<AvailableModel[]>
  previewModels: (input: ProviderModelListInput) => Promise<AvailableModel[]>
  catalog: (refresh?: boolean) => Promise<ModelCatalogEntry[]>
}

export type DesktopPlatform = 'darwin' | 'win32' | 'linux'

export interface UpdateBridge {
  check: () => Promise<UpdateInfo>
  download: (version: string) => Promise<UpdateDownloadResult>
  onProgress: (callback: (progress: UpdateProgress) => void) => () => void
}

export interface AteamApi {
  platform: DesktopPlatform
  versions: { electron: string }
  theme: { set: (theme: 'light' | 'dark') => void }
  updates: UpdateBridge
  agent: AgentBridge
  models: ModelsBridge
  workspace: {
    open: (path?: string | null) => Promise<void>
    pickDirectory: (defaultPath?: string) => Promise<string | null>
  }
  openExternal: (url: string) => Promise<void>
}
