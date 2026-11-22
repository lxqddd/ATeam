import fs from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionsStore } from './sessions-store'
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
