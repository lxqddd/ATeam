export const APP_NAME = 'ATeam'

export interface Project {
  id: string
  name: string
  path: string
  lastOpenedAt?: string
}

export interface ProjectList {
  projects: Project[]
  activeId?: string
}

export type SessionStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface Session {
  id: string
  projectId: string
  title: string
  status: SessionStatus
  createdAt: string
  updatedAt: string
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  createdAt: string
  status?: 'pending' | 'streaming' | 'completed' | 'failed'
}

export interface ToolCall {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input?: unknown
  output?: string
}

export type KernelStatus = 'stopped' | 'starting' | 'ready' | 'error'

export interface KernelState {
  status: KernelStatus
  port?: number
  error?: string
}

export interface KernelSession {
  id: string
  title: string
  directory: string
  busy: boolean
  createdAt?: string
  updatedAt?: string
  model?: { id: string; providerID: string }
}

export interface KernelModel {
  id: string
  providerID: string
  name: string
  context?: number
}

export type KernelMessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'error'

export type KernelToolStatus = 'pending' | 'running' | 'completed' | 'failed'

export type KernelPart =
  | { kind: 'text'; text: string; reasoning?: boolean }
  | {
      kind: 'tool'
      id: string
      name: string
      status: KernelToolStatus
      input?: string
      output?: string
    }

export interface KernelMessage {
  id: string
  role: KernelMessageRole
  parts: KernelPart[]
  text: string
  createdAt?: string
  streaming?: boolean
}

export interface KernelEvent {
  id?: string
  type: string
  data?: unknown
}

export type ProviderKind = 'opencode-go'

export interface ProviderConfig {
  kind: ProviderKind
  /** Model id without the provider prefix, e.g. `deepseek-v4.1-flash`. */
  model: string
  hasApiKey: boolean
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  modelCount?: number
}
