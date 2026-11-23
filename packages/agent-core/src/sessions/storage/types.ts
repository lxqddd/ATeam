import type { ChatMessage, SessionMeta } from '@ateam/shared'

export interface RedoState {
  messages: ChatMessage[]
  snapshotAfter: string | null
  files: string[]
  prompt: string
}

export interface PreparedCompaction {
  summary: string
  throughMessageId: string
  createdAt: string
}

export interface SessionRecord {
  session: SessionMeta
  messages: ChatMessage[]
  redo?: RedoState
  preparedCompaction?: PreparedCompaction
}

export type SessionBackend = 'sqlite' | 'json' | 'auto'

export interface SessionStorage {
  init(): Promise<SessionRecord[]>
  persist(record: SessionRecord): Promise<void>
  remove(id: string): Promise<void>
  flush(): Promise<void>
  close(): Promise<void>
}
