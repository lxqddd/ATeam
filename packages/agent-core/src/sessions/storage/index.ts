import path from 'node:path'
import { AutoSessionStorage } from './auto-storage'
import { JsonSessionStorage } from './json-storage'
import { SqliteSessionStorage } from './sqlite-storage'
import type { SessionBackend, SessionStorage } from './types'

export { restoreLegacySessionBackups } from './legacy'
export type {
  PreparedCompaction,
  RedoState,
  SessionBackend,
  SessionRecord,
  SessionStorage
} from './types'

export function createSessionStorage(
  userDataPath: string,
  backend: SessionBackend = 'auto'
): SessionStorage {
  if (backend === 'json') {
    return new JsonSessionStorage(path.join(userDataPath, 'agent', 'sessions'))
  }
  if (backend === 'sqlite') return new SqliteSessionStorage(userDataPath)
  return new AutoSessionStorage(userDataPath)
}
