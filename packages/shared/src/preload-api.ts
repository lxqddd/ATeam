import type {
  AgentEventEnvelope,
  AgentInfo,
  AgentStatus,
  MessagesSnapshot,
  PermissionDecision,
  PermissionRequest,
  PermissionRule,
  PermissionRuleInput,
  SessionMeta,
  SessionSettings,
  SessionUndoResult
} from './agent-types'
import type {
  ModelCreateInput,
  ModelRef,
  ModelTestResult,
  ModelUpdateInput,
  ModelsConfigPublic,
  ProviderCreateInput,
  ProviderUpdateInput,
  ProviderModelListInput,
  AvailableModel
} from './model-types'

export interface AgentBridge {
  status: () => Promise<AgentStatus>
  restart: () => Promise<AgentStatus>
  info: () => Promise<AgentInfo>
  onEvent: (callback: (envelope: AgentEventEnvelope) => void) => () => void
  sessions: {
    list: () => Promise<SessionMeta[]>
    create: () => Promise<SessionMeta>
    rename: (id: string, title: string) => Promise<SessionMeta>
    remove: (id: string) => Promise<void>
    setModel: (id: string, model: ModelRef | null) => Promise<SessionMeta>
    setSettings: (id: string, settings: SessionSettings) => Promise<SessionMeta>
    compact: (id: string) => Promise<SessionMeta>
    undo: (id: string) => Promise<SessionUndoResult>
    redo: (id: string) => Promise<SessionMeta>
  }
  messages: {
    list: (sessionId: string) => Promise<MessagesSnapshot>
  }
  chat: {
    send: (input: { sessionId: string; text: string; model?: ModelRef | null }) => Promise<void>
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
}

export interface ModelsBridge {
  get: () => Promise<ModelsConfigPublic>
  addProvider: (input: ProviderCreateInput) => Promise<ModelsConfigPublic>
  updateProvider: (input: ProviderUpdateInput) => Promise<ModelsConfigPublic>
  deleteProvider: (id: string) => Promise<ModelsConfigPublic>
  revealApiKey: (providerId: string) => Promise<string | null>
  addModel: (input: ModelCreateInput) => Promise<ModelsConfigPublic>
  updateModel: (input: ModelUpdateInput) => Promise<ModelsConfigPublic>
  deleteModel: (id: string) => Promise<ModelsConfigPublic>
  setDefault: (model: ModelRef | null) => Promise<ModelsConfigPublic>
  test: (providerId: string, modelId: string) => Promise<ModelTestResult>
  listModels: (providerId: string) => Promise<AvailableModel[]>
  previewModels: (input: ProviderModelListInput) => Promise<AvailableModel[]>
}

export type DesktopPlatform = 'darwin' | 'win32' | 'linux'

export interface AteamApi {
  platform: DesktopPlatform
  versions: { electron: string }
  theme: { set: (theme: 'light' | 'dark') => void }
  agent: AgentBridge
  models: ModelsBridge
  workspace: { open: () => Promise<void> }
  openExternal: (url: string) => Promise<void>
}
