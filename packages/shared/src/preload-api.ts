import type {
  AgentConfig,
  AgentDefinition,
  EffectiveAgentConfig,
  ProjectConfigFile,
  AgentEventEnvelope,
  AgentInfo,
  AgentStatus,
  CommandDefinition,
  McpAuthStatus,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  MessagesSnapshot,
  PermissionDecision,
  PermissionRequest,
  PermissionRule,
  QuestionAnswer,
  QuestionRequest,
  PermissionRuleInput,
  MessageAttachment,
  SessionMeta,
  SessionSearchResult,
  SessionSettings,
  SessionUndoResult,
  TurnChanges,
  WebSearchInput,
  WebSearchProviderPublic
} from './agent-types'
import type { UpdateDownloadResult, UpdateInfo, UpdateProgress } from './update-types'
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
    compact: (id: string) => Promise<SessionMeta>
    undo: (id: string, messageId?: string) => Promise<SessionUndoResult>
    redo: (id: string) => Promise<SessionMeta>
    fork: (id: string, messageId?: string) => Promise<SessionMeta>
    search: (query: string) => Promise<SessionSearchResult[]>
    changes: (sessionId: string, messageId?: string) => Promise<TurnChanges>
    revertFiles: (sessionId: string, messageId: string, paths?: string[]) => Promise<TurnChanges>
  }
  messages: {
    list: (sessionId: string) => Promise<MessagesSnapshot>
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
  }
  permissions: {
    list: () => Promise<PermissionRequest[]>
    reply: (requestId: string, decision: PermissionDecision) => Promise<void>
    rules: (sessionId?: string) => Promise<PermissionRule[]>
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
    project: {
      get: (directory?: string | null) => Promise<ProjectConfigFile>
      update: (input: { directory?: string | null; content: string }) => Promise<ProjectConfigFile>
    }
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
