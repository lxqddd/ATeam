import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { makeSession } from '@ateam/agent-core/testing'
import type { AgentEvent, AgentEventEnvelope } from '@ateam/shared'
import { AttachClient, AttachError, AttachTuiBackend } from './attach'
import type { TuiBackendListener } from './backend'

const NOW = '2026-01-01T00:00:00.000Z'

interface RecordedRequest {
  method: string
  path: string
  auth: string | undefined
  body: unknown
}

class TestServer {
  readonly requests: RecordedRequest[] = []
  busy = false
  url = ''
  private readonly server: Server
  private readonly streams = new Set<ServerResponse>()

  constructor() {
    this.server = createServer((request, response) => {
      void this.handle(request, response)
    })
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    this.url = `http://127.0.0.1:${address.port}`
  }

  sendEvent(event: AgentEvent): void {
    const envelope: AgentEventEnvelope = { seq: 1, at: NOW, event }
    for (const response of this.streams) {
      response.write(`data: ${JSON.stringify(envelope)}\n\n`)
    }
  }

  sendRaw(data: string): void {
    for (const response of this.streams) response.write(data)
  }

  endStreams(): void {
    for (const response of this.streams) response.end()
    this.streams.clear()
  }

  async close(): Promise<void> {
    this.endStreams()
    this.server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const body = await this.readBody(request)
    const method = request.method ?? 'GET'
    this.requests.push({
      method,
      path: url.pathname,
      auth: request.headers.authorization,
      body
    })

    if (url.pathname === '/health') {
      this.json(response, 200, { ok: true, version: 'test' })
      return
    }
    if (url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      response.flushHeaders()
      this.streams.add(response)
      request.on('close', () => this.streams.delete(response))
      return
    }
    if (url.pathname === '/sessions' && method === 'GET') {
      this.json(response, 200, [makeSession({ id: 's1', title: 'one', updatedAt: NOW })])
      return
    }
    if (url.pathname === '/sessions' && method === 'POST') {
      this.json(response, 201, makeSession({ id: 'created' }))
      return
    }
    if (url.pathname === '/sessions/s1/messages' && method === 'GET') {
      this.json(response, 200, { sessionId: 's1', seq: 0, messages: [], running: false })
      return
    }
    if (url.pathname === '/sessions/s1/messages' && method === 'POST') {
      if (this.busy) {
        this.json(response, 409, { error: 'SESSION_BUSY' })
        return
      }
      this.json(response, 202, { started: true })
      return
    }
    if (url.pathname === '/sessions/s1/steer' && method === 'POST') {
      this.json(response, 202, { queued: true })
      return
    }
    if (url.pathname === '/sessions/s1/stop' && method === 'POST') {
      this.json(response, 202, { stopped: true })
      return
    }
    if (url.pathname === '/sessions/s1/retry' && method === 'POST') {
      this.json(response, 202, { retried: true })
      return
    }
    if (url.pathname === '/permissions') {
      this.json(response, 200, [])
      return
    }
    if (url.pathname === '/questions') {
      this.json(response, 200, [])
      return
    }
    if (url.pathname === '/permissions/p1' && method === 'POST') {
      this.json(response, 200, { replied: true })
      return
    }
    if (url.pathname === '/permissions/missing') {
      this.json(response, 404, { error: '权限请求不存在' })
      return
    }
    this.json(response, 404, { error: `no route ${method} ${url.pathname}` })
  }

  private readBody(request: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (!text) {
          resolve(null)
          return
        }
        try {
          resolve(JSON.parse(text))
        } catch {
          resolve(text)
        }
      })
      request.on('error', reject)
    })
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body)
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(text)
    })
    response.end(text)
  }
}

const servers: TestServer[] = []
const backends: AttachTuiBackend[] = []

async function start(): Promise<TestServer> {
  const server = new TestServer()
  await server.listen()
  servers.push(server)
  return server
}

function backend(server: TestServer, token: string | null = null): AttachTuiBackend {
  const instance = new AttachTuiBackend({
    baseUrl: server.url,
    token,
    reconnectDelayMs: 5
  })
  backends.push(instance)
  return instance
}

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

afterEach(async () => {
  await Promise.all(backends.splice(0).map((instance) => instance.shutdown()))
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('AttachClient', () => {
  it('sends the token and parses responses', async () => {
    const server = await start()
    const client = new AttachClient({ baseUrl: `${server.url}/`, token: 'secret' })

    expect(await client.health()).toEqual({ ok: true, version: 'test' })
    expect(server.requests[0].auth).toBe('Bearer secret')
    expect(await client.listSessions()).toHaveLength(1)
    expect(await client.messages('s1')).toMatchObject({ sessionId: 's1', running: false })
    await client.replyPermission('p1', 'once')
    expect(server.requests.at(-1)?.body).toEqual({ decision: 'once' })
  })

  it('maps HTTP errors to AttachError with the status and message', async () => {
    const server = await start()
    const client = new AttachClient({ baseUrl: server.url, token: null })
    await expect(client.replyPermission('missing', 'reject')).rejects.toMatchObject({
      name: 'AttachError',
      status: 404,
      message: '权限请求不存在'
    })
    const error = await client
      .replyPermission('missing', 'reject')
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(AttachError)
  })
})

describe('AttachTuiBackend', () => {
  it('creates sessions, sends, steers on 409, stops and retries', async () => {
    const server = await start()
    const instance = backend(server)
    await instance.init()

    await instance.createSession({
      permissionMode: 'ask',
      reasoningEffort: 'high',
      agent: null,
      model: null
    })
    expect(server.requests.find((request) => request.method === 'POST')?.body).toEqual({
      permissionMode: 'ask',
      reasoningEffort: 'high'
    })

    expect(await instance.sendChat('s1', 'hello')).toBe('sent')
    server.busy = true
    expect(await instance.sendChat('s1', 'again')).toBe('steered')
    expect(server.requests.find((request) => request.path === '/sessions/s1/steer')?.body).toEqual({
      text: 'again'
    })

    await instance.stopChat('s1')
    await instance.retryChat('s1')
    expect(server.requests.some((request) => request.path.endsWith('/stop'))).toBe(true)
    expect(server.requests.some((request) => request.path.endsWith('/retry'))).toBe(true)
  })

  it('streams events, ignores malformed frames and resyncs after a drop', async () => {
    const server = await start()
    const instance = backend(server)
    await instance.init()
    const events: AgentEvent[] = []
    let resyncs = 0
    const listener: TuiBackendListener = {
      event: (event) => events.push(event),
      resync: () => {
        resyncs += 1
      }
    }
    const unsubscribe = instance.subscribe(listener)

    await until(() => server.requests.some((request) => request.path === '/events'))
    await until(() => server.requests.filter((request) => request.path === '/events').length === 1)

    server.sendRaw('data: not-json\n\n')
    server.sendEvent({ type: 'run.started', sessionId: 's1', messageId: 'a1', startedAt: NOW })
    await until(() => events.length === 1)
    expect(events[0]).toMatchObject({ type: 'run.started', sessionId: 's1' })

    server.endStreams()
    await until(() => resyncs === 1)
    unsubscribe()
    await until(() => server.requests.filter((request) => request.path === '/events').length >= 2)
    await instance.shutdown()
    const requestsAfterShutdown = server.requests.length
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(server.requests.length).toBe(requestsAfterShutdown)
  })

  it('shuts down idempotently', async () => {
    const server = await start()
    const instance = backend(server)
    await instance.init()
    await until(() => server.requests.some((request) => request.path === '/events'))
    await instance.shutdown()
    await instance.shutdown()
    expect(server.requests.filter((request) => request.path === '/events')).toHaveLength(1)
  })
})
