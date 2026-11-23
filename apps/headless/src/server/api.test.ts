import type {
  AgentEvent,
  MessagesSnapshot,
  ModelRef,
  PermissionDecision,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  SessionMeta,
  SessionSettings
} from '@ateam/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { makeSession } from '@ateam/agent-core/testing'
import { createApiServer, type ApiRuntime } from './api'
import { EventBus } from './event-bus'

class FakeRuntime implements ApiRuntime {
  sessions = new Map<string, SessionMeta>()
  snapshots = new Map<string, MessagesSnapshot>()
  permissionsList: PermissionRequest[] = []
  questionsList: QuestionRequest[] = []
  decisions: Array<{ id: string; decision: PermissionDecision }> = []
  answers: Array<{ id: string; answer: QuestionAnswer }> = []
  sent: Array<{ id: string; text: string; model?: ModelRef | null }> = []
  sendError: Error | null = null
  stopped: string[] = []
  private seq = 0

  constructor(private readonly bus: EventBus) {}

  listSessions(): SessionMeta[] {
    return [...this.sessions.values()]
  }

  async createSession(): Promise<SessionMeta> {
    const session = makeSession({ model: null, status: 'idle' })
    this.sessions.set(session.id, session)
    this.snapshots.set(session.id, { sessionId: session.id, seq: 0, messages: [], running: false })
    return { ...session }
  }

  async renameSession(id: string, title: string): Promise<SessionMeta> {
    const session = this.get(id)
    session.title = title
    return { ...session }
  }

  async setSessionModel(id: string, model: ModelRef | null): Promise<SessionMeta> {
    const session = this.get(id)
    session.model = model
    return { ...session }
  }

  async setSessionAgent(id: string, agent: string | null): Promise<SessionMeta> {
    const session = this.get(id)
    session.agent = agent
    return { ...session }
  }

  async setSessionSettings(id: string, settings: SessionSettings): Promise<SessionMeta> {
    const session = this.get(id)
    session.permissionMode = settings.permissionMode
    session.reasoningEffort = settings.reasoningEffort
    return { ...session }
  }

  messages(id: string): MessagesSnapshot {
    this.get(id)
    return this.snapshots.get(id) ?? { sessionId: id, seq: 0, messages: [], running: false }
  }

  async sendChat(id: string, text: string, model?: ModelRef | null): Promise<void> {
    this.get(id)
    if (this.sendError) throw this.sendError
    this.sent.push({ id, text, model })
    const event: AgentEvent = {
      type: 'run.finished',
      sessionId: id,
      messageId: 'assistant-1',
      status: 'completed'
    }
    queueMicrotask(() => {
      this.bus.publish({ seq: ++this.seq, at: new Date().toISOString(), event })
    })
  }

  stopChat(id: string): void {
    this.stopped.push(id)
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id)
    this.snapshots.delete(id)
  }

  async compactSession(id: string): Promise<SessionMeta> {
    return { ...this.get(id), compaction: null }
  }

  permissions(): PermissionRequest[] {
    return this.permissionsList
  }

  replyPermission(id: string, decision: PermissionDecision): void {
    this.decisions.push({ id, decision })
  }

  questions(): QuestionRequest[] {
    return this.questionsList
  }

  replyQuestion(id: string, answer: QuestionAnswer): void {
    this.answers.push({ id, answer })
  }

  private get(id: string): SessionMeta {
    const session = this.sessions.get(id)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    return session
  }
}

let api: ReturnType<typeof createApiServer> | null = null

async function start(token: string | null = null): Promise<{
  baseUrl: string
  runtime: FakeRuntime
  bus: EventBus
}> {
  const bus = new EventBus()
  const runtime = new FakeRuntime(bus)
  api = createApiServer({ runtime, bus, token, port: 0 })
  const address = await api.listen()
  return { baseUrl: `http://${address.host}:${address.port}`, runtime, bus }
}

afterEach(async () => {
  await api?.close()
  api = null
})

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

describe('API server', () => {
  it('serves health without auth and protects other routes', async () => {
    const { baseUrl } = await start('secret')

    expect(await (await fetch(`${baseUrl}/health`)).json()).toMatchObject({ ok: true })
    expect(await (await fetch(`${baseUrl}/v1/health`)).json()).toMatchObject({ ok: true })
    expect((await fetch(`${baseUrl}/sessions`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/v1/sessions`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/sessions`, { headers: auth('secret') })).status).toBe(200)
  })

  it('does not grant cross-origin access by default', async () => {
    const { baseUrl } = await start()
    const response = await fetch(`${baseUrl}/health`)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()

    const preflight = await fetch(`${baseUrl}/sessions`, { method: 'OPTIONS' })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses to bind a remote host without a token', async () => {
    const bus = new EventBus()
    const runtime = new FakeRuntime(bus)
    const server = createApiServer({ runtime, bus, host: '0.0.0.0', port: 0 })
    await expect(server.listen()).rejects.toThrow('AUTH_REQUIRED_FOR_REMOTE_BIND')
  })

  it('creates sessions with settings and returns them', async () => {
    const { baseUrl } = await start('secret')
    const created = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'API session',
        permissionMode: 'acceptEdits',
        reasoningEffort: 'low',
        agent: 'plan',
        model: { providerId: 'p1', modelId: 'm1', variant: 'high' }
      })
    })
    const session = (await created.json()) as { id: string }

    expect(created.status).toBe(201)
    expect(session).toMatchObject({
      title: 'API session',
      permissionMode: 'acceptEdits',
      reasoningEffort: 'low',
      agent: 'plan',
      model: { providerId: 'p1', modelId: 'm1', variant: 'high' }
    })
    expect(
      await (await fetch(`${baseUrl}/sessions/${session.id}`, { headers: auth('secret') })).json()
    ).toMatchObject({ id: session.id })

    const deleted = await fetch(`${baseUrl}/sessions/${session.id}`, {
      method: 'DELETE',
      headers: auth('secret')
    })
    expect(deleted.status).toBe(200)
    expect(await (await fetch(`${baseUrl}/sessions`, { headers: auth('secret') })).json()).toEqual(
      []
    )
  })

  it('starts messages and optionally waits for completion', async () => {
    const { baseUrl, runtime } = await start('secret')
    const session = await runtime.createSession()

    const queued = await fetch(`${baseUrl}/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' })
    })
    expect(queued.status).toBe(202)

    const waited = await fetch(`${baseUrl}/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello again', wait: true })
    })
    const result = await waited.json()
    expect(result).toMatchObject({ sessionId: session.id, status: 'completed' })
    expect(runtime.sent.map((entry) => entry.text)).toEqual(['hello', 'hello again'])
  })

  it('maps busy sessions to 409 without leaking the wait promise', async () => {
    const { baseUrl, runtime } = await start('secret')
    const session = await runtime.createSession()
    runtime.sendError = new Error('SESSION_BUSY')

    const response = await fetch(`${baseUrl}/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello', wait: true })
    })

    expect(response.status).toBe(409)
  })

  it('stops and compacts sessions', async () => {
    const { baseUrl, runtime } = await start('secret')
    const session = await runtime.createSession()

    expect(
      (
        await fetch(`${baseUrl}/sessions/${session.id}/stop`, {
          method: 'POST',
          headers: auth('secret')
        })
      ).status
    ).toBe(202)
    expect(runtime.stopped).toEqual([session.id])

    expect(
      (
        await fetch(`${baseUrl}/sessions/${session.id}/compact`, {
          method: 'POST',
          headers: { ...auth('secret'), 'content-type': 'application/json' },
          body: JSON.stringify({ force: true })
        })
      ).status
    ).toBe(200)
  })

  it('lists and replies to permissions and questions', async () => {
    const { baseUrl, runtime } = await start('secret')
    runtime.permissionsList = [
      {
        id: 'perm-1',
        sessionId: 's1',
        messageId: 'm1',
        toolCallId: 'c1',
        action: 'shell',
        resource: 'ls',
        toolName: 'shell',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    runtime.questionsList = [
      {
        id: 'q1',
        sessionId: 's1',
        messageId: 'm1',
        toolCallId: 'c1',
        header: 'Pick',
        question: 'Continue?',
        options: [{ label: 'yes' }],
        multiple: false,
        allowCustom: false,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]

    expect(
      await (await fetch(`${baseUrl}/permissions`, { headers: auth('secret') })).json()
    ).toHaveLength(1)
    await fetch(`${baseUrl}/permissions/perm-1`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'always' })
    })
    expect(runtime.decisions).toEqual([{ id: 'perm-1', decision: 'always' }])

    expect(
      await (await fetch(`${baseUrl}/questions`, { headers: auth('secret') })).json()
    ).toHaveLength(1)
    await fetch(`${baseUrl}/questions/q1`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ answer: { selected: ['yes'], custom: null } })
    })
    expect(runtime.answers[0]).toMatchObject({ id: 'q1', answer: { selected: ['yes'] } })
  })

  it('streams events over SSE with a token query', async () => {
    const { baseUrl, bus } = await start('secret')
    const controller = new AbortController()
    const response = await fetch(`${baseUrl}/events?token=secret`, {
      signal: controller.signal
    })
    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('missing body')

    const decoder = new TextDecoder()
    let buffer = ''
    const initial = await reader.read()
    if (!initial.done) buffer += decoder.decode(initial.value, { stream: true })
    bus.publish({
      seq: 1,
      at: '2026-01-01T00:00:00.000Z',
      event: { type: 'run.finished', sessionId: 's1', messageId: 'm1', status: 'completed' }
    })
    while (!buffer.includes('run.finished')) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
    }
    controller.abort()
    await reader.cancel().catch(() => undefined)
    expect(buffer).toContain('run.finished')
  })

  it('rejects unknown sessions and invalid bodies', async () => {
    const { baseUrl } = await start('secret')

    const missing = await fetch(`${baseUrl}/sessions/does-not-exist`, {
      headers: auth('secret')
    })
    expect(missing.status).toBe(404)

    const invalid = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ permissionMode: 'invalid' })
    })
    expect(invalid.status).toBe(400)
  })
})
