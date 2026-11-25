import fs from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { ChatMessage, SessionMeta } from '@ateam/shared'
import { readJsonFile } from '../../atomic-json'
import { isRecord, renameCorruptFile, type SessionFile } from './io-types'
import type {
  PreparedCompaction,
  RedoState,
  RevertState,
  SessionRecord,
  SessionStorage
} from './types'

const CHECKPOINT_EVENTS = 2_000

interface StoredSession {
  session: SessionMeta
  redo?: RedoState
  revert?: RevertState
  preparedCompaction?: PreparedCompaction
}

export class SqliteSessionStorage implements SessionStorage {
  private readonly file: string
  private readonly legacyRoot: string
  private database: DatabaseSync | null = null
  private readonly messageCache = new Map<string, string[]>()
  private readonly recordCache = new Map<string, string>()
  private readonly eventCounts = new Map<string, number>()

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
    this.eventCounts.delete(id)
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
    this.eventCounts.clear()
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

  private logEvent(
    database: DatabaseSync,
    sessionId: string,
    type: string,
    payload: string
  ): number {
    const result = database
      .prepare(
        'INSERT INTO session_events (session_id, type, payload, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(sessionId, type, payload, new Date().toISOString())
    return Number(result.lastInsertRowid)
  }

  private checkpointIfNeeded(
    database: DatabaseSync,
    sessionId: string,
    sessionData: string,
    messages: string[]
  ): void {
    const count = this.eventCounts.get(sessionId) ?? 0
    if (count < CHECKPOINT_EVENTS) return
    const seq = this.logEvent(
      database,
      sessionId,
      'session.checkpoint',
      JSON.stringify({ session: JSON.parse(sessionData), messages })
    )
    database
      .prepare('DELETE FROM session_events WHERE session_id = ? AND seq < ?')
      .run(sessionId, seq)
    this.eventCounts.set(sessionId, 1)
  }

  private insertRows(record: SessionRecord, logEvents = true): void {
    const database = this.requireDatabase()
    const { messages, ...stored } = record
    const data: StoredSession = {
      session: stored.session,
      redo: stored.redo,
      revert: stored.revert,
      preparedCompaction: stored.preparedCompaction
    }
    const sessionData = JSON.stringify(data)
    const previousSession = this.recordCache.get(record.session.id)
    let logged = 0
    if (logEvents) {
      if (previousSession === undefined) {
        this.logEvent(database, record.session.id, 'session.created', sessionData)
        logged += 1
      } else if (previousSession !== sessionData) {
        this.logEvent(database, record.session.id, 'session.updated', sessionData)
        logged += 1
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
        logged += 1
      }
      if (cached && cached.length > serialized.length) {
        this.logEvent(
          database,
          record.session.id,
          'message.deleted',
          JSON.stringify({ from: serialized.length })
        )
        logged += 1
      }
    }
    if (logEvents) {
      this.eventCounts.set(
        record.session.id,
        (this.eventCounts.get(record.session.id) ?? 0) + logged
      )
      this.checkpointIfNeeded(database, record.session.id, sessionData, serialized)
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
        } else if (row.type === 'session.checkpoint') {
          const value = JSON.parse(row.payload) as {
            session?: StoredSession
            messages?: unknown
          }
          if (value.session) {
            stored = value.session
            messages.clear()
            if (Array.isArray(value.messages)) {
              value.messages.forEach((data, index) => {
                if (typeof data === 'string') messages.set(index, data)
              })
            }
          }
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
    if (stored.session.id !== sessionId) return null
    if (typeof stored.session.updatedAt !== 'string') {
      stored.session.updatedAt = new Date().toISOString()
    }

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

    const data = JSON.stringify(stored)
    database.exec('BEGIN')
    try {
      database
        .prepare(
          'INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, ?) ' +
            'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
        )
        .run(sessionId, data, stored.session.updatedAt)
      database.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
      const insert = database.prepare(
        'INSERT INTO messages (session_id, position, data) VALUES (?, ?, ?)'
      )
      cached.forEach((entry, index) => insert.run(sessionId, index, entry))
      database.exec('COMMIT')
    } catch {
      database.exec('ROLLBACK')
      return null
    }
    this.recordCache.set(sessionId, data)
    this.messageCache.set(sessionId, cached)
    this.eventCounts.set(sessionId, rows.length)
    return {
      session: stored.session,
      messages: parsed,
      redo: stored.redo,
      revert: stored.revert,
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
            revert: stored.revert,
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
        this.eventCounts.set(record.session.id, 1 + messages.length)
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
          await renameCorruptFile(filePath)
          continue
        }
        this.insertRows({
          session: data.session,
          messages: data.messages,
          redo: data.redo,
          revert: data.revert,
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
        messages.length = 0
        cachedMessages.length = 0
        for (const messageRow of messageRows) {
          try {
            messages.push(JSON.parse(messageRow.data) as ChatMessage)
            cachedMessages.push(messageRow.data)
          } catch {
            database
              .prepare(
                'INSERT OR REPLACE INTO corrupt_messages (session_id, position, data, captured_at) VALUES (?, ?, ?, ?)'
              )
              .run(row.id, messageRow.position, messageRow.data, new Date().toISOString())
            database
              .prepare('DELETE FROM messages WHERE session_id = ? AND position = ?')
              .run(row.id, messageRow.position)
          }
        }
      }
      this.recordCache.set(row.id, row.data)
      this.messageCache.set(row.id, cachedMessages)
      records.push({
        session: stored.session,
        messages,
        redo: stored.redo,
        revert: stored.revert,
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
    for (const record of records) {
      const count = database
        .prepare('SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?')
        .get(record.session.id) as { count: number }
      this.eventCounts.set(record.session.id, count.count)
    }
    return records
  }
}
