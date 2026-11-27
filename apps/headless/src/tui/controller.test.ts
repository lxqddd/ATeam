import { describe, expect, it } from 'vitest'
import { makeSession } from '@ateam/agent-core/testing'
import type {
  AgentEvent,
  ChatMessage,
  MessagesSnapshot,
  PermissionDecision,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  SessionMeta
} from '@ateam/shared'
import type { TuiBackend, TuiBackendListener, TuiNewSession } from './backend'
import { TuiController, type TuiControllerOptions, type TuiKey } from './controller'

const NOW = '2026-01-01T00:00:00.000Z'

function emptySnapshot(id: string): MessagesSnapshot {
  return { sessionId: id, seq: 0, messages: [], running: false }
}

class FakeBackend implements TuiBackend {
  readonly mode = 'local' as const
  sessions: SessionMeta[] = []
  snapshots = new Map<string, MessagesSnapshot>()
  permissionsList: PermissionRequest[] = []
  questionsList: QuestionRequest[] = []
  created: TuiNewSession[] = []
  sent: Array<{ id: string; text: string }> = []
  stopped: string[] = []
  retried: string[] = []
  permissionReplies: Array<{ id: string; decision: PermissionDecision }> = []
  questionReplies: Array<{ id: string; answer: QuestionAnswer }> = []
  shutdowns = 0
  sendResult: 'sent' | 'steered' = 'sent'
  sendError: Error | null = null
  private readonly listeners = new Set<TuiBackendListener>()
  private counter = 0

  init(): Promise<void> {
    return Promise.resolve()
  }

  listSessions(): Promise<SessionMeta[]> {
    return Promise.resolve(this.sessions.map((session) => ({ ...session })))
  }

  createSession(input: TuiNewSession): Promise<SessionMeta> {
    this.counter += 1
    const session = makeSession({
      id: `new-${this.counter}`,
      title: '',
      updatedAt: new Date(Date.now() + this.counter * 1000).toISOString(),
      permissionMode: input.permissionMode,
      reasoningEffort: input.reasoningEffort,
      agent: input.agent,
      model: input.model
    })
    this.created.push(input)
    this.sessions.push(session)
    this.snapshots.set(session.id, emptySnapshot(session.id))
    return Promise.resolve({ ...session })
  }

  messages(id: string): Promise<MessagesSnapshot> {
    return Promise.resolve(structuredClone(this.snapshots.get(id) ?? emptySnapshot(id)))
  }

  sendChat(id: string, text: string): Promise<'sent' | 'steered'> {
    this.sent.push({ id, text })
    if (this.sendError) return Promise.reject(this.sendError)
    return Promise.resolve(this.sendResult)
  }

  stopChat(id: string): Promise<void> {
    this.stopped.push(id)
    return Promise.resolve()
  }

  retryChat(id: string): Promise<void> {
    this.retried.push(id)
    return Promise.resolve()
  }

  replyPermission(id: string, decision: PermissionDecision): Promise<void> {
    this.permissionReplies.push({ id, decision })
    return Promise.resolve()
  }

  replyQuestion(id: string, answer: QuestionAnswer): Promise<void> {
    this.questionReplies.push({ id, answer })
    return Promise.resolve()
  }

  permissions(): Promise<PermissionRequest[]> {
    return Promise.resolve(this.permissionsList.map((request) => ({ ...request })))
  }

  questions(): Promise<QuestionRequest[]> {
    return Promise.resolve(
      this.questionsList.map((request) => ({
        ...request,
        options: request.options.map((option) => ({ ...option }))
      }))
    )
  }

  subscribe(listener: TuiBackendListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  shutdown(): Promise<void> {
    this.shutdowns += 1
    return Promise.resolve()
  }

  emit(event: AgentEvent): void {
    for (const listener of this.listeners) listener.event(event)
  }

  resync(): void {
    for (const listener of this.listeners) listener.resync()
  }
}

function session(id: string, updatedAt: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return makeSession({ id, title: id, updatedAt, ...overrides })
}

function message(
  id: string,
  sessionId: string,
  role: ChatMessage['role'],
  parts: ChatMessage['parts'],
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id,
    sessionId,
    role,
    parts,
    createdAt: NOW,
    updatedAt: NOW,
    status: 'complete',
    ...overrides
  }
}

function permission(id: string, sessionId: string): PermissionRequest {
  return {
    id,
    sessionId,
    messageId: 'm1',
    toolCallId: 'c1',
    action: 'shell',
    resource: 'ls',
    toolName: 'shell',
    createdAt: NOW
  }
}

function question(
  id: string,
  sessionId: string,
  overrides: Partial<QuestionRequest> = {}
): QuestionRequest {
  return {
    id,
    sessionId,
    messageId: 'm1',
    toolCallId: 'c1',
    header: '选择',
    question: '选哪个？',
    options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    multiple: false,
    allowCustom: false,
    createdAt: NOW,
    ...overrides
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function setup(backend: FakeBackend, overrides: Partial<TuiControllerOptions> = {}): TuiController {
  return new TuiController({
    backend,
    permissionMode: 'ask',
    reasoningEffort: null,
    agent: null,
    model: null,
    label: 'test-model',
    workspace: '/work',
    onChange: () => undefined,
    onQuit: () => undefined,
    ...overrides
  })
}

function type(controller: TuiController, text: string): void {
  for (const char of text) controller.handleKey({ sequence: char, name: char })
}

function key(name: string, extra: Partial<TuiKey> = {}): TuiKey {
  return { name, ...extra }
}

async function started(
  backend: FakeBackend,
  overrides: Partial<TuiControllerOptions> = {}
): Promise<TuiController> {
  const controller = setup(backend, overrides)
  await controller.start()
  return controller
}

describe('TuiController', () => {
  it('opens the most recent session and loads its transcript', async () => {
    const backend = new FakeBackend()
    backend.sessions = [
      session('old', '2026-01-01T00:00:00.000Z'),
      session('new', '2026-01-02T00:00:00.000Z')
    ]
    backend.snapshots.set('new', {
      sessionId: 'new',
      seq: 1,
      running: true,
      messages: [message('u1', 'new', 'user', [{ type: 'text', text: 'hi' }])]
    })

    const controller = await started(backend)
    expect(controller.state.currentId).toBe('new')
    expect(controller.state.messages[0].parts).toEqual([{ type: 'text', text: 'hi' }])
    expect(controller.state.running).toBe(true)
  })

  it('opens a requested session and falls back when it is missing', async () => {
    const backend = new FakeBackend()
    backend.sessions = [
      session('a', '2026-01-01T00:00:00.000Z'),
      session('b', '2026-01-02T00:00:00.000Z')
    ]

    const requested = await started(backend, { sessionId: 'a' })
    expect(requested.state.currentId).toBe('a')

    const missing = await started(backend, { sessionId: 'gone' })
    expect(missing.state.currentId).toBe('b')
    expect(missing.state.notice).toContain('未找到会话 gone')
  })

  it('creates a session when the store is empty and on Ctrl-T', async () => {
    const backend = new FakeBackend()
    const first = await started(backend)
    expect(backend.created).toHaveLength(1)
    expect(first.state.currentId).toBe('new-1')

    const controller = await started(backend, {
      permissionMode: 'auto',
      reasoningEffort: 'high',
      agent: 'build',
      model: { providerId: 'p1', modelId: 'm1' }
    })
    controller.handleKey(key('t', { ctrl: true }))
    await flush()
    expect(backend.created.at(-1)).toMatchObject({
      permissionMode: 'auto',
      reasoningEffort: 'high',
      agent: 'build',
      model: { providerId: 'p1', modelId: 'm1' }
    })
    expect(controller.state.currentId).toBe('new-2')
  })

  it('replays a recorded stream into text, reasoning and tool parts', async () => {
    const backend = new FakeBackend()
    backend.sessions = [session('s1', '2026-01-01T00:00:00.000Z')]
    const controller = await started(backend)

    const recording: AgentEvent[] = [
      { type: 'run.started', sessionId: 's1', messageId: 'a1', startedAt: NOW },
      {
        type: 'message.upsert',
        message: message('u1', 's1', 'user', [{ type: 'text', text: 'hello' }])
      },
      {
        type: 'message.upsert',
        message: message(
          'a1',
          's1',
          'assistant',
          [
            { type: 'reasoning', text: '' },
            { type: 'text', text: '' }
          ],
          { status: 'streaming' }
        )
      },
      {
        type: 'message.part.delta',
        sessionId: 's1',
        messageId: 'a1',
        partIndex: 0,
        kind: 'reasoning',
        delta: '思考'
      },
      {
        type: 'message.part.delta',
        sessionId: 's1',
        messageId: 'a1',
        partIndex: 1,
        kind: 'text',
        delta: '你好'
      },
      {
        type: 'message.part.upsert',
        sessionId: 's1',
        messageId: 'a1',
        partIndex: 2,
        part: {
          type: 'tool',
          toolCallId: 'c1',
          toolName: 'shell',
          input: { command: 'ls' },
          state: 'running'
        }
      },
      {
        type: 'message.part.delta',
        sessionId: 's1',
        messageId: 'a1',
        partIndex: 2,
        kind: 'tool-output',
        delta: 'partial'
      },
      {
        type: 'message.part.upsert',
        sessionId: 's1',
        messageId: 'a1',
        partIndex: 2,
        part: {
          type: 'tool',
          toolCallId: 'c1',
          toolName: 'shell',
          input: { command: 'ls' },
          state: 'completed',
          output: 'a.txt\n'
        }
      },
      {
        type: 'run.finished',
        sessionId: 's1',
        messageId: 'a1',
        status: 'completed'
      }
    ]
    for (const event of recording) backend.emit(event)

    expect(controller.state.messages.map((item) => item.id)).toEqual(['u1', 'a1'])
    const parts = controller.state.messages[1].parts
    expect(parts[0]).toEqual({ type: 'reasoning', text: '思考' })
    expect(parts[1]).toEqual({ type: 'text', text: '你好' })
    expect(parts[2]).toMatchObject({ type: 'tool', state: 'completed', output: 'a.txt\n' })
    expect(controller.state.running).toBe(false)
  })

  it('answers permissions from the keyboard and stops instead of quitting on Ctrl-C', async () => {
    const backend = new FakeBackend()
    backend.sessions = [session('s1', '2026-01-01T00:00:00.000Z')]
    const controller = await started(backend)

    backend.emit({ type: 'permission.asked', permission: permission('p1', 's1') })
    expect(controller.state.overlay).toBe('permission')
    controller.handleKey(key('y'))
    await flush()
    expect(backend.permissionReplies).toEqual([{ id: 'p1', decision: 'once' }])
    expect(controller.state.overlay).toBeNull()

    backend.emit({ type: 'permission.asked', permission: permission('p2', 's1') })
    controller.handleKey(key('down'))
    controller.handleKey(key('down'))
    controller.handleKey(key('return'))
    await flush()
    expect(backend.permissionReplies.at(-1)).toEqual({ id: 'p2', decision: 'reject' })

    backend.emit({ type: 'permission.asked', permission: permission('p3', 's1') })
    controller.handleKey(key('a'))
    await flush()
    expect(backend.permissionReplies.at(-1)).toEqual({ id: 'p3', decision: 'always' })

    backend.emit({ type: 'permission.asked', permission: permission('p4', 's1') })
    controller.handleKey(key('escape'))
    await flush()
    expect(backend.permissionReplies.at(-1)).toEqual({ id: 'p4', decision: 'reject' })

    backend.emit({ type: 'permission.asked', permission: permission('p5', 's1') })
    backend.emit({ type: 'run.started', sessionId: 's1', messageId: 'a1', startedAt: NOW })
    controller.handleKey(key('c', { ctrl: true }))
    expect(backend.stopped).toEqual(['s1'])
    expect(backend.permissionReplies.some((reply) => reply.id === 'p5')).toBe(false)
  })

  it('answers questions with options, numbers, custom text and cancellation', async () => {
    const backend = new FakeBackend()
    backend.sessions = [session('s1', '2026-01-01T00:00:00.000Z')]
    const controller = await started(backend)

    backend.emit({
      type: 'question.asked',
      question: question('q1', 's1', { multiple: true })
    })
    expect(controller.state.overlay).toBe('question')
    controller.handleKey({ name: 'space', sequence: ' ' })
    controller.handleKey(key('down'))
    controller.handleKey({ name: 'space', sequence: ' ' })
    controller.handleKey(key('return'))
    await flush()
    expect(backend.questionReplies[0]).toEqual({
      id: 'q1',
      answer: { selected: ['A', 'B'], custom: null }
    })

    backend.emit({
      type: 'question.asked',
      question: question('q2', 's1', { allowCustom: true })
    })
    controller.handleKey(key('e'))
    type(controller, 'custom answer')
    controller.handleKey(key('return'))
    await flush()
    expect(backend.questionReplies[1]).toEqual({
      id: 'q2',
      answer: { selected: [], custom: 'custom answer' }
    })

    backend.emit({ type: 'question.asked', question: question('q3', 's1') })
    controller.handleKey({ name: '2', sequence: '2' })
    await flush()
    expect(backend.questionReplies[2]).toEqual({
      id: 'q3',
      answer: { selected: ['B'], custom: null }
    })

    backend.emit({ type: 'question.asked', question: question('q4', 's1') })
    controller.handleKey(key('escape'))
    await flush()
    expect(backend.questionReplies[3]).toEqual({
      id: 'q4',
      answer: { selected: [], custom: null, cancelled: true }
    })
    expect(controller.state.overlay).toBeNull()
  })

  it('clears input, stops a run, then quits on repeated Ctrl-C', async () => {
    const backend = new FakeBackend()
    backend.sessions = [session('s1', '2026-01-01T00:00:00.000Z', { status: 'running' })]
    backend.snapshots.set('s1', {
      ...emptySnapshot('s1'),
      running: true,
      messages: [
        message('a1', 's1', 'assistant', [{ type: 'text', text: 'working' }], {
          status: 'streaming'
        })
      ]
    })
    let quits = 0
    const controller = await started(backend, { onQuit: () => (quits += 1) })

    type(controller, 'draft')
    controller.handleKey(key('c', { ctrl: true }))
    expect(backend.stopped).toEqual(['s1'])
    expect(controller.state.input).toBe('draft')
    expect(quits).toBe(0)

    backend.emit({
      type: 'run.finished',
      sessionId: 's1',
      messageId: 'a1',
      status: 'interrupted'
    })
    controller.handleKey(key('c', { ctrl: true }))
    expect(controller.state.input).toBe('')
    expect(quits).toBe(0)

    controller.handleKey(key('c', { ctrl: true }))
    expect(quits).toBe(1)
    expect(controller.state.quitting).toBe(true)
  })

  it('retries only when the last assistant message failed', async () => {
    const backend = new FakeBackend()
    backend.sessions = [session('s1', '2026-01-01T00:00:00.000Z')]
    backend.snapshots.set('s1', {
      ...emptySnapshot('s1'),
      messages: [
        message('u1', 's1', 'user', [{ type: 'text', text: 'hi' }]),
        message('a1', 's1', 'assistant', [{ type: 'text', text: '' }], {
          status: 'error',
          error: 'boom'
        })
      ]
    })
    const controller = await started(backend)

    controller.handleKey(key('r', { ctrl: true }))
    await flush()
    expect(backend.retried).toEqual(['s1'])

    backend.snapshots.set('s1', {
      ...emptySnapshot('s1'),
      messages: [message('a2', 's1', 'assistant', [{ type: 'text', text: 'done' }])]
    })
    await controller.shutdown()
    const clean = await started(backend)
    clean.handleKey(key('r', { ctrl: true }))
    expect(backend.retried).toEqual(['s1'])
    expect(clean.state.notice).toBe('没有可重试的失败消息')
  })

  it('switches sessions from the session list', async () => {
    const backend = new FakeBackend()
    backend.sessions = [
      session('a', '2026-01-01T00:00:00.000Z'),
      session('b', '2026-01-02T00:00:00.000Z')
    ]
    const controller = await started(backend)
    expect(controller.state.currentId).toBe('b')

    controller.handleKey(key('tab'))
    expect(controller.state.focus).toBe('sessions')
    controller.handleKey(key('down'))
    controller.handleKey(key('return'))
    await flush()
    expect(controller.state.currentId).toBe('a')
    expect(controller.state.focus).toBe('input')
  })

  it('sends, restores a failed message and reports steering', async () => {
    const backend = new FakeBackend()
    backend.sessions = [session('s1', '2026-01-01T00:00:00.000Z')]
    const controller = await started(backend)

    type(controller, 'hello')
    controller.handleKey(key('return'))
    await flush()
    expect(backend.sent).toEqual([{ id: 's1', text: 'hello' }])
    expect(controller.state.input).toBe('')

    backend.sendError = new Error('boom')
    type(controller, 'again')
    controller.handleKey(key('return'))
    await flush()
    expect(controller.state.error).toBe('boom')
    expect(controller.state.input).toBe('again')

    backend.sendError = null
    backend.sendResult = 'steered'
    controller.handleKey(key('return'))
    await flush()
    expect(controller.state.notice).toBe('会话正忙，消息已排队')
  })

  it('reloads snapshots after a reconnect', async () => {
    const backend = new FakeBackend()
    backend.sessions = [session('s1', '2026-01-01T00:00:00.000Z')]
    const controller = await started(backend)

    backend.sessions.push(session('s2', '2026-01-03T00:00:00.000Z'))
    backend.snapshots.set('s1', {
      ...emptySnapshot('s1'),
      messages: [message('u2', 's1', 'user', [{ type: 'text', text: 'missed' }])]
    })
    backend.resync()
    await flush()

    expect(controller.state.notice).toBe('连接已恢复')
    expect(controller.state.sessions.map((item) => item.id)).toEqual(['s2', 's1'])
    expect(controller.state.messages[0].parts).toEqual([{ type: 'text', text: 'missed' }])
  })

  it('shuts the backend down once', async () => {
    const backend = new FakeBackend()
    backend.sessions = [session('s1', '2026-01-01T00:00:00.000Z')]
    const controller = await started(backend)
    await controller.shutdown()
    await controller.shutdown()
    expect(backend.shutdowns).toBe(1)
  })
})
