import fs from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
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
  if (!record.session || typeof record.session !== 'object' || !Array.isArray(record.messages)) {
    return false
  }
  const id = (record.session as { id?: unknown }).id
  return typeof id === 'string' && id.trim().length > 0
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
  private readonly messageCache = new Map<string, string[]>()
  private readonly recordCache = new Map<string, string>()

  constructor(userDataPath: string) {
    this.file = path.join(userDataPath, 'agent', 'sessions.db')
    this.legacyRoot = path.join(userDataPath, 'agent', 'sessions')
  }

  async init(): Promise<SessionRecord[]> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs.mkdir(this.legacyRoot, { recursive: true })
    const { DatabaseSync } = await import('node:sqlite')
    const handle = await fs.open(this.file, 'a', 0o600)
    await handle.close()
    await fs.chmod(this.file, 0o600).catch(() => undefined)

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
      CREATE TABLE IF NOT EXISTS corrupt_sessions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS corrupt_messages (
        session_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        data TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (session_id, position)
      );
      CREATE TABLE IF NOT EXISTS session_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS session_events_session
        ON session_events (session_id, seq);
    `)
    await this.restrictFiles()

    const migrated = database
      .prepare("SELECT value FROM meta WHERE key = 'legacy_imported'")
      .get() as { value: string } | undefined
    if (!migrated) await this.importLegacy(database)
    const records = this.loadAll(database)
    this.seedMissingEvents(database, records)
    return records
  }

  async persist(record: SessionRecord): Promise<void> {
    this.insert(record)
    await this.restrictFiles()
  }

  async remove(id: string): Promise<void> {
    const database = this.requireDatabase()
    this.messageCache.delete(id)
    this.recordCache.delete(id)
    database.exec('BEGIN')
    try {
      database.prepare('DELETE FROM sessions WHERE id = ?').run(id)
      database.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
      database.prepare('DELETE FROM session_events WHERE session_id = ?').run(id)
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
    this.messageCache.clear()
    this.recordCache.clear()
    this.database?.close()
    this.database = null
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) throw new Error('SESSION_STORAGE_NOT_READY')
    return this.database
  }

  private async restrictFiles(): Promise<void> {
    for (const suffix of ['', '-wal', '-shm']) {
      await fs.chmod(`${this.file}${suffix}`, 0o600).catch(() => undefined)
    }
  }

  private insert(record: SessionRecord): void {
    const database = this.requireDatabase()
    database.exec('BEGIN')
    try {
      this.insertRows(record)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  private logEvent(database: DatabaseSync, sessionId: string, type: string, payload: string): void {
    database
      .prepare(
        'INSERT INTO session_events (session_id, type, payload, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(sessionId, type, payload, new Date().toISOString())
  }

  private insertRows(record: SessionRecord, logEvents = true): void {
    const database = this.requireDatabase()
    const { messages, ...stored } = record
    const data: StoredSession = {
      session: stored.session,
      redo: stored.redo,
      preparedCompaction: stored.preparedCompaction
    }
    const sessionData = JSON.stringify(data)
    const previousSession = this.recordCache.get(record.session.id)
    if (logEvents) {
      if (previousSession === undefined) {
        this.logEvent(database, record.session.id, 'session.created', sessionData)
      } else if (previousSession !== sessionData) {
        this.logEvent(database, record.session.id, 'session.updated', sessionData)
      }
    }
    database
      .prepare(
        'INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
      )
      .run(record.session.id, sessionData, record.session.updatedAt)
    this.recordCache.set(record.session.id, sessionData)

    const serialized = messages.map((message) => JSON.stringify(message))
    const cached = this.messageCache.get(record.session.id)
    const upsert = database.prepare(
      'INSERT INTO messages (session_id, position, data) VALUES (?, ?, ?) ' +
        'ON CONFLICT(session_id, position) DO UPDATE SET data = excluded.data'
    )
    const changed: number[] = []
    if (!cached) {
      for (const [index, message] of serialized.entries()) {
        upsert.run(record.session.id, index, message)
        changed.push(index)
      }
    } else {
      for (const [index, message] of serialized.entries()) {
        if (cached[index] !== message) {
          upsert.run(record.session.id, index, message)
          changed.push(index)
        }
      }
      if (cached.length > serialized.length) {
        database
          .prepare('DELETE FROM messages WHERE session_id = ? AND position >= ?')
          .run(record.session.id, serialized.length)
      }
    }
    if (logEvents) {
      for (const index of changed) {
        this.logEvent(
          database,
          record.session.id,
          'message.upsert',
          JSON.stringify({ position: index, data: serialized[index] })
        )
      }
      if (cached && cached.length > serialized.length) {
        this.logEvent(
          database,
          record.session.id,
          'message.deleted',
          JSON.stringify({ from: serialized.length })
        )
      }
    }
    this.messageCache.set(record.session.id, serialized)
  }

  private rebuildFromEvents(database: DatabaseSync, sessionId: string): SessionRecord | null {
    const rows = database
      .prepare('SELECT type, payload FROM session_events WHERE session_id = ? ORDER BY seq ASC')
      .all(sessionId) as { type: string; payload: string }[]
    let stored: StoredSession | null = null
    const messages = new Map<number, string>()
    for (const row of rows) {
      try {
        if (row.type === 'session.created' || row.type === 'session.updated') {
          stored = JSON.parse(row.payload) as StoredSession
        } else if (row.type === 'message.upsert') {
          const value = JSON.parse(row.payload) as { position: number; data: string }
          messages.set(value.position, value.data)
        } else if (row.type === 'message.deleted') {
          const value = JSON.parse(row.payload) as { from: number }
          for (const position of [...messages.keys()]) {
            if (position >= value.from) messages.delete(position)
          }
        }
      } catch {
        /* skip corrupt events */
      }
    }
    if (!stored?.session || typeof stored.session !== 'object') return null

    const parsed: ChatMessage[] = []
    const cached: string[] = []
    for (const position of [...messages.keys()].sort((a, b) => a - b)) {
      const data = messages.get(position) as string
      try {
        parsed.push(JSON.parse(data) as ChatMessage)
        cached.push(data)
      } catch {
        /* skip corrupt message event */
      }
    }

    database
      .prepare(
        'INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
      )
      .run(sessionId, JSON.stringify(stored), stored.session.updatedAt)
    database.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
    const insert = database.prepare(
      'INSERT INTO messages (session_id, position, data) VALUES (?, ?, ?)'
    )
    cached.forEach((data, index) => insert.run(sessionId, index, data))
    this.recordCache.set(sessionId, JSON.stringify(stored))
    this.messageCache.set(sessionId, cached)
    return {
      session: stored.session,
      messages: parsed,
      redo: stored.redo,
      preparedCompaction: stored.preparedCompaction
    }
  }

  private seedMissingEvents(database: DatabaseSync, records: SessionRecord[]): void {
    const evented = new Set(
      (
        database.prepare('SELECT DISTINCT session_id FROM session_events').all() as {
          session_id: string
        }[]
      ).map((row) => row.session_id)
    )
    database.exec('BEGIN')
    try {
      for (const record of records) {
        if (evented.has(record.session.id)) continue
        const { messages, ...stored } = record
        this.logEvent(
          database,
          record.session.id,
          'session.created',
          JSON.stringify({
            session: stored.session,
            redo: stored.redo,
            preparedCompaction: stored.preparedCompaction
          })
        )
        messages.forEach((message, position) => {
          this.logEvent(
            database,
            record.session.id,
            'message.upsert',
            JSON.stringify({ position, data: JSON.stringify(message) })
          )
        })
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  private async importLegacy(database: DatabaseSync): Promise<void> {
    let files: string[] = []
    try {
      files = (await fs.readdir(this.legacyRoot)).filter(
        (file) => file.endsWith('.json') && file !== 'index.json'
      )
    } catch {
      return
    }
    if (files.length === 0) return

    const imported: string[] = []
    database.exec('BEGIN')
    try {
      for (const file of files) {
        const filePath = path.join(this.legacyRoot, file)
        const data = await readJsonFile<SessionFile>(filePath)
        if (!data || !isRecord(data)) {
          await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => undefined)
          continue
        }
        this.insertRows({
          session: data.session,
          messages: data.messages,
          redo: data.redo,
          preparedCompaction: data.preparedCompaction
        })
        imported.push(filePath)
      }
      database
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_imported', ?)")
        .run(new Date().toISOString())
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }

    for (const filePath of imported) {
      await fs.rename(filePath, `${filePath}.migrated`).catch(() => undefined)
    }
  }

  private quarantineSession(database: DatabaseSync, id: string, data: string): void {
    this.messageCache.delete(id)
    this.recordCache.delete(id)
    database
      .prepare('INSERT OR REPLACE INTO corrupt_sessions (id, data, captured_at) VALUES (?, ?, ?)')
      .run(id, data, new Date().toISOString())
    database.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    database.prepare('DELETE FROM sessions WHERE id = ?').run(id)
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
        const rebuilt = this.rebuildFromEvents(database, row.id)
        if (rebuilt) records.push(rebuilt)
        else this.quarantineSession(database, row.id, row.data)
        continue
      }
      if (!stored?.session || typeof stored.session !== 'object') {
        const rebuilt = this.rebuildFromEvents(database, row.id)
        if (rebuilt) records.push(rebuilt)
        else this.quarantineSession(database, row.id, row.data)
        continue
      }
      const messageRows = database
        .prepare('SELECT position, data FROM messages WHERE session_id = ? ORDER BY position ASC')
        .all(row.id) as { position: number; data: string }[]
      const messages: ChatMessage[] = []
      const cachedMessages: string[] = []
      let corrupt = false
      for (const messageRow of messageRows) {
        try {
          messages.push(JSON.parse(messageRow.data) as ChatMessage)
          cachedMessages.push(messageRow.data)
        } catch {
          corrupt = true
          break
        }
      }
      if (corrupt) {
        const rebuilt = this.rebuildFromEvents(database, row.id)
        if (rebuilt) {
          records.push(rebuilt)
          continue
        }
        database.prepare('DELETE FROM messages WHERE session_id = ?').run(row.id)
        messages.length = 0
        cachedMessages.length = 0
      }
      this.recordCache.set(row.id, row.data)
      this.messageCache.set(row.id, cachedMessages)
      records.push({
        session: stored.session,
        messages,
        redo: stored.redo,
        preparedCompaction: stored.preparedCompaction
      })
    }

    const missing = database
      .prepare(
        'SELECT DISTINCT session_id FROM session_events ' +
          'WHERE session_id NOT IN (SELECT id FROM sessions)'
      )
      .all() as { session_id: string }[]
    for (const entry of missing) {
      const rebuilt = this.rebuildFromEvents(database, entry.session_id)
      if (rebuilt) records.push(rebuilt)
    }
    return records
  }
}

function sqliteUnavailable(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code
  const message = error instanceof Error ? error.message : String(error)
  return (
    code === 'ERR_UNKNOWN_BUILTIN_MODULE' ||
    /node:sqlite|ERR_UNKNOWN_BUILTIN_MODULE|No such built-in module/i.test(message)
  )
}

class AutoSessionStorage implements SessionStorage {
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

export async function restoreLegacySessionBackups(userDataPath: string): Promise<number> {
  const sessionsDirectory = path.join(userDataPath, 'agent', 'sessions')
  let restored = 0
  let files: string[] = []
  try {
    files = await fs.readdir(sessionsDirectory)
  } catch {
    return 0
  }
  for (const file of files) {
    if (!file.endsWith('.json.migrated')) continue
    const source = path.join(sessionsDirectory, file)
    const target = path.join(sessionsDirectory, file.slice(0, -'.migrated'.length))
    const existing = await fs.stat(target).catch(() => null)
    if (existing) continue
    await fs.rename(source, target).catch(() => undefined)
    restored += 1
  }

  const databaseFile = path.join(userDataPath, 'agent', 'sessions.db')
  const existingDatabase = await fs.stat(databaseFile).catch(() => null)
  if (existingDatabase) {
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(databaseFile)
    try {
      database.prepare("DELETE FROM meta WHERE key = 'legacy_imported'").run()
    } finally {
      database.close()
    }
  }
  return restored
}
