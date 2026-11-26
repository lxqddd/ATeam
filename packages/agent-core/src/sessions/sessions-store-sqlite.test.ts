import fs from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionsStore } from './sessions-store'
import { restoreLegacySessionBackups } from './storage'
import { makeMessage, makeSession, makeTextPart } from '../test/factories'

let directory: string
let sessionsDirectory: string
let store: SessionsStore

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-sqlite-')))
  sessionsDirectory = path.join(directory, 'agent', 'sessions')
  store = new SessionsStore(directory)
  await store.init()
})

afterEach(async () => {
  await store.close()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('SQLite session storage', () => {
  it('creates a database and reloads sessions across instances', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('persisted in sqlite')] })
    )

    await expect(fs.stat(path.join(directory, 'agent', 'sessions.db'))).resolves.toBeDefined()

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getSession(session.id)?.title).toBe('persisted in sqlite')
    expect(reloaded.getMessages(session.id)).toHaveLength(1)
    await reloaded.close()
  })

  it('imports legacy JSON sessions once', async () => {
    await store.close()
    for (const suffix of ['', '-wal', '-shm']) {
      await fs.rm(path.join(directory, 'agent', `sessions.db${suffix}`), { force: true })
    }
    await fs.mkdir(sessionsDirectory, { recursive: true })
    const legacy = makeSession({ id: 'legacy-1', title: 'Old session' })
    await fs.writeFile(
      path.join(sessionsDirectory, 'legacy-1.json'),
      JSON.stringify({ version: 1, session: legacy, messages: [] })
    )

    const importing = new SessionsStore(directory)
    await importing.init()
    expect(importing.list().map((entry) => entry.id)).toEqual(['legacy-1'])
    await importing.close()

    await fs.rm(path.join(sessionsDirectory, 'legacy-1.json'), { force: true })
    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getSession('legacy-1')?.title).toBe('Old session')
    await reloaded.close()
  })

  it('skips invalid legacy records without blocking valid ones', async () => {
    await store.close()
    for (const suffix of ['', '-wal', '-shm']) {
      await fs.rm(path.join(directory, 'agent', `sessions.db${suffix}`), { force: true })
    }
    await fs.mkdir(sessionsDirectory, { recursive: true })
    await fs.writeFile(
      path.join(sessionsDirectory, 'broken.json'),
      JSON.stringify({ version: 1, session: {}, messages: [] })
    )
    const valid = makeSession({ id: 'valid-1', title: 'Valid' })
    await fs.writeFile(
      path.join(sessionsDirectory, 'valid-1.json'),
      JSON.stringify({ version: 1, session: valid, messages: [] })
    )

    const importing = new SessionsStore(directory)
    await importing.init()
    expect(importing.list().map((entry) => entry.id)).toEqual(['valid-1'])
    await importing.close()
    const files = await fs.readdir(sessionsDirectory)
    expect(files.some((file) => file.startsWith('broken.json.corrupt-'))).toBe(true)
  })

  it('retries an empty migration after legacy files appear', async () => {
    await store.close()
    for (const suffix of ['', '-wal', '-shm']) {
      await fs.rm(path.join(directory, 'agent', `sessions.db${suffix}`), { force: true })
    }
    const empty = new SessionsStore(directory)
    await empty.init()
    await empty.close()

    const legacy = makeSession({ id: 'late-1', title: 'Late import' })
    await fs.writeFile(
      path.join(sessionsDirectory, 'late-1.json'),
      JSON.stringify({ version: 1, session: legacy, messages: [] })
    )
    const importing = new SessionsStore(directory)
    await importing.init()
    expect(importing.getSession('late-1')?.title).toBe('Late import')
    await importing.close()
  })

  it('rebuilds corrupt sessions from the event journal', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('journal message')] })
    )
    await store.close()
    const databaseFile = path.join(directory, 'agent', 'sessions.db')
    const database = new DatabaseSync(databaseFile)
    database.prepare('UPDATE sessions SET data = ? WHERE id = ?').run('{bad', session.id)
    database.close()

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getSession(session.id)?.title).toBe('journal message')
    expect(reloaded.getMessages(session.id)).toHaveLength(1)
    await reloaded.close()

    const check = new DatabaseSync(databaseFile)
    const corrupt = check.prepare('SELECT COUNT(*) AS count FROM corrupt_sessions').get() as {
      count: number
    }
    expect(corrupt.count).toBe(0)
    const events = check.prepare('SELECT COUNT(*) AS count FROM session_events').get() as {
      count: number
    }
    expect(events.count).toBeGreaterThan(0)
    check.close()
  })

  it('rebuilds a deleted session row from events', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('kept by journal')] })
    )
    await store.close()
    const databaseFile = path.join(directory, 'agent', 'sessions.db')
    const database = new DatabaseSync(databaseFile)
    database.prepare('DELETE FROM sessions WHERE id = ?').run(session.id)
    database.close()

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getSession(session.id)?.title).toBe('kept by journal')
    expect(reloaded.getMessages(session.id)).toHaveLength(1)
    await reloaded.close()
  })

  it('rebuilds corrupt message rows from the event journal', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('recover me')] })
    )
    await store.close()
    const databaseFile = path.join(directory, 'agent', 'sessions.db')
    const database = new DatabaseSync(databaseFile)
    database
      .prepare('UPDATE messages SET data = ? WHERE session_id = ? AND position = 0')
      .run('{bad', session.id)
    database.close()

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getMessages(session.id)?.[0]?.parts).toEqual([
      { type: 'text', text: 'recover me' }
    ])
    await reloaded.close()
  })

  it('keeps valid messages when one row is corrupt and no events exist', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'm1', role: 'user', parts: [makeTextPart('first')] })
    )
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'm2', role: 'assistant', parts: [makeTextPart('second')] })
    )
    await store.close()
    const databaseFile = path.join(directory, 'agent', 'sessions.db')
    const database = new DatabaseSync(databaseFile)
    database.prepare('DELETE FROM session_events').run()
    database
      .prepare('UPDATE messages SET data = ? WHERE session_id = ? AND position = 0')
      .run('{bad', session.id)
    database.close()

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getMessages(session.id)).toHaveLength(1)
    expect(reloaded.getMessages(session.id)?.[0]?.parts).toEqual([{ type: 'text', text: 'second' }])
    await reloaded.close()

    const check = new DatabaseSync(databaseFile)
    const corrupt = check.prepare('SELECT COUNT(*) AS count FROM corrupt_messages').get() as {
      count: number
    }
    expect(corrupt.count).toBe(1)
    check.close()
  })

  it('rebuilds from a session checkpoint event', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'm1', role: 'user', parts: [makeTextPart('checkpointed')] })
    )
    await store.close()
    const databaseFile = path.join(directory, 'agent', 'sessions.db')
    const database = new DatabaseSync(databaseFile)
    const sessionRow = database
      .prepare('SELECT data FROM sessions WHERE id = ?')
      .get(session.id) as { data: string }
    const messageRows = database
      .prepare('SELECT data FROM messages WHERE session_id = ? ORDER BY position')
      .all(session.id) as { data: string }[]
    database.prepare('DELETE FROM session_events WHERE session_id = ?').run(session.id)
    database
      .prepare(
        'INSERT INTO session_events (session_id, type, payload, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(
        session.id,
        'session.checkpoint',
        JSON.stringify({
          session: JSON.parse(sessionRow.data),
          messages: messageRows.map((row) => row.data)
        }),
        new Date().toISOString()
      )
    database.prepare('UPDATE sessions SET data = ? WHERE id = ?').run('{bad', session.id)
    database.close()

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getMessages(session.id)?.[0]?.parts).toEqual([
      { type: 'text', text: 'checkpointed' }
    ])
    await reloaded.close()
  })

  it('quarantines corrupt database rows', async () => {
    const session = await store.create()
    await store.close()
    const databaseFile = path.join(directory, 'agent', 'sessions.db')
    const database = new DatabaseSync(databaseFile)
    database
      .prepare('INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, ?)')
      .run('bad-row', '{not json', new Date().toISOString())
    database
      .prepare('INSERT INTO messages (session_id, position, data) VALUES (?, ?, ?)')
      .run('bad-row', 0, '{not json')
    database
      .prepare(
        'INSERT INTO corrupt_messages (session_id, position, data, captured_at) VALUES (?, ?, ?, ?)'
      )
      .run('bad-row', 0, '{not json', new Date().toISOString())
    database.close()

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.list().map((entry) => entry.id)).toEqual([session.id])
    await reloaded.close()

    const check = new DatabaseSync(databaseFile)
    const corrupt = check.prepare('SELECT COUNT(*) AS count FROM corrupt_sessions').get() as {
      count: number
    }
    expect(corrupt.count).toBe(1)
    check.close()
  })

  it('persists redo state and prepared compaction', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('undo me')] })
    )
    await store.appendMessage(session.id, makeMessage({ role: 'assistant', parts: [] }))
    await store.stageUndo(session.id, 0, null, 'undo me', [])
    await store.setPreparedCompaction(session.id, {
      summary: 'summary',
      throughMessageId: 'message-1',
      createdAt: new Date().toISOString()
    })

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getRedo(session.id)?.prompt).toBe('undo me')
    expect(reloaded.getPreparedCompaction(session.id)?.summary).toBe('summary')
    await reloaded.close()
  })

  it('persists revert state and part redo targets', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'u1', role: 'user', parts: [makeTextPart('hello')] })
    )
    const original = makeMessage({
      id: 'a1',
      role: 'assistant',
      parts: [makeTextPart('one'), makeTextPart('two')]
    })
    await store.appendMessage(session.id, original)
    await store.setRevert(session.id, { snapshot: 'pre-revert', messageId: 'a1', files: ['a.txt'] })
    const record = store.get(session.id)
    if (!record) throw new Error('record missing')
    record.messages[1] = { ...original, parts: original.parts.slice(0, 1) }
    await store.stageStepUndo(session.id, 1, original, 'snapshot-after', ['a.txt'])

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getMessages(session.id)?.[1].parts).toHaveLength(1)
    expect(reloaded.getRedo(session.id)).toMatchObject({
      snapshotAfter: 'snapshot-after',
      files: ['a.txt'],
      target: { index: 1 }
    })
    expect(reloaded.getRevert(session.id)).toBeUndefined()

    const redone = await reloaded.redo(session.id)
    expect(redone?.redoAvailable).toBe(false)
    expect(reloaded.getMessages(session.id)?.[1].parts).toHaveLength(2)
    await reloaded.close()
  })

  it('moves migrated legacy files aside', async () => {
    await store.close()
    for (const suffix of ['', '-wal', '-shm']) {
      await fs.rm(path.join(directory, 'agent', `sessions.db${suffix}`), { force: true })
    }
    const legacy = makeSession({ id: 'moved-1', title: 'Moved' })
    await fs.writeFile(
      path.join(sessionsDirectory, 'moved-1.json'),
      JSON.stringify({ version: 1, session: legacy, messages: [] })
    )
    const importing = new SessionsStore(directory)
    await importing.init()
    await importing.close()
    await expect(fs.stat(path.join(sessionsDirectory, 'moved-1.json'))).rejects.toThrow()
    await expect(
      fs.stat(path.join(sessionsDirectory, 'moved-1.json.migrated'))
    ).resolves.toBeDefined()
  })

  it('restores migrated backups on request', async () => {
    await store.close()
    for (const suffix of ['', '-wal', '-shm']) {
      await fs.rm(path.join(directory, 'agent', `sessions.db${suffix}`), { force: true })
    }
    const legacy = makeSession({ id: 'restore-1', title: 'Restored' })
    await fs.writeFile(
      path.join(sessionsDirectory, 'restore-1.json'),
      JSON.stringify({ version: 1, session: legacy, messages: [] })
    )
    const importing = new SessionsStore(directory)
    await importing.init()
    await importing.close()
    await expect(
      fs.stat(path.join(sessionsDirectory, 'restore-1.json.migrated'))
    ).resolves.toBeDefined()

    await expect(restoreLegacySessionBackups(directory)).resolves.toBe(1)
    await expect(fs.stat(path.join(sessionsDirectory, 'restore-1.json'))).resolves.toBeDefined()

    const restored = new SessionsStore(directory)
    await restored.init()
    expect(restored.getSession('restore-1')?.title).toBe('Restored')
    await restored.close()
  })

  it('deletes sessions and their messages', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('bye')] })
    )
    expect(await store.delete(session.id)).toBe(true)

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.list()).toEqual([])
    expect(reloaded.getMessages(session.id)).toBeUndefined()
    await reloaded.close()
  })

  it('repairs running sessions when loading from the database', async () => {
    const session = await store.create()
    await store.setStatus(session.id, 'waiting-permission')

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getSession(session.id)?.status).toBe('idle')
    await reloaded.close()
  })

  it('persists settings, todos and directories', async () => {
    const session = await store.create()
    await store.setSettings(session.id, { permissionMode: 'auto', reasoningEffort: 'high' })
    await store.setTodos(session.id, [
      { id: 't1', content: 'Ship it', status: 'pending', priority: 'high' }
    ])
    await store.setDirectory(session.id, '/tmp/worktree')

    const reloaded = new SessionsStore(directory)
    await reloaded.init()
    expect(reloaded.getSession(session.id)).toMatchObject({
      permissionMode: 'auto',
      reasoningEffort: 'high',
      directory: '/tmp/worktree',
      todos: [{ content: 'Ship it', status: 'pending', priority: 'high' }]
    })
    await reloaded.close()
  })

  it('writes only changed message rows', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('one')] })
    )
    await store.close()

    const databaseFile = path.join(directory, 'agent', 'sessions.db')
    const database = new DatabaseSync(databaseFile)
    database.exec(`
      CREATE TABLE message_writes (count INTEGER NOT NULL);
      INSERT INTO message_writes (count) VALUES (0);
      CREATE TRIGGER count_message_writes AFTER INSERT ON messages
      BEGIN UPDATE message_writes SET count = count + 1; END;
      CREATE TRIGGER count_message_updates AFTER UPDATE ON messages
      BEGIN UPDATE message_writes SET count = count + 1; END;
      CREATE TRIGGER count_message_deletes AFTER DELETE ON messages
      BEGIN UPDATE message_writes SET count = count + 1; END;
    `)
    database.close()

    const reopened = new SessionsStore(directory)
    await reopened.init()
    const count = async (): Promise<number> => {
      const check = new DatabaseSync(databaseFile)
      const row = check.prepare('SELECT count FROM message_writes').get() as { count: number }
      check.close()
      return row.count
    }

    const baseline = await count()
    await reopened.persist(session.id)
    expect(await count()).toBe(baseline)

    const record = reopened.get(session.id)
    if (!record?.messages[0] || record.messages[0].parts[0]?.type !== 'text') {
      throw new Error('unexpected record')
    }
    record.messages[0].parts[0].text = 'changed'
    await reopened.persist(session.id)
    expect(await count()).toBe(baseline + 1)

    await reopened.appendMessage(
      session.id,
      makeMessage({ role: 'assistant', parts: [makeTextPart('two')] })
    )
    expect(await count()).toBe(baseline + 2)
    await reopened.close()
  })

  it('uses the JSON backend when requested', async () => {
    await store.close()
    for (const suffix of ['', '-wal', '-shm']) {
      await fs.rm(path.join(directory, 'agent', `sessions.db${suffix}`), { force: true })
    }
    store = new SessionsStore(directory, { backend: 'json' })
    await store.init()
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('json session')] })
    )

    await expect(fs.stat(path.join(sessionsDirectory, `${session.id}.json`))).resolves.toBeDefined()
    await expect(fs.stat(path.join(directory, 'agent', 'sessions.db'))).rejects.toThrow()
  })
})
