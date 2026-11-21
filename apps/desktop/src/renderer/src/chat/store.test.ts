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

  it('compacts the selected session', async () => {
    mock.sessions.push(makeSession({ id: 's1', updatedAt: '2026-01-02T00:00:00.000Z' }))
    await store.init()
    const compaction = {
      summary: 'Earlier work',
      throughMessageId: 'm1',
      createdAt: '2026-01-01T00:00:00.000Z',
      tokensBefore: 42_000,
      tokensAfter: 3_000
    }
    vi.mocked(mock.api.agent.sessions.compact).mockResolvedValue({
      ...makeSession({ id: 's1' }),
      compaction
    })

    await store.compactSession()

    expect(mock.api.agent.sessions.compact).toHaveBeenCalledWith('s1')
    expect(store.getSnapshot().sessions[0].compaction).toEqual(compaction)
  })

  it('undoes and redoes the selected session', async () => {
    mock.sessions.push(makeSession({ id: 's1', updatedAt: '2026-01-02T00:00:00.000Z' }))
    await store.init()
    vi.mocked(mock.api.agent.sessions.undo).mockResolvedValue({
      session: makeSession({ id: 's1', redoAvailable: true }),
      prompt: 'restore me'
    })

    await store.undoSession()

    expect(mock.api.agent.sessions.undo).toHaveBeenCalledWith('s1')
    expect(store.getSnapshot().revertPrompt).toBe('restore me')
    expect(store.getSnapshot().sessions[0].redoAvailable).toBe(true)

    vi.mocked(mock.api.agent.sessions.redo).mockResolvedValue(makeSession({ id: 's1' }))
    await store.redoSession()

    expect(mock.api.agent.sessions.redo).toHaveBeenCalledWith('s1')
    expect(store.getSnapshot().sessions[0].redoAvailable).toBe(false)
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

    const settings = { reasoningEffort: 'high' as const, permissionMode: 'acceptEdits' as const }
    await store.setSessionSettings('s1', settings)
    expect(mock.api.agent.sessions.setSettings).toHaveBeenCalledWith('s1', settings)
    expect(store.getSnapshot().sessions[0]).toMatchObject(settings)

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

  it('deduplicates concurrent reloads', async () => {
    vi.mocked(mock.api.agent.status).mockResolvedValue({ status: 'stopped' })
    await store.init()
    let resolveList: (sessions: ReturnType<typeof makeSession>[]) => void = () => undefined
    vi.mocked(mock.api.agent.sessions.list).mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve
      })
    )
    let resolveRestart: (status: { status: 'ready' }) => void = () => undefined
    vi.mocked(mock.api.agent.restart).mockReturnValue(
      new Promise((resolve) => {
        resolveRestart = resolve
      })
    )

    const restart = store.restartAgent()
    mock.emit({ type: 'agent.status', status: { status: 'ready' } })
    resolveRestart({ status: 'ready' })
    resolveList([])
    await restart

    await vi.waitFor(() => expect(mock.api.agent.sessions.list).toHaveBeenCalledTimes(2))
  })
})

describe('ChatStore edge cases', () => {
  it('records agent status failures', async () => {
    vi.mocked(mock.api.agent.status).mockRejectedValue(new Error('status down'))

    await store.init()

    expect(store.getSnapshot().status).toEqual({ status: 'error', error: 'status down' })
  })

  it('keeps models null when the model config fails', async () => {
    vi.mocked(mock.api.models.get).mockRejectedValue(new Error('models down'))

    await store.init()

    expect(store.getSnapshot().models).toBeNull()
  })

  it('stringifies non-Error failures', async () => {
    vi.mocked(mock.api.agent.sessions.list).mockRejectedValue('plain failure')

    await store.init()

    expect(store.getSnapshot().actionError).toBe('plain failure')
  })

  it('does not surface session list errors while stopped', async () => {
    vi.mocked(mock.api.agent.status).mockResolvedValue({ status: 'stopped' })
    vi.mocked(mock.api.agent.sessions.list).mockRejectedValue(new Error('offline'))

    await store.init()

    expect(store.getSnapshot().actionError).toBeNull()
  })

  it('switches selection when the selected session disappears', async () => {
    mock.sessions.push(makeSession({ id: 's1', updatedAt: '2026-01-01T00:00:00.000Z' }))
    await store.init()
    expect(store.getSnapshot().selectedSessionId).toBe('s1')

    mock.sessions.length = 0
    mock.sessions.push(makeSession({ id: 's2', updatedAt: '2026-01-02T00:00:00.000Z' }))
    await store.loadSessions()

    expect(store.getSnapshot().selectedSessionId).toBe('s2')
  })

  it('ignores a second snapshot request while one is loading', async () => {
    await store.init()
    let resolveSnapshot: (snapshot: MessagesSnapshot) => void = () => undefined
    vi.mocked(mock.api.agent.messages.list).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve
      })
    )

    store.loadMessages('s1')
    store.loadMessages('s1')
    resolveSnapshot({ sessionId: 's1', seq: 0, messages: [], running: false })

    await vi.waitFor(() => expect(store.getSnapshot().loadedBySession.s1).toBe(true))
    const calls = vi
      .mocked(mock.api.agent.messages.list)
      .mock.calls.filter(([sessionId]) => sessionId === 's1')
    expect(calls).toHaveLength(1)
  })

  it('records snapshot failures', async () => {
    await store.init()
    vi.mocked(mock.api.agent.messages.list).mockRejectedValue(new Error('snapshot down'))

    await store.loadMessages('s1')

    expect(store.getSnapshot().actionError).toBe('snapshot down')
  })

  it('reuses the selected session or creates one', async () => {
    mock.sessions.push(makeSession({ id: 's1', updatedAt: '2026-01-02T00:00:00.000Z' }))
    await store.init()

    const existing = await store.ensureSession()
    expect(existing.id).toBe('s1')
    expect(mock.api.agent.sessions.create).not.toHaveBeenCalled()

    store.selectSession('missing')
    const created = await store.ensureSession()
    expect(mock.api.agent.sessions.create).toHaveBeenCalled()
    expect(store.getSnapshot().selectedSessionId).toBe(created.id)
  })

  it('ignores stop and retry without a selected session', async () => {
    await store.init()

    await store.stop()
    await store.retry()

    expect(mock.api.agent.chat.stop).not.toHaveBeenCalled()
    expect(mock.api.agent.chat.retry).not.toHaveBeenCalled()
  })

  it('forwards permission replies', async () => {
    await store.init()

    await store.replyPermission('p1', 'always')

    expect(mock.api.agent.permissions.reply).toHaveBeenCalledWith('p1', 'always')
  })

  it('restarts the agent', async () => {
    await store.init()
    vi.mocked(mock.api.agent.restart).mockResolvedValue({ status: 'ready' })

    await store.restartAgent()

    expect(store.getSnapshot().status).toEqual({ status: 'ready' })
    expect(store.getSnapshot().restarting).toBe(false)
  })

  it('records restart failures', async () => {
    await store.init()
    vi.mocked(mock.api.agent.restart).mockRejectedValue(new Error('restart failed'))

    await store.restartAgent()

    expect(store.getSnapshot().actionError).toBe('restart failed')
    expect(store.getSnapshot().restarting).toBe(false)
  })

  it('ignores restart while already restarting', async () => {
    await store.init()
    let resolveRestart: (status: { status: 'ready' }) => void = () => undefined
    vi.mocked(mock.api.agent.restart).mockReturnValue(
      new Promise((resolve) => {
        resolveRestart = resolve
      })
    )

    const first = store.restartAgent()
    await store.restartAgent()
    expect(mock.api.agent.restart).toHaveBeenCalledTimes(1)

    resolveRestart({ status: 'ready' })
    await first
  })

  it('notifies subscribers until unsubscribed', () => {
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.selectSession('s1')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.selectSession('s2')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('ignores part and delta events for unknown sessions and messages', async () => {
    mock.sessions.push(makeSession({ id: 's1', updatedAt: '2026-01-02T00:00:00.000Z' }))
    mock.messages.set('s1', {
      sessionId: 's1',
      seq: 0,
      messages: [
        makeMessage({
          id: 'm1',
          sessionId: 's1',
          parts: [makeTextPart('hi'), makeReasoningPart('think')]
        })
      ],
      running: false
    })
    await store.init()

    mock.emit({
      type: 'message.part.upsert',
      sessionId: 'other',
      messageId: 'm1',
      partIndex: 0,
      part: makeTextPart('x')
    })
    mock.emit({
      type: 'message.part.upsert',
      sessionId: 's1',
      messageId: 'missing',
      partIndex: 0,
      part: makeTextPart('x')
    })
    mock.emit({
      type: 'message.part.delta',
      sessionId: 'other',
      messageId: 'm1',
      partIndex: 0,
      kind: 'text',
      delta: 'x'
    })
    mock.emit({
      type: 'message.part.delta',
      sessionId: 's1',
      messageId: 'missing',
      partIndex: 0,
      kind: 'text',
      delta: 'x'
    })
    mock.emit({
      type: 'message.part.delta',
      sessionId: 's1',
      messageId: 'm1',
      partIndex: 1,
      kind: 'text',
      delta: 'x'
    })
    mock.emit({
      type: 'message.part.delta',
      sessionId: 's1',
      messageId: 'm1',
      partIndex: 0,
      kind: 'reasoning',
      delta: 'x'
    })

    expect(store.getSnapshot().messagesBySession.s1?.[0].parts).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'reasoning', text: 'think' }
    ])
  })

  it('keeps the selection when another session is deleted', async () => {
    mock.sessions.push(
      makeSession({ id: 's1', updatedAt: '2026-01-01T00:00:00.000Z' }),
      makeSession({ id: 's2', updatedAt: '2026-01-02T00:00:00.000Z' })
    )
    mock.messages.set('s2', { sessionId: 's2', seq: 0, messages: [], running: false })
    await store.init()

    mock.emit({ type: 'session.deleted', sessionId: 's1' })

    expect(store.getSnapshot().selectedSessionId).toBe('s2')
    expect(store.getSnapshot().sessions.map((session) => session.id)).toEqual(['s2'])
  })

  it('ignores deletion events for unknown sessions', async () => {
    await store.init()

    mock.emit({ type: 'session.deleted', sessionId: 'missing' })

    expect(store.getSnapshot().sessions).toEqual([])
  })

  it('deduplicates concurrent session loads', async () => {
    await store.init()
    const before = vi.mocked(mock.api.agent.sessions.list).mock.calls.length
    let resolveList: (sessions: ReturnType<typeof makeSession>[]) => void = () => undefined
    vi.mocked(mock.api.agent.sessions.list).mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve
      })
    )

    const first = store.loadSessions()
    const second = store.loadSessions()
    resolveList([])
    await Promise.all([first, second])

    expect(vi.mocked(mock.api.agent.sessions.list).mock.calls.length).toBe(before + 1)
  })

  it('clears action errors', async () => {
    vi.mocked(mock.api.agent.sessions.list).mockRejectedValue(new Error('boom'))
    await store.init()
    expect(store.getSnapshot().actionError).toBe('boom')

    store.clearActionError()

    expect(store.getSnapshot().actionError).toBeNull()
  })

  it('does not reload when a restart does not become ready', async () => {
    await store.init()
    const before = vi.mocked(mock.api.agent.sessions.list).mock.calls.length
    vi.mocked(mock.api.agent.restart).mockResolvedValue({ status: 'stopped' })

    await store.restartAgent()

    expect(store.getSnapshot().status.status).toBe('stopped')
    expect(vi.mocked(mock.api.agent.sessions.list).mock.calls.length).toBe(before)
  })

  it('ignores duplicate ready events', async () => {
    await store.init()
    const before = vi.mocked(mock.api.agent.sessions.list).mock.calls.length

    mock.emit({ type: 'agent.status', status: { status: 'ready' } })
    await Promise.resolve()

    expect(vi.mocked(mock.api.agent.sessions.list).mock.calls.length).toBe(before)
  })

  it('clears the selection when no sessions remain', async () => {
    mock.sessions.push(makeSession({ id: 's1', updatedAt: '2026-01-01T00:00:00.000Z' }))
    await store.init()
    expect(store.getSnapshot().selectedSessionId).toBe('s1')

    mock.sessions.length = 0
    await store.loadSessions()

    expect(store.getSnapshot().selectedSessionId).toBeNull()
  })
})
