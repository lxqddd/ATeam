import fs from 'node:fs/promises'
import path from 'node:path'
import { JsonSessionStorage } from './json-storage'
import { SqliteSessionStorage } from './sqlite-storage'
import type { SessionRecord, SessionStorage } from './types'

export function sqliteUnavailable(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return (
    code === 'ERR_UNKNOWN_BUILTIN_MODULE' ||
    /node:sqlite|ERR_UNKNOWN_BUILTIN_MODULE|No such built-in module/i.test(message)
  )
}

export class AutoSessionStorage implements SessionStorage {
  private storage: SessionStorage
  private readonly json: JsonSessionStorage
  private readonly databaseFile: string

  constructor(userDataPath: string) {
    this.json = new JsonSessionStorage(path.join(userDataPath, 'agent', 'sessions'))
    this.databaseFile = path.join(userDataPath, 'agent', 'sessions.db')
    this.storage = new SqliteSessionStorage(userDataPath)
  }

  async init(): Promise<SessionRecord[]> {
    if (this.storage instanceof SqliteSessionStorage) {
      try {
        return await this.storage.init()
      } catch (error) {
        if (!sqliteUnavailable(error)) throw error
        const existing = await fs.stat(this.databaseFile).catch(() => null)
        if (existing) {
          throw new Error(
            'SESSION_STORAGE_UNAVAILABLE: node:sqlite is required to open the existing session database'
          )
        }
        console.error('[sessions] SQLite is unavailable; falling back to JSON storage')
        await this.storage.close().catch(() => undefined)
        this.storage = this.json
      }
    }
    return this.storage.init()
  }

  persist(record: SessionRecord): Promise<void> {
    return this.storage.persist(record)
  }

  remove(id: string): Promise<void> {
    return this.storage.remove(id)
  }

  flush(): Promise<void> {
    return this.storage.flush()
  }

  close(): Promise<void> {
    return this.storage.close()
  }
}
