import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionsStore, makeTitle } from './sessions-store'
import { makeMessage, makeTextPart, makeToolPart } from './test/factories'

let directory: string
let sessionsDirectory: string
let store: SessionsStore

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-test-')))
  sessionsDirectory = path.join(directory, 'agent', 'sessions')
  store = new SessionsStore(directory)
  await store.init()
})

afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('makeTitle', () => {
  it('collapses whitespace and trims', () => {
    expect(makeTitle('  hello \n\t world  ')).toBe('hello world')
  })

  it('caps titles at 60 characters', () => {
    expect(makeTitle('a'.repeat(80))).toHaveLength(60)
  })
})

describe('SessionsStore', () => {
  it('starts empty', () => {
    expect(store.list()).toEqual([])
  })

  it('creates an idle session with an empty title', async () => {
    const session = await store.create()

    expect(session).toMatchObject({ title: '', model: null, status: 'idle' })
    await expect(fs.stat(path.join(sessionsDirectory, `${session.id}.json`))).resolves.toBeDefined()
  })

  it('derives the title from the first user message', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('  hello   world  ')] })
    )

    expect(store.getSession(session.id)?.title).toBe('hello world')
  })

  it('does not overwrite the title with later messages', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('first')] })
    )
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('second')] })
    )

    expect(store.getSession(session.id)?.title).toBe('first')
  })

  it('lists sessions by most recent update', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const older = await store.create()
    vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'))
    const newer = await store.create()

    expect(store.list().map((session) => session.id)).toEqual([newer.id, older.id])
  })

  it('renames sessions with trimming and a length cap', async () => {
    const session = await store.create()

    expect((await store.rename(session.id, '  renamed  '))?.title).toBe('renamed')
    expect((await store.rename(session.id, 'x'.repeat(200)))?.title).toHaveLength(120)
  })

  it('updates model and status', async () => {
    const session = await store.create()
    const model = { providerId: 'provider-1', modelId: 'model-1' }

    expect((await store.setModel(session.id, model))?.model).toEqual(model)
    await store.setStatus(session.id, 'error')
    expect(store.getSession(session.id)?.status).toBe('error')
  })

  it('deletes a session and its file', async () => {
    const session = await store.create()

    expect(await store.delete(session.id)).toBe(true)
    expect(store.list()).toEqual([])
    await expect(fs.stat(path.join(sessionsDirectory, `${session.id}.json`))).rejects.toMatchObject(
      {
        code: 'ENOENT'
      }
    )
    expect(await store.delete(session.id)).toBe(false)
  })

  it('reloads persisted sessions', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('persisted')] })
    )

    const reloaded = new SessionsStore(directory)
    await reloaded.init()

    expect(reloaded.getSession(session.id)?.title).toBe('persisted')
    expect(reloaded.getMessages(session.id)).toHaveLength(1)
  })

  it('repairs streaming sessions and unsettled tools on startup', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('hi')] })
    )
    await store.appendMessage(
      session.id,
      makeMessage({
        status: 'streaming',
        parts: [
          makeToolPart({ state: 'pending' }),
          makeToolPart({ state: 'running' }),
          makeToolPart({ state: 'awaiting-approval' })
        ]
      })
    )
    await store.setStatus(session.id, 'running')

    const reloaded = new SessionsStore(directory)
    await reloaded.init()

    const record = reloaded.get(session.id)
    expect(record?.session.status).toBe('idle')
    expect(record?.messages[1].status).toBe('interrupted')
    for (const part of record?.messages[1].parts ?? []) {
      expect(part.type).toBe('tool')
      if (part.type === 'tool') {
        expect(part.state).toBe('failed')
        expect(part.error).toBe('Interrupted by app restart')
        expect(part.finishedAt).toBeTruthy()
      }
    }
  })

  it('repairs waiting-permission sessions on startup', async () => {
    const session = await store.create()
    await store.setStatus(session.id, 'waiting-permission')

    const reloaded = new SessionsStore(directory)
    await reloaded.init()

    expect(reloaded.getSession(session.id)?.status).toBe('idle')
  })

  it('rebuilds the index when it is missing', async () => {
    const session = await store.create()
    await fs.rm(path.join(sessionsDirectory, 'index.json'))

    const reloaded = new SessionsStore(directory)
    await reloaded.init()

    expect(reloaded.list().map((entry) => entry.id)).toEqual([session.id])
  })

  it('quarantines corrupt session files without blocking others', async () => {
    const good = await store.create()
    await fs.writeFile(path.join(sessionsDirectory, 'broken.json'), '{not json')
    await fs.rm(path.join(sessionsDirectory, 'index.json'))

    const reloaded = new SessionsStore(directory)
    await reloaded.init()

    expect(reloaded.list().map((entry) => entry.id)).toEqual([good.id])
    const files = await fs.readdir(sessionsDirectory)
    expect(files.some((file) => file.startsWith('broken.json.corrupt-'))).toBe(true)
  })

  it('persists a valid JSON session file', async () => {
    const session = await store.create()
    const raw = await fs.readFile(path.join(sessionsDirectory, `${session.id}.json`), 'utf8')
    const parsed = JSON.parse(raw) as {
      version: number
      session: { id: string }
      messages: unknown[]
    }

    expect(parsed.version).toBe(1)
    expect(parsed.session.id).toBe(session.id)
    expect(parsed.messages).toEqual([])
  })

  it('ignores operations for unknown sessions', async () => {
    expect(await store.rename('missing', 'x')).toBeUndefined()
    expect(await store.setModel('missing', null)).toBeUndefined()
    await store.setStatus('missing', 'idle')
    await store.appendMessage('missing', makeMessage())
    expect(store.get('missing')).toBeUndefined()
    expect(store.getSession('missing')).toBeUndefined()
    expect(store.getMessages('missing')).toBeUndefined()
  })

  it('skips index entries whose file has disappeared', async () => {
    const session = await store.create()
    await fs.rm(path.join(sessionsDirectory, `${session.id}.json`))

    const reloaded = new SessionsStore(directory)
    await reloaded.init()

    expect(reloaded.list()).toEqual([])
  })

  it('skips non-session files when rebuilding the index', async () => {
    const session = await store.create()
    await fs.writeFile(path.join(sessionsDirectory, 'notes.txt'), 'not a session')
    await fs.rm(path.join(sessionsDirectory, 'index.json'))

    const reloaded = new SessionsStore(directory)
    await reloaded.init()

    expect(reloaded.list().map((entry) => entry.id)).toEqual([session.id])
  })

  it('recovers write queues after a failed persist', async () => {
    const session = await store.create()
    const indexFile = path.join(sessionsDirectory, 'index.json')
    await fs.rm(indexFile)
    await fs.mkdir(indexFile)

    await expect(store.rename(session.id, 'first')).rejects.toBeDefined()

    await fs.rm(indexFile, { recursive: true })
    const renamed = await store.rename(session.id, 'after failure')
    expect(renamed?.title).toBe('after failure')
  })

  it('drops queued writes for deleted sessions', async () => {
    const session = await store.create()

    const pending = store.persist(session.id)
    await store.delete(session.id)
    await pending

    expect(store.list()).toEqual([])
  })

  it('flushes an empty store', async () => {
    const fresh = new SessionsStore(directory)
    await expect(fresh.flush()).resolves.toBeUndefined()
  })
})
