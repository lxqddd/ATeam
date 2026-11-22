import type {
  AgentEventEnvelope,
  MessagesSnapshot,
  ModelRef,
  PermissionDecision,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  SessionMeta
} from '@ateam/shared'

export interface AteamClientOptions {
  baseUrl: string
  token?: string | null
  fetch?: typeof fetch
}

export interface CreateSessionInput {
  title?: string
  agent?: string | null
  model?: ModelRef | null
  permissionMode?: string
  reasoningEffort?: string | null
}

export interface SendMessageInput {
  text: string
  model?: ModelRef | null
  wait?: boolean
}

export type SendMessageResult =
  | { sessionId: string; queued: true }
  | {
      sessionId: string
      status: string
      error?: string
      messages: MessagesSnapshot
    }

export class AteamApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message)
    this.name = 'AteamApiError'
  }
}

export class AteamClient {
  private readonly baseUrl: string
  private readonly token: string | null
  private readonly fetchImpl: typeof fetch

  constructor(options: AteamClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token ?? null
    this.fetchImpl = options.fetch ?? fetch
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...((init.headers as Record<string, string> | undefined) ?? {})
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers })
    const text = await response.text()
    let body: unknown = null
    if (text.trim()) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : `HTTP ${response.status}`
      throw new AteamApiError(message, response.status, body)
    }
    return body as T
  }

  health(): Promise<{ ok: boolean; version: string }> {
    return this.request('/health')
  }

  listSessions(): Promise<SessionMeta[]> {
    return this.request('/sessions')
  }

  createSession(input: CreateSessionInput = {}): Promise<SessionMeta> {
    return this.request('/sessions', { method: 'POST', body: JSON.stringify(input) })
  }

  getSession(id: string): Promise<SessionMeta> {
    return this.request(`/sessions/${encodeURIComponent(id)}`)
  }

  deleteSession(id: string): Promise<{ deleted: boolean }> {
    return this.request(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  getMessages(id: string): Promise<MessagesSnapshot> {
    return this.request(`/sessions/${encodeURIComponent(id)}/messages`)
  }

  sendMessage(id: string, input: SendMessageInput): Promise<SendMessageResult> {
    return this.request(`/sessions/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify(input)
    })
  }

  stopSession(id: string): Promise<{ stopped: boolean }> {
    return this.request(`/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST' })
  }

  compactSession(id: string, force = false): Promise<SessionMeta> {
    return this.request(`/sessions/${encodeURIComponent(id)}/compact`, {
      method: 'POST',
      body: JSON.stringify({ force })
    })
  }

  listPermissions(): Promise<PermissionRequest[]> {
    return this.request('/permissions')
  }

  replyPermission(id: string, decision: PermissionDecision): Promise<{ ok: boolean }> {
    return this.request(`/permissions/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ decision })
    })
  }

  listQuestions(): Promise<QuestionRequest[]> {
    return this.request('/questions')
  }

  replyQuestion(id: string, answer: QuestionAnswer): Promise<{ ok: boolean }> {
    return this.request(`/questions/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ answer })
    })
  }

  /** Stream Server-Sent Events until the stream closes or the signal aborts. */
  async events(
    onEvent: (envelope: AgentEventEnvelope) => void,
    options: { sessionId?: string; signal?: AbortSignal } = {}
  ): Promise<void> {
    const query = options.sessionId ? `?sessionId=${encodeURIComponent(options.sessionId)}` : ''
    const response = await this.fetchImpl(`${this.baseUrl}/events${query}`, {
      headers: {
        Accept: 'text/event-stream',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      signal: options.signal
    })
    if (!response.ok || !response.body) {
      throw new AteamApiError(`HTTP ${response.status}`, response.status, null)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (!data) continue
          try {
            onEvent(JSON.parse(data) as AgentEventEnvelope)
          } catch {
            /* ignore malformed events */
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
    await reader.cancel().catch(() => undefined)
  }
}
