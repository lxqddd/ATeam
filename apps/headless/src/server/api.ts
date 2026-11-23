import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type {
  AgentEvent,
  AgentEventEnvelope,
  MessageAttachment,
  MessagesSnapshot,
  ModelRef,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  ReasoningEffort,
  SessionMeta,
  SessionSettings
} from '@ateam/shared'
import { PERMISSION_MODES, REASONING_EFFORTS } from '@ateam/shared'
import type { EventBus } from './event-bus'

export interface ApiRuntime {
  listSessions(): SessionMeta[]
  createSession(): Promise<SessionMeta>
  renameSession(id: string, title: string): Promise<SessionMeta>
  setSessionModel(id: string, model: ModelRef | null): Promise<SessionMeta>
  setSessionAgent(id: string, agent: string | null): Promise<SessionMeta>
  setSessionSettings(id: string, settings: SessionSettings): Promise<SessionMeta>
  messages(id: string): MessagesSnapshot
  sendChat(
    id: string,
    text: string,
    model?: ModelRef | null,
    attachments?: MessageAttachment[]
  ): Promise<void>
  stopChat(id: string): void
  deleteSession(id: string): Promise<void>
  compactSession(id: string, options?: { force?: boolean }): Promise<SessionMeta>
  permissions(): PermissionRequest[]
  replyPermission(id: string, decision: PermissionDecision): void
  questions(): QuestionRequest[]
  replyQuestion(id: string, answer: QuestionAnswer): void
}

export interface ApiServerOptions {
  runtime: ApiRuntime
  bus: EventBus
  token?: string | null
  version?: string
  host?: string
  port?: number
  /** Only set when a browser client on another origin must be allowed. */
  corsOrigin?: string | null
  allowUnauthenticatedRemote?: boolean
  defaults?: {
    permissionMode?: PermissionMode
    reasoningEffort?: ReasoningEffort | null
    agent?: string | null
  }
}

export interface ApiServer {
  listen(): Promise<{ host: string; port: number }>
  close(): Promise<void>
  url(): string
}

const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/
const MAX_BODY_BYTES = 1_000_000

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('SESSION_NOT_FOUND')) return 404
  if (message.includes('SESSION_BUSY')) return 409
  if (message.includes('AGENT_NOT_READY')) return 503
  if (message.includes('Timed out waiting')) return 504
  return 400
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(raw) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('Request body must be a JSON object'))
          return
        }
        resolve(parsed as Record<string, unknown>)
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function stringValue(value: unknown, name: string, max = 100_000): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  if (value.length > max) throw new Error(`${name} is too long`)
  return value
}

function modelRef(value: unknown): ModelRef | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') throw new Error('model must be an object or null')
  const raw = value as Record<string, unknown>
  if (typeof raw.providerId !== 'string' || typeof raw.modelId !== 'string') {
    throw new Error('model requires providerId and modelId')
  }
  const variant = typeof raw.variant === 'string' ? raw.variant : null
  return {
    providerId: raw.providerId,
    modelId: raw.modelId,
    ...(variant ? { variant } : {})
  }
}

function eventSessionId(event: AgentEvent): string | null {
  switch (event.type) {
    case 'session.upsert':
      return event.session.id
    case 'permission.asked':
      return event.permission.sessionId
    case 'question.asked':
      return event.question.sessionId
    case 'subagent.finished':
      return event.parentSessionId
    default:
      return 'sessionId' in event ? event.sessionId : null
  }
}

function sessionIdFrom(value: string): string {
  const id = decodeURIComponent(value)
  if (!SESSION_ID.test(id)) throw new Error('Invalid session id')
  return id
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  const {
    runtime,
    bus,
    token = null,
    version = '0.1.0',
    port = 0,
    defaults = {},
    corsOrigin = null,
    allowUnauthenticatedRemote = false
  } = options
  const sseClients = new Set<ServerResponse>()
  const host = options.host ?? '127.0.0.1'
  let actualPort = 0

  const authorized = (req: IncomingMessage, pathname: string, url: URL): boolean => {
    if (!token) return true
    if (req.headers.authorization === `Bearer ${token}`) return true
    return pathname === '/events' && url.searchParams.get('token') === token
  }

  const withSession = (id: string): SessionMeta => {
    const session = runtime.listSessions().find((candidate) => candidate.id === id)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    return session
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${actualPort}`)
    const pathname = url.pathname.replace(/^\/v1(?=\/|$)/, '') || '/'
    if (corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin)
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (pathname === '/health') {
      json(res, 200, { ok: true, version })
      return
    }
    if (!authorized(req, pathname, url)) {
      json(res, 401, { error: 'Unauthorized' })
      return
    }

    try {
      if (pathname === '/events' && req.method === 'GET') {
        const filter = url.searchParams.get('sessionId')
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {})
        })
        res.write(': connected\n\n')
        sseClients.add(res)
        const unsubscribe = bus.subscribe((envelope: AgentEventEnvelope) => {
          if (filter && eventSessionId(envelope.event) !== filter) return
          res.write(`data: ${JSON.stringify(envelope)}\n\n`)
        })
        const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000)
        const cleanup = (): void => {
          clearInterval(heartbeat)
          unsubscribe()
          sseClients.delete(res)
        }
        req.on('close', cleanup)
        res.on('close', cleanup)
        return
      }

      if (pathname === '/sessions' && req.method === 'GET') {
        json(res, 200, runtime.listSessions())
        return
      }

      if (pathname === '/sessions' && req.method === 'POST') {
        const body = await readJson(req)
        let session = await runtime.createSession()
        if (body.title !== undefined) {
          session = await runtime.renameSession(
            session.id,
            stringValue(body.title, 'title', 200).trim()
          )
        }
        const permissionMode =
          body.permissionMode === undefined
            ? (defaults.permissionMode ?? 'ask')
            : stringValue(body.permissionMode, 'permissionMode', 20)
        if (!PERMISSION_MODES.includes(permissionMode as PermissionMode)) {
          throw new Error(`permissionMode must be one of: ${PERMISSION_MODES.join(', ')}`)
        }
        const reasoningEffort: ReasoningEffort | null =
          body.reasoningEffort === undefined
            ? (defaults.reasoningEffort ?? null)
            : (body.reasoningEffort as ReasoningEffort | null)
        if (reasoningEffort !== null && !REASONING_EFFORTS.includes(reasoningEffort)) {
          throw new Error(`reasoningEffort must be one of: ${REASONING_EFFORTS.join(', ')}`)
        }
        session = await runtime.setSessionSettings(session.id, {
          permissionMode: permissionMode as PermissionMode,
          reasoningEffort
        })
        const agent =
          body.agent === undefined ? (defaults.agent ?? null) : (body.agent as string | null)
        if (agent !== null && typeof agent !== 'string') throw new Error('agent must be a string')
        if (agent) session = await runtime.setSessionAgent(session.id, agent)
        if (body.model !== undefined) {
          session = await runtime.setSessionModel(session.id, modelRef(body.model))
        }
        json(res, 201, session)
        return
      }

      const sessionMatch = /^\/sessions\/([^/]+)(?:\/([^/]+))?$/.exec(pathname)
      if (sessionMatch) {
        const id = sessionIdFrom(sessionMatch[1])
        const action = sessionMatch[2]

        if (!action && req.method === 'GET') {
          json(res, 200, withSession(id))
          return
        }
        if (!action && req.method === 'DELETE') {
          await runtime.deleteSession(id)
          json(res, 200, { deleted: true })
          return
        }
        if (action === 'messages' && req.method === 'GET') {
          json(res, 200, runtime.messages(id))
          return
        }
        if (action === 'messages' && req.method === 'POST') {
          const body = await readJson(req)
          const text = stringValue(body.text, 'text')
          const wait = body.wait === true
          const controller = new AbortController()
          const finished = wait
            ? bus.waitFor(
                'run.finished',
                (event) => event.type === 'run.finished' && event.sessionId === id,
                10 * 60_000,
                controller.signal
              )
            : null
          if (finished) res.once('close', () => controller.abort())
          try {
            await runtime.sendChat(id, text, modelRef(body.model))
          } catch (error) {
            controller.abort()
            if (finished) await finished.catch(() => undefined)
            throw error
          }
          if (!finished) {
            json(res, 202, { sessionId: id, queued: true })
            return
          }
          const envelope = await finished.catch((error) => {
            if (controller.signal.aborted) return null
            throw error
          })
          if (!envelope) return
          const event = envelope.event
          const status = event.type === 'run.finished' ? event.status : 'completed'
          json(res, 200, {
            sessionId: id,
            status,
            error: event.type === 'run.finished' ? event.error : undefined,
            messages: runtime.messages(id)
          })
          return
        }
        if (action === 'stop' && req.method === 'POST') {
          runtime.stopChat(id)
          json(res, 202, { stopped: true })
          return
        }
        if (action === 'compact' && req.method === 'POST') {
          const body = await readJson(req)
          json(res, 200, await runtime.compactSession(id, { force: body.force === true }))
          return
        }
      }

      if (pathname === '/permissions' && req.method === 'GET') {
        json(res, 200, runtime.permissions())
        return
      }
      const permissionMatch = /^\/permissions\/([^/]+)$/.exec(pathname)
      if (permissionMatch && req.method === 'POST') {
        const body = await readJson(req)
        const decision = body.decision
        if (decision !== 'once' && decision !== 'always' && decision !== 'reject') {
          throw new Error('decision must be once, always or reject')
        }
        runtime.replyPermission(decodeURIComponent(permissionMatch[1]), decision)
        json(res, 200, { ok: true })
        return
      }

      if (pathname === '/questions' && req.method === 'GET') {
        json(res, 200, runtime.questions())
        return
      }
      const questionMatch = /^\/questions\/([^/]+)$/.exec(pathname)
      if (questionMatch && req.method === 'POST') {
        const body = await readJson(req)
        const answer = body.answer
        if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
          throw new Error('answer must be an object')
        }
        const raw = answer as Record<string, unknown>
        const selected = Array.isArray(raw.selected)
          ? raw.selected.filter((entry): entry is string => typeof entry === 'string')
          : []
        const custom = typeof raw.custom === 'string' ? raw.custom : null
        runtime.replyQuestion(decodeURIComponent(questionMatch[1]), {
          selected,
          custom,
          ...(raw.cancelled === true ? { cancelled: true } : {}),
          ...(raw.timedOut === true ? { timedOut: true } : {})
        })
        json(res, 200, { ok: true })
        return
      }

      json(res, 404, { error: 'Not found' })
    } catch (error) {
      json(res, errorStatus(error), {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  return {
    listen: () => {
      const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
      if (!loopback && !token && !allowUnauthenticatedRemote) {
        return Promise.reject(new Error('AUTH_REQUIRED_FOR_REMOTE_BIND'))
      }
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.removeListener('error', reject)
          const address = server.address()
          actualPort = typeof address === 'object' && address ? address.port : 0
          resolve({ host, port: actualPort })
        })
      })
    },
    close: async () => {
      for (const client of sseClients) client.end()
      sseClients.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
    url: () => `http://${host}:${actualPort}`
  }
}
