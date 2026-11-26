import type { ChatMessage, SessionMeta } from '@ateam/shared'

export interface RedoState {
  messages: ChatMessage[]
  snapshotAfter: string | null
  files: string[]
  prompt: string
  /** Original assistant message replaced by a step-level rewind. */
  target?: {
    index: number
    message: ChatMessage
  }
}

/** Files restored by a file-level revert, so the revert itself can be undone. */
export interface RevertState {
  /** Workspace snapshot taken before the first file was reverted. */
  snapshot: string
  /** Latest assistant turn the restored files belong to. */
  messageId: string
  /** Snapshot keys currently restored to their pre-turn content. */
  files: string[]
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
  revert?: RevertState
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
