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
