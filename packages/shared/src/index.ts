export const APP_NAME = 'ATeam'

export interface Project {
  id: string
  name: string
  path: string
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
}

export type KernelMessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'error'

export interface KernelMessage {
  id: string
  role: KernelMessageRole
  text: string
  createdAt?: string
  toolName?: string
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
