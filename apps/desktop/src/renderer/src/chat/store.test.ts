import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessagesSnapshot } from '@ateam/shared'
import { ChatStore } from './store'
import { createApiMock, type ApiMock } from '../test/api-mock'
import {
  makeMessage,
  makePermission,
  makeReasoningPart,
  makeSession,
  makeTextPart,
  makeToolPart
} from '../test/factories'

let mock: ApiMock
let store: ChatStore

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
  store = new ChatStore()
})

afterEach(() => {
  store.dispose()
})

describe('ChatStore init', () => {
  it('loads status, info, models, sessions and the most recent session', async () => {
    mock.sessions.push(
      makeSession({ id: 'older', updatedAt: '2026-01-01T00:00:00.000Z' }),
      makeSession({ id: 'newer', updatedAt: '2026-01-02T00:00:00.000Z' })
    )
    mock.messages.set('newer', { sessionId: 'newer', seq: 0, messages: [], running: false })

    await store.init()

    const state = store.getSnapshot()
    expect(state.status).toEqual({ status: 'ready' })
    expect(state.info?.workspacePath).toBe('/tmp/workspace')
    expect(state.models).not.toBeNull()
    expect(state.sessions.map((session) => session.id)).toEqual(['newer', 'older'])
    expect(state.selectedSessionId).toBe('newer')
    expect(state.loadedBySession.newer).toBe(true)
  })

  it('loads pending permissions', async () => {
    const permission = makePermission({ id: 'permission-1' })
    mock.permissions.push(permission)

    await store.init()

    expect(store.getSnapshot().permissions).toEqual([permission])
  })

  it('does not create a session when there are none', async () => {
    await store.init()

    expect(store.getSnapshot().selectedSessionId).toBeNull()
    expect(mock.api.agent.sessions.create).not.toHaveBeenCalled()
  })

  it('only subscribes once across repeated init calls', async () => {
    await Promise.all([store.init(), store.init()])

    expect(mock.api.agent.onEvent).toHaveBeenCalledTimes(1)
  })

  it('records a session list failure as actionError while the agent is ready', async () => {
    vi.mocked(mock.api.agent.sessions.list).mockRejectedValue(new Error('boom'))

    await store.init()

    expect(store.getSnapshot().actionError).toBe('boom')
  })
})

describe('ChatStore sessions', () => {
  it('creates and selects a session', async () => {
    await store.init()

    const session = await store.createSession()

    const state = store.getSnapshot()
    expect(state.selectedSessionId).toBe(session.id)
    expect(state.sessions[0].id).toBe(session.id)
    expect(state.messagesBySession[session.id]).toEqual([])
  })

  it('sorts sessions on upsert', async () => {
    await store.init()
    mock.emit({
      type: 'session.upsert',
      session: makeSession({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' })
    })
    mock.emit({
      type: 'session.upsert',
      session: makeSession({ id: 'b', updatedAt: '2026-01-02T00:00:00.000Z' })
    })

    expect(store.getSnapshot().sessions.map((session) => session.id)).toEqual(['b', 'a'])

    mock.emit({
      type: 'session.upsert',
      session: makeSession({ id: 'a', updatedAt: '2026-01-03T00:00:00.000Z' })
    })

    expect(store.getSnapshot().sessions.map((session) => session.id)).toEqual(['a', 'b'])
  })

  it('falls back to the next session when the selected one is deleted', async () => {
    mock.sessions.push(
      makeSession({ id: 's1', updatedAt: '2026-01-01T00:00:00.000Z' }),
      makeSession({ id: 's2', updatedAt: '2026-01-02T00:00:00.000Z' })
    )
    mock.messages.set('s2', { sessionId: 's2', seq: 0, messages: [], running: false })
    await store.init()

    mock.emit({ type: 'session.deleted', sessionId: 's2' })

    const state = store.getSnapshot()
    expect(state.sessions.map((session) => session.id)).toEqual(['s1'])
    expect(state.selectedSessionId).toBe('s1')
    expect(state.messagesBySession.s2).toBeUndefined()
    await vi.waitFor(() => expect(mock.api.agent.messages.list).toHaveBeenCalledWith('s1'))
  })

  it('forwards rename, delete, setModel and run actions', async () => {
    mock.sessions.push(makeSession({ id: 's1', updatedAt: '2026-01-02T00:00:00.000Z' }))
    await store.init()

    await store.renameSession('s1', 'renamed')
    expect(mock.api.agent.sessions.rename).toHaveBeenCalledWith('s1', 'renamed')
    expect(store.getSnapshot().sessions[0].title).toBe('renamed')

    const model = { providerId: 'provider-1', modelId: 'model-1' }
    await store.setSessionModel('s1', model)
    expect(mock.api.agent.sessions.setModel).toHaveBeenCalledWith('s1', model)
    expect(store.getSnapshot().sessions[0].model).toEqual(model)

    await store.stop()
    expect(mock.api.agent.chat.stop).toHaveBeenCalledWith('s1')
    await store.retry()
    expect(mock.api.agent.chat.retry).toHaveBeenCalledWith('s1')

    await store.deleteSession('s1')
    expect(mock.api.agent.sessions.remove).toHaveBeenCalledWith('s1')
    expect(store.getSnapshot().sessions).toEqual([])
    expect(store.getSnapshot().selectedSessionId).toBeNull()
  })
})

describe('ChatStore send', () => {
  it('rejects when the agent is not ready', async () => {
    vi.mocked(mock.api.agent.status).mockResolvedValue({ status: 'stopped' })
    await store.init()

    await expect(store.send('hello')).rejects.toThrow('AGENT_NOT_READY')
  })

  it('creates a session when needed and trims the text', async () => {
    await store.init()

    await store.send('  hello  ')

    expect(mock.api.agent.sessions.create).toHaveBeenCalledTimes(1)
    expect(mock.api.agent.chat.send).toHaveBeenCalledWith({ sessionId: 'created-1', text: 'hello' })
  })

  it('ignores empty input', async () => {
    await store.init()

    await store.send('   ')

    expect(mock.api.agent.chat.send).not.toHaveBeenCalled()
  })
})

describe('ChatStore messages', () => {
  async function initWithSession(): Promise<void> {
    mock.sessions.push(makeSession({ id: 's1', updatedAt: '2026-01-02T00:00:00.000Z' }))
    mock.messages.set('s1', { sessionId: 's1', seq: 0, messages: [], running: false })
    await store.init()
  }

  it('adds and replaces messages', async () => {
    await initWithSession()
    const message = makeMessage({ id: 'm1', sessionId: 's1', parts: [makeTextPart('hi')] })

    mock.emit({ type: 'message.upsert', message })
    expect(store.getSnapshot().messagesBySession.s1).toHaveLength(1)

    mock.emit({ type: 'message.upsert', message: { ...message, parts: [makeTextPart('hello')] } })
    const messages = store.getSnapshot().messagesBySession.s1 ?? []
    expect(messages).toHaveLength(1)
    expect(messages[0].parts[0]).toEqual({ type: 'text', text: 'hello' })
  })

  it('ignores messages for unloaded sessions', async () => {
    await initWithSession()

    mock.emit({
      type: 'message.upsert',
      message: makeMessage({ id: 'm1', sessionId: 'other' })
    })

    expect(store.getSnapshot().messagesBySession.other).toBeUndefined()
  })

  it('upserts parts at the given index', async () => {
    await initWithSession()
    mock.emit({
      type: 'message.upsert',
      message: makeMessage({ id: 'm1', sessionId: 's1', parts: [makeTextPart('hi')] })
    })

    const toolPart = makeToolPart({ toolCallId: 'call-1' })
    mock.emit({
      type: 'message.part.upsert',
      sessionId: 's1',
      messageId: 'm1',
      partIndex: 1,
      part: toolPart
    })

    expect(store.getSnapshot().messagesBySession.s1?.[0].parts).toEqual([
      { type: 'text', text: 'hi' },
      toolPart
    ])

    mock.emit({
      type: 'message.part.upsert',
      sessionId: 's1',
      messageId: 'm1',
      partIndex: 5,
      part: makeTextPart('ignored')
    })
    expect(store.getSnapshot().messagesBySession.s1?.[0].parts).toHaveLength(2)
  })

  it('appends text and reasoning deltas', async () => {
    await initWithSession()
    mock.emit({
      type: 'message.upsert',
      message: makeMessage({
        id: 'm1',
        sessionId: 's1',
        parts: [makeTextPart('a'), makeReasoningPart('r')]
      })
    })

    mock.emit({
      type: 'message.part.delta',
      sessionId: 's1',
      messageId: 'm1',
      partIndex: 0,
      kind: 'text',
      delta: 'b'
    })
    mock.emit({
      type: 'message.part.delta',
      sessionId: 's1',
      messageId: 'm1',
      partIndex: 1,
      kind: 'reasoning',
      delta: 's'
    })

    expect(store.getSnapshot().messagesBySession.s1?.[0].parts).toEqual([
      { type: 'text', text: 'ab' },
      { type: 'reasoning', text: 'rs' }
    ])
  })

  it('creates parts from deltas and ignores kind mismatches', async () => {
    await initWithSession()
    mock.emit({
      type: 'message.upsert',
      message: makeMessage({ id: 'm1', sessionId: 's1', parts: [] })
    })

    mock.emit({
      type: 'message.part.delta',
      sessionId: 's1',
      messageId: 'm1',
      partIndex: 0,
      kind: 'text',
      delta: 'new'
    })
    expect(store.getSnapshot().messagesBySession.s1?.[0].parts).toEqual([
      { type: 'text', text: 'new' }
    ])

    mock.emit({
      type: 'message.part.delta',
      sessionId: 's1',
      messageId: 'm1',
      partIndex: 0,
      kind: 'reasoning',
      delta: 'ignored'
    })
    expect(store.getSnapshot().messagesBySession.s1?.[0].parts).toEqual([
      { type: 'text', text: 'new' }
    ])
  })
})

describe('ChatStore permissions and runs', () => {
  it('dedupes permission.asked and removes on reply', async () => {
    await store.init()
    const permission = makePermission({ id: 'p1', sessionId: 's1' })

    mock.emit({ type: 'permission.asked', permission })
    mock.emit({ type: 'permission.asked', permission: { ...permission, resource: 'b.txt' } })

    expect(store.getSnapshot().permissions).toHaveLength(1)
    expect(store.getSnapshot().permissions[0].resource).toBe('b.txt')

    mock.emit({
      type: 'permission.replied',
      sessionId: 's1',
      requestId: 'p1',
      decision: 'once'
    })
    expect(store.getSnapshot().permissions).toEqual([])
  })

  it('clears only the finished session permissions', async () => {
    await store.init()
    mock.emit({
      type: 'permission.asked',
      permission: makePermission({ id: 'p1', sessionId: 's1' })
    })
    mock.emit({
      type: 'permission.asked',
      permission: makePermission({ id: 'p2', sessionId: 's2' })
    })

    mock.emit({ type: 'run.finished', sessionId: 's1', messageId: 'm1', status: 'completed' })

    expect(store.getSnapshot().permissions.map((permission) => permission.id)).toEqual(['p2'])
  })

  it('tracks run outcomes between started and finished', async () => {
    await store.init()
    mock.emit({ type: 'run.finished', sessionId: 's1', messageId: 'm1', status: 'completed' })
    expect(store.getSnapshot().runOutcomes.m1).toBe('completed')

    mock.emit({
      type: 'run.started',
      sessionId: 's1',
      messageId: 'm1',
      startedAt: new Date().toISOString()
    })
    expect(store.getSnapshot().runOutcomes.m1).toBeUndefined()

    mock.emit({ type: 'run.finished', sessionId: 's1', messageId: 'm1', status: 'failed' })
    expect(store.getSnapshot().runOutcomes.m1).toBe('failed')
  })
})

describe('ChatStore snapshot buffering', () => {
  it('buffers events during a snapshot load and replays newer ones', async () => {
    await store.init()
    let resolveSnapshot: (snapshot: MessagesSnapshot) => void = () => undefined
    const pending = new Promise<MessagesSnapshot>((resolve) => {
      resolveSnapshot = resolve
    })
    vi.mocked(mock.api.agent.messages.list).mockReturnValue(pending)

    store.selectSession('s1')

    mock.emit({ type: 'message.upsert', message: makeMessage({ id: 'old', sessionId: 's1' }) }, 3)
    mock.emit({ type: 'message.upsert', message: makeMessage({ id: 'new', sessionId: 's1' }) }, 6)
    expect(store.getSnapshot().loadedBySession.s1).toBeUndefined()

    resolveSnapshot({ sessionId: 's1', seq: 5, messages: [], running: false })

    await vi.waitFor(() => expect(store.getSnapshot().loadedBySession.s1).toBe(true))
    expect(store.getSnapshot().messagesBySession.s1?.map((message) => message.id)).toEqual(['new'])
  })

  it('does not reload messages for already loaded sessions', async () => {
    mock.sessions.push(
      makeSession({ id: 's1', updatedAt: '2026-01-01T00:00:00.000Z' }),
      makeSession({ id: 's2', updatedAt: '2026-01-02T00:00:00.000Z' })
    )
    await store.init()

    store.selectSession('s1')
    await vi.waitFor(() => expect(store.getSnapshot().loadedBySession.s1).toBe(true))
    store.selectSession('s2')
    store.selectSession('s1')

    const calls = vi
      .mocked(mock.api.agent.messages.list)
      .mock.calls.filter(([sessionId]) => sessionId === 's1')
    expect(calls).toHaveLength(1)
  })
})

describe('ChatStore ready transition', () => {
  it('reloads sessions when the agent becomes ready', async () => {
    vi.mocked(mock.api.agent.status).mockResolvedValue({ status: 'stopped' })
    await store.init()
    expect(mock.api.agent.sessions.list).toHaveBeenCalledTimes(1)

    mock.emit({ type: 'agent.status', status: { status: 'ready' } })

    await vi.waitFor(() => expect(mock.api.agent.sessions.list).toHaveBeenCalledTimes(2))
  })
})
