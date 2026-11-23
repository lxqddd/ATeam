import fs from 'node:fs/promises'
import type { ChatMessage, SessionMeta } from '@ateam/shared'
import type { PreparedCompaction, RedoState, SessionRecord } from './types'

export interface SessionIndex {
  version: 1
  sessions: SessionMeta[]
}

export interface SessionFile {
  version: 1
  session: SessionMeta
  messages: ChatMessage[]
  redo?: RedoState
  preparedCompaction?: PreparedCompaction
}

export function isRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as { session?: unknown; messages?: unknown }
  if (!record.session || typeof record.session !== 'object' || !Array.isArray(record.messages)) {
    return false
  }
  const id = (record.session as { id?: unknown }).id
  return typeof id === 'string' && id.trim().length > 0
}

export async function renameCorruptFile(filePath: string): Promise<void> {
  await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => undefined)
}
