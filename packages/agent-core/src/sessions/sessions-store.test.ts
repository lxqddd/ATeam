import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionsStore, makeTitle } from './sessions-store'
import { makeMessage, makeTextPart, makeToolPart } from '../test/factories'

interface LegacyFields {
  snapshotBefore?: string
  snapshotAfter?: string
  snapshotSteps?: Array<{ before: string; after: string; files: string[]; partIndex?: number }>
  changedFiles?: string[]
}

function withLegacyFields(
  fields: Parameters<typeof makeMessage>[0] & LegacyFields
): ReturnType<typeof makeMessage> {
  return makeMessage(fields)
}

let directory: string
let sessionsDirectory: string
let store: SessionsStore

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-test-')))
  sessionsDirectory = path.join(directory, 'agent', 'sessions')
  store = new SessionsStore(directory, { backend: 'json' })
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

    expect(session).toMatchObject({
      title: '',
      model: null,
      status: 'idle',
      reasoningEffort: null,
      permissionMode: 'ask',
      compaction: null,
      contextTokens: null,
      contextWindow: null
    })
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

  it('updates session settings and reloads them', async () => {
    const session = await store.create()
    const settings = { reasoningEffort: 'high' as const, permissionMode: 'acceptEdits' as const }

    expect(await store.setSettings(session.id, settings)).toMatchObject(settings)

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    expect(reloaded.getSession(session.id)).toMatchObject(settings)
    expect(await store.setSettings('missing', settings)).toBeUndefined()
  })

  it('stores, reloads and clears a compaction boundary', async () => {
    const session = await store.create()
    const compaction = {
      summary: 'The parser bug was fixed.',
      throughMessageId: 'message-3',
      createdAt: '2026-01-01T00:00:00.000Z',
      tokensBefore: 42_000,
      tokensAfter: 3_000
    }

    expect((await store.setCompaction(session.id, compaction))?.compaction).toMatchObject(
      compaction
    )

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    expect(reloaded.getSession(session.id)?.compaction).toMatchObject(compaction)

    expect((await store.setCompaction(session.id, null))?.compaction).toBeNull()
    expect(await store.setCompaction('missing', compaction)).toBeUndefined()
  })

  it('stores context usage', async () => {
    const session = await store.create()

    const updated = await store.setContextUsage(session.id, 12_345, 128_000)

    expect(updated).toMatchObject({ contextTokens: 12_345, contextWindow: 128_000 })
    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    expect(reloaded.getSession(session.id)).toMatchObject({
      contextTokens: 12_345,
      contextWindow: 128_000
    })
    expect(await store.setContextUsage('missing', 1, 2)).toBeUndefined()
  })

  it('clears a compaction boundary removed by undo', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'u1', role: 'user', parts: [makeTextPart('hello')] })
    )
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'a1', role: 'assistant', parts: [makeTextPart('hi')] })
    )
    await store.setCompaction(session.id, {
      summary: 'old summary',
      throughMessageId: 'a1',
      createdAt: '2026-01-01T00:00:00.000Z',
      tokensBefore: 10,
      tokensAfter: 2
    })

    const staged = await store.stageUndo(session.id, 1, null, 'hello', [])

    expect(staged?.session.compaction).toBeNull()
  })

  it('stages an undo and restores it with redo', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'u1', role: 'user', parts: [makeTextPart('hello')] })
    )
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'a1', role: 'assistant', parts: [makeTextPart('hi')] })
    )

    const staged = await store.stageUndo(session.id, 1, 'snapshot-after', 'hello', ['a.txt'])

    expect(staged?.session.redoAvailable).toBe(true)
    expect(staged?.removed.map((message) => message.id)).toEqual(['a1'])
    expect(store.getMessages(session.id)).toHaveLength(1)

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    expect(reloaded.getRedo(session.id)).toMatchObject({
      snapshotAfter: 'snapshot-after',
      prompt: 'hello',
      files: ['a.txt']
    })

    const redone = await reloaded.redo(session.id)
    expect(redone?.redoAvailable).toBe(false)
    expect(reloaded.getMessages(session.id)?.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(reloaded.getRedo(session.id)).toBeUndefined()
  })

  it('clears a staged redo when a new message is appended', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'u1', role: 'user', parts: [makeTextPart('hello')] })
    )
    await store.stageUndo(session.id, 0, null, 'hello', [])
    expect(store.getRedo(session.id)).toBeDefined()

    await store.appendMessage(
      session.id,
      makeMessage({ id: 'u2', role: 'user', parts: [makeTextPart('new direction')] })
    )

    expect(store.getRedo(session.id)).toBeUndefined()
    expect(store.getSession(session.id)?.redoAvailable).toBe(false)
  })

  it('rejects invalid undo indexes and missing redo state', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'u1', role: 'user', parts: [makeTextPart('hello')] })
    )

    expect(await store.stageUndo(session.id, 5, null, 'hello', [])).toBeUndefined()
    expect(await store.stageUndo('missing', 0, null, 'hello', [])).toBeUndefined()
    expect(await store.redo(session.id)).toBeUndefined()
    await store.clearRedo(session.id)
  })

  it('stages a part undo that replaces the message on redo', async () => {
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

    const staged = await store.stageStepUndo(session.id, 1, original, 'snapshot-after', ['a.txt'])

    expect(staged?.redoAvailable).toBe(true)
    expect(store.getRevert(session.id)).toBeUndefined()

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    expect(reloaded.getMessages(session.id)?.[1].parts).toHaveLength(1)
    expect(reloaded.getRedo(session.id)).toMatchObject({
      snapshotAfter: 'snapshot-after',
      prompt: '',
      files: ['a.txt'],
      target: { index: 1 }
    })

    await reloaded.redo(session.id)
    expect(reloaded.getMessages(session.id)?.[1].parts).toHaveLength(2)
    expect(reloaded.getRedo(session.id)).toBeUndefined()
  })

  it('rejects invalid part undo indexes', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'u1', role: 'user', parts: [makeTextPart('hello')] })
    )

    expect(
      await store.stageStepUndo(session.id, 5, makeMessage({ id: 'x' }), null, [])
    ).toBeUndefined()
    expect(
      await store.stageStepUndo('missing', 0, makeMessage({ id: 'x' }), null, [])
    ).toBeUndefined()
  })

  it('persists revert state and clears it on a new message', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({ id: 'u1', role: 'user', parts: [makeTextPart('hello')] })
    )
    await store.appendMessage(session.id, makeMessage({ id: 'a1', role: 'assistant', parts: [] }))
    await store.setRevert(session.id, { snapshot: 'pre-revert', messageId: 'a1', files: ['a.txt'] })

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    expect(reloaded.getRevert(session.id)).toEqual({
      snapshot: 'pre-revert',
      messageId: 'a1',
      files: ['a.txt']
    })

    await reloaded.appendMessage(
      session.id,
      makeMessage({ id: 'u2', role: 'user', parts: [makeTextPart('again')] })
    )
    expect(reloaded.getRevert(session.id)).toBeUndefined()
  })

  it('fills session settings for records written before they existed', async () => {
    const session = await store.create()
    const file = path.join(sessionsDirectory, `${session.id}.json`)
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as {
      session: { permissionMode?: string; reasoningEffort?: string | null; compaction?: unknown }
    }
    delete data.session.permissionMode
    delete data.session.reasoningEffort
    delete data.session.compaction
    await fs.writeFile(file, JSON.stringify(data))

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()

    expect(reloaded.getSession(session.id)).toMatchObject({
      reasoningEffort: null,
      permissionMode: 'ask',
      compaction: null
    })
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

    const reloaded = new SessionsStore(directory, { backend: 'json' })
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

    const reloaded = new SessionsStore(directory, { backend: 'json' })
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

  it('fills missing assistant model metadata from the session model', async () => {
    const session = await store.create()
    await store.setModel(session.id, { providerId: 'provider-1', modelId: 'model-1' })
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'assistant', parts: [makeTextPart('old')] })
    )
    await store.appendMessage(
      session.id,
      makeMessage({
        role: 'assistant',
        parts: [makeTextPart('kept')],
        model: { providerId: 'provider-2', modelId: 'model-2' }
      })
    )

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()

    const messages = reloaded.getMessages(session.id) ?? []
    expect(messages[0].model).toEqual({ providerId: 'provider-1', modelId: 'model-1' })
    expect(messages[1].model).toEqual({ providerId: 'provider-2', modelId: 'model-2' })
  })

  it('repairs waiting-permission sessions on startup', async () => {
    const session = await store.create()
    await store.setStatus(session.id, 'waiting-permission')

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()

    expect(reloaded.getSession(session.id)?.status).toBe('idle')
  })

  it('rebuilds the index when it is missing', async () => {
    const session = await store.create()
    await fs.rm(path.join(sessionsDirectory, 'index.json'))

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()

    expect(reloaded.list().map((entry) => entry.id)).toEqual([session.id])
  })

  it('quarantines corrupt session files without blocking others', async () => {
    const good = await store.create()
    await fs.writeFile(path.join(sessionsDirectory, 'broken.json'), '{not json')
    await fs.rm(path.join(sessionsDirectory, 'index.json'))

    const reloaded = new SessionsStore(directory, { backend: 'json' })
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
    expect(
      await store.setSettings('missing', { reasoningEffort: null, permissionMode: 'ask' })
    ).toBeUndefined()
    await store.setStatus('missing', 'idle')
    await store.appendMessage('missing', makeMessage())
    expect(store.get('missing')).toBeUndefined()
    expect(store.getSession('missing')).toBeUndefined()
    expect(store.getMessages('missing')).toBeUndefined()
  })

  it('skips index entries whose file has disappeared', async () => {
    const session = await store.create()
    await fs.rm(path.join(sessionsDirectory, `${session.id}.json`))

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()

    expect(reloaded.list()).toEqual([])
  })

  it('recovers sessions missing from a stale index', async () => {
    const session = await store.create()
    const indexFile = path.join(sessionsDirectory, 'index.json')
    const index = JSON.parse(await fs.readFile(indexFile, 'utf8')) as { sessions: unknown[] }
    index.sessions = []
    await fs.writeFile(indexFile, JSON.stringify(index))

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()

    expect(reloaded.list().map((entry) => entry.id)).toEqual([session.id])
  })

  it('skips non-session files when rebuilding the index', async () => {
    const session = await store.create()
    await fs.writeFile(path.join(sessionsDirectory, 'notes.txt'), 'not a session')
    await fs.rm(path.join(sessionsDirectory, 'index.json'))

    const reloaded = new SessionsStore(directory, { backend: 'json' })
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
    const fresh = new SessionsStore(directory, { backend: 'json' })
    await expect(fresh.flush()).resolves.toBeUndefined()
  })
})

describe('agent metadata', () => {
  it('creates hidden child sessions with an agent', async () => {
    const session = await store.create({
      hidden: true,
      parentId: 'parent-1',
      agent: 'explore',
      permissionMode: 'plan'
    })

    expect(session).toMatchObject({
      hidden: true,
      parentId: 'parent-1',
      agent: 'explore',
      permissionMode: 'plan'
    })
    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    expect(reloaded.getSession(session.id)).toMatchObject({
      hidden: true,
      parentId: 'parent-1',
      agent: 'explore'
    })
  })

  it('updates the session agent', async () => {
    const session = await store.create()

    await expect(store.setAgent(session.id, 'plan')).resolves.toMatchObject({ agent: 'plan' })
    await expect(store.setAgent('missing', 'plan')).resolves.toBeUndefined()
  })

  it('repairs sessions without agent metadata', async () => {
    const session = await store.create()
    const file = path.join(sessionsDirectory, `${session.id}.json`)
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as {
      session: Record<string, unknown>
    }
    delete data.session.hidden
    delete data.session.parentId
    delete data.session.agent
    await fs.writeFile(file, JSON.stringify(data))

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()

    expect(reloaded.getSession(session.id)).toMatchObject({
      hidden: false,
      parentId: null,
      agent: null
    })
  })

  it('persists and clears the session directory', async () => {
    const session = await store.create({ directory: '/tmp/project' })
    expect(session.directory).toBe('/tmp/project')

    await expect(store.setDirectory(session.id, '/tmp/worktree')).resolves.toMatchObject({
      directory: '/tmp/worktree'
    })
    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    expect(reloaded.getSession(session.id)?.directory).toBe('/tmp/worktree')

    await expect(store.setDirectory(session.id, null)).resolves.toMatchObject({ directory: null })
    await expect(store.setDirectory('missing', '/tmp/x')).resolves.toBeUndefined()
  })

  it('repairs invalid directory metadata', async () => {
    const session = await store.create()
    const file = path.join(sessionsDirectory, `${session.id}.json`)
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as {
      session: Record<string, unknown>
    }
    data.session.directory = 42
    await fs.writeFile(file, JSON.stringify(data))

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    expect(reloaded.getSession(session.id)?.directory).toBeNull()
  })
})

describe('todos', () => {
  it('starts with an empty todo list', async () => {
    const session = await store.create()
    expect(session.todos).toEqual([])
  })

  it('persists todo updates', async () => {
    const session = await store.create()
    const todos = [
      {
        id: 'todo-1',
        content: 'Write tests',
        status: 'completed' as const,
        priority: 'high' as const
      },
      {
        id: 'todo-2',
        content: 'Implement',
        status: 'in_progress' as const,
        priority: 'medium' as const
      }
    ]

    await expect(store.setTodos(session.id, todos)).resolves.toMatchObject({ todos })
    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    expect(reloaded.getSession(session.id)?.todos).toEqual(todos)
  })

  it('repairs missing or invalid todo lists', async () => {
    const session = await store.create()
    const file = path.join(sessionsDirectory, `${session.id}.json`)
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as {
      session: Record<string, unknown>
    }
    data.session.todos = 'nope'
    await fs.writeFile(file, JSON.stringify(data))

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()

    expect(reloaded.getSession(session.id)?.todos).toEqual([])
  })
})

describe('fork', () => {
  it('copies messages and settings into a new session', async () => {
    const session = await store.create({ agent: 'plan', permissionMode: 'auto' })
    await store.appendMessage(
      session.id,
      makeMessage({ role: 'user', parts: [makeTextPart('hi')] })
    )
    await store.appendMessage(session.id, makeMessage({ parts: [makeTextPart('hello')] }))
    await store.setTodos(session.id, [
      { id: 'todo-1', content: 'Ship', status: 'pending', priority: 'high' }
    ])

    const forked = await store.fork(session.id)

    expect(forked?.id).not.toBe(session.id)
    expect(forked).toMatchObject({
      agent: 'plan',
      permissionMode: 'auto',
      status: 'idle',
      todos: []
    })
    expect(forked?.title).toContain('(fork)')
    expect(store.getMessages(forked?.id as string)).toHaveLength(2)
  })

  it('migrates legacy snapshot fields on load and persists the parts', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      withLegacyFields({
        id: 'a1',
        role: 'assistant',
        parts: [makeTextPart('done')],
        snapshotBefore: 's0',
        snapshotAfter: 's1',
        snapshotSteps: [{ before: 's0', after: 's1', files: ['a.ts'], partIndex: 1 }],
        changedFiles: ['a.ts']
      })
    )

    const reloaded = new SessionsStore(directory, { backend: 'json' })
    await reloaded.init()
    const [message] = reloaded.getMessages(session.id) ?? []
    expect(message.parts.map((part) => part.type)).toEqual([
      'snapshot',
      'step-start',
      'text',
      'step-finish',
      'patch'
    ])
    expect('snapshotBefore' in message).toBe(false)
    expect('snapshotSteps' in message).toBe(false)

    const again = new SessionsStore(directory, { backend: 'json' })
    await again.init()
    expect(again.getMessages(session.id)?.[0].parts).toHaveLength(message.parts.length)
  })

  it('drops snapshot references in the fork', async () => {
    const session = await store.create()
    await store.appendMessage(
      session.id,
      makeMessage({
        parts: [
          { type: 'snapshot', snapshot: 'snap-before' },
          { type: 'step-start', step: 0, snapshot: 'snap-before' },
          makeTextPart('hello'),
          { type: 'step-finish', step: 0, snapshot: 'snap-after' },
          { type: 'patch', step: 0, snapshot: 'snap-after', files: ['x.ts'] }
        ]
      })
    )

    const forked = await store.fork(session.id)
    const [message] = store.getMessages(forked?.id as string) ?? []

    expect(message?.parts).toEqual([makeTextPart('hello')])
  })

  it('truncates the transcript at a message', async () => {
    const session = await store.create()
    const first = makeMessage({ role: 'user', parts: [makeTextPart('one')] })
    const second = makeMessage({ parts: [makeTextPart('two')] })
    await store.appendMessage(session.id, first)
    await store.appendMessage(session.id, second)

    expect(store.getMessages((await store.fork(session.id, first.id))?.id as string)).toHaveLength(
      1
    )

    const full = await store.fork(session.id, second.id)
    expect(store.getMessages(full?.id as string)).toHaveLength(2)
    await expect(store.fork(session.id, 'missing')).resolves.toBeUndefined()
  })
})
