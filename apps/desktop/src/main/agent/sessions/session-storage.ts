import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ChatMessage, SessionMeta } from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '../atomic-json'

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

interface SessionIndex {
  version: 1
  sessions: SessionMeta[]
}

interface SessionFile {
  version: 1
  session: SessionMeta
  messages: ChatMessage[]
  redo?: RedoState
  preparedCompaction?: PreparedCompaction
}

interface StoredSession {
  session: SessionMeta
  redo?: RedoState
  preparedCompaction?: PreparedCompaction
}

function isRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as { session?: unknown; messages?: unknown }
  return (
    Boolean(record.session) && typeof record.session === 'object' && Array.isArray(record.messages)
  )
}

class JsonSessionStorage implements SessionStorage {
  private readonly root: string
  private readonly indexFile: string
  private readonly metas = new Map<string, SessionMeta>()
  private readonly writeQueues = new Map<string, Promise<void>>()
  private indexQueue: Promise<void> | null = null

  constructor(root: string) {
    this.root = root
    this.indexFile = path.join(root, 'index.json')
  }

  async init(): Promise<SessionRecord[]> {
    await fs.mkdir(this.root, { recursive: true })
    await fs.rm(`${this.indexFile}.tmp`, { force: true }).catch(() => undefined)
    const index = await readJsonFile<SessionIndex>(this.indexFile)
    const entries = index?.sessions ?? (await this.scanSessions())
    const records: SessionRecord[] = []
    for (const entry of entries) {
      const record = await this.loadRecord(entry.id)
      if (record) records.push(record)
    }
    for (const record of records) this.metas.set(record.session.id, record.session)
    await this.writeIndex()
    return records
  }

  persist(record: SessionRecord): Promise<void> {
    const id = record.session.id
    const previous = this.writeQueues.get(id) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const data: SessionFile = {
          version: 1,
          session: record.session,
          messages: record.messages,
          redo: record.redo,
          preparedCompaction: record.preparedCompaction
        }
        await writeJsonAtomic(path.join(this.root, `${id}.json`), data)
        this.metas.set(id, record.session)
        await this.writeIndex()
      })
    this.writeQueues.set(id, next)
    return next
  }

  async remove(id: string): Promise<void> {
    await this.flush()
    this.metas.delete(id)
    await this.writeIndex()
    await fs.rm(path.join(this.root, `${id}.json`), { force: true }).catch(() => undefined)
  }

  async flush(): Promise<void> {
    await Promise.all([...this.writeQueues.values(), this.indexQueue ?? Promise.resolve()])
  }

  async close(): Promise<void> {
    await this.flush()
  }

  private async scanSessions(): Promise<SessionMeta[]> {
    const sessions: SessionMeta[] = []
    let files: string[] = []
    try {
      files = await fs.readdir(this.root)
    } catch {
      return sessions
    }
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'index.json') continue
      const record = await this.loadRecord(file.slice(0, -5))
      if (record) sessions.push(record.session)
    }
    return sessions
  }

  private async loadRecord(id: string): Promise<SessionRecord | null> {
    const filePath = path.join(this.root, `${id}.json`)
    const data = await readJsonFile<SessionFile>(filePath)
    if (!data || !isRecord(data)) {
      try {
        await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
      return null
    }
    return {
      session: data.session,
      messages: data.messages,
      redo: data.redo,
      preparedCompaction: data.preparedCompaction
    }
  }

  private async writeIndex(): Promise<void> {
    const previous = this.indexQueue ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const data: SessionIndex = {
          version: 1,
          sessions: [...this.metas.values()]
        }
        await writeJsonAtomic(this.indexFile, data)
      })
    this.indexQueue = next
    await next
  }
}

class SqliteSessionStorage implements SessionStorage {
  private readonly file: string
  private readonly legacyRoot: string
  private database: DatabaseSync | null = null

  constructor(userDataPath: string) {
    this.file = path.join(userDataPath, 'agent', 'sessions.db')
    this.legacyRoot = path.join(userDataPath, 'agent', 'sessions')
  }

  async init(): Promise<SessionRecord[]> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs.mkdir(this.legacyRoot, { recursive: true })
    const database = new DatabaseSync(this.file)
    this.database = database
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (session_id, position)
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

    const migrated = database
      .prepare("SELECT value FROM meta WHERE key = 'legacy_imported'")
      .get() as { value: string } | undefined
    if (!migrated) await this.importLegacy(database)
    return this.loadAll(database)
  }

  async persist(record: SessionRecord): Promise<void> {
    this.insert(record)
  }

  async remove(id: string): Promise<void> {
    const database = this.requireDatabase()
    database.exec('BEGIN')
    try {
      database.prepare('DELETE FROM sessions WHERE id = ?').run(id)
      database.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  async flush(): Promise<void> {
    /* writes are synchronous */
  }

  async close(): Promise<void> {
    this.database?.close()
    this.database = null
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error('SESSION_STORAGE_NOT_READY')
    return this.database
  }

  private insert(record: SessionRecord): void {
    const database = this.requireDatabase()
    const { messages, ...stored } = record
    const data: StoredSession = {
      session: stored.session,
      redo: stored.redo,
      preparedCompaction: stored.preparedCompaction
    }
    database.exec('BEGIN')
    try {
      database
        .prepare(
          'INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, ?) ' +
            'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
        )
        .run(record.session.id, JSON.stringify(data), record.session.updatedAt)
      database.prepare('DELETE FROM messages WHERE session_id = ?').run(record.session.id)
      const statement = database.prepare(
        'INSERT INTO messages (session_id, position, data) VALUES (?, ?, ?)'
      )
      messages.forEach((message, index) => {
        statement.run(record.session.id, index, JSON.stringify(message))
      })
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  private async importLegacy(database: DatabaseSync): Promise<void> {
    let files: string[] = []
    try {
      files = await fs.readdir(this.legacyRoot)
    } catch {
      files = []
    }
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'index.json') continue
      const filePath = path.join(this.legacyRoot, file)
      const data = await readJsonFile<SessionFile>(filePath)
      if (!data || !isRecord(data)) {
        await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => undefined)
        continue
      }
      this.insert({
        session: data.session,
        messages: data.messages,
        redo: data.redo,
        preparedCompaction: data.preparedCompaction
      })
    }
    database
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_imported', ?)")
      .run(new Date().toISOString())
  }

  private loadAll(database: DatabaseSync): SessionRecord[] {
    const rows = database
      .prepare('SELECT id, data FROM sessions ORDER BY updated_at DESC')
      .all() as {
      id: string
      data: string
    }[]
    const records: SessionRecord[] = []
    for (const row of rows) {
      let stored: StoredSession
      try {
        stored = JSON.parse(row.data) as StoredSession
      } catch {
        database.prepare('DELETE FROM sessions WHERE id = ?').run(row.id)
        database.prepare('DELETE FROM messages WHERE session_id = ?').run(row.id)
        continue
      }
      if (!stored?.session || typeof stored.session !== 'object') {
        database.prepare('DELETE FROM sessions WHERE id = ?').run(row.id)
        continue
      }
      const messageRows = database
        .prepare('SELECT data FROM messages WHERE session_id = ? ORDER BY position ASC')
        .all(row.id) as { data: string }[]
      const messages: ChatMessage[] = []
      for (const messageRow of messageRows) {
        try {
          messages.push(JSON.parse(messageRow.data) as ChatMessage)
        } catch {
          /* skip corrupt messages */
        }
      }
      records.push({
        session: stored.session,
        messages,
        redo: stored.redo,
        preparedCompaction: stored.preparedCompaction
      })
    }
    return records
  }
}

export function createSessionStorage(
  userDataPath: string,
  backend: SessionBackend = 'auto'
): SessionStorage {
  if (backend === 'json') {
    return new JsonSessionStorage(path.join(userDataPath, 'agent', 'sessions'))
  }
  return new SqliteSessionStorage(userDataPath)
}
