import type {
  AgentEventEnvelope,
  MessagesSnapshot,
  ModelRef,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  ReasoningEffort,
  SessionMeta
} from '@ateam/shared'
import type { TuiBackend, TuiBackendListener, TuiNewSession } from './backend'

/** HTTP failure with the status code, so a busy session can be steered. */
export class AttachError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'AttachError'
  }
}

interface AttachClientOptions {
  baseUrl: string
  token: string | null
}

function jsonHeaders(token: string | null, body: boolean): Record<string, string> {
  return {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

/**
 * Minimal HTTP/SSE client for the headless server. Kept local to the TUI so the
 * CLI does not need a built copy of `@ateam/client-sdk`.
 */
export class AttachClient {
  private readonly baseUrl: string
  private readonly token: string | null

  constructor(options: AttachClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...jsonHeaders(this.token, Boolean(init.body)), ...(init.headers ?? {}) }
    })
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
      throw new AttachError(message, response.status)
    }
    return body as T
  }

  health(): Promise<{ ok: boolean; version: string }> {
    return this.request('/health', { signal: AbortSignal.timeout(5_000) })
  }

  listSessions(): Promise<SessionMeta[]> {
    return this.request('/sessions')
  }

  createSession(input: {
    permissionMode: PermissionMode
    reasoningEffort: ReasoningEffort | null
    agent: string | null
    model: ModelRef | null
  }): Promise<SessionMeta> {
    return this.request('/sessions', {
      method: 'POST',
      body: JSON.stringify({
        permissionMode: input.permissionMode,
        reasoningEffort: input.reasoningEffort,
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.model ? { model: input.model } : {})
      })
    })
  }

  messages(id: string): Promise<MessagesSnapshot> {
    return this.request(`/sessions/${encodeURIComponent(id)}/messages`)
  }

  send(id: string, text: string): Promise<unknown> {
    return this.request(`/sessions/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text })
    })
  }

  steer(id: string, text: string): Promise<unknown> {
    return this.request(`/sessions/${encodeURIComponent(id)}/steer`, {
      method: 'POST',
      body: JSON.stringify({ text })
    })
  }

  stop(id: string): Promise<unknown> {
    return this.request(`/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST' })
  }

  retry(id: string): Promise<unknown> {
    return this.request(`/sessions/${encodeURIComponent(id)}/retry`, { method: 'POST' })
  }

  listPermissions(): Promise<PermissionRequest[]> {
    return this.request('/permissions')
  }

  replyPermission(id: string, decision: PermissionDecision): Promise<unknown> {
    return this.request(`/permissions/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ decision })
    })
  }

  listQuestions(): Promise<QuestionRequest[]> {
    return this.request('/questions')
  }

  replyQuestion(id: string, answer: QuestionAnswer): Promise<unknown> {
    return this.request(`/questions/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ answer })
    })
  }

  /** Consume the SSE stream until the server closes it or `signal` aborts. */
  async stream(
    onEvent: (envelope: AgentEventEnvelope) => void,
    signal: AbortSignal
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/events`, {
      headers: {
        Accept: 'text/event-stream',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      signal
    })
    if (!response.ok || !response.body) {
      throw new AttachError(`HTTP ${response.status}`, response.status)
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
            // Ignore malformed frames instead of dropping the stream.
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
    await reader.cancel().catch(() => undefined)
  }
}

export interface AttachTuiBackendOptions {
  baseUrl: string
  token: string | null
  /** Delay between SSE reconnect attempts. Tests shorten it. */
  reconnectDelayMs?: number
}

/**
 * Backend that attaches to a running `pnpm serve` instance over HTTP and SSE.
 * It reconnects on its own and asks the controller to reload snapshots after a
 * gap, so the TUI never renders deltas from a broken stream as authoritative.
 */
export class AttachTuiBackend implements TuiBackend {
  readonly mode = 'attach' as const
  private readonly client: AttachClient
  private readonly listeners = new Set<TuiBackendListener>()
  private readonly abort = new AbortController()
  private readonly reconnectDelayMs: number
  private streamPromise: Promise<void> | null = null
  private closed = false

  constructor(options: AttachTuiBackendOptions) {
    this.client = new AttachClient({ baseUrl: options.baseUrl, token: options.token })
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000
  }

  async init(): Promise<void> {
    await this.client.health()
    this.streamPromise = this.streamLoop()
  }

  listSessions(): Promise<SessionMeta[]> {
    return this.client.listSessions()
  }

  createSession(input: TuiNewSession): Promise<SessionMeta> {
    return this.client.createSession(input)
  }

  messages(id: string): Promise<MessagesSnapshot> {
    return this.client.messages(id)
  }

  async sendChat(id: string, text: string): Promise<'sent' | 'steered'> {
    try {
      await this.client.send(id, text)
      return 'sent'
    } catch (error) {
      if (error instanceof AttachError && error.status === 409) {
        await this.client.steer(id, text)
        return 'steered'
      }
      throw error
    }
  }

  async stopChat(id: string): Promise<void> {
    await this.client.stop(id)
  }

  async retryChat(id: string): Promise<void> {
    await this.client.retry(id)
  }

  async replyPermission(id: string, decision: PermissionDecision): Promise<void> {
    await this.client.replyPermission(id, decision)
  }

  async replyQuestion(id: string, answer: QuestionAnswer): Promise<void> {
    await this.client.replyQuestion(id, answer)
  }

  permissions(): Promise<PermissionRequest[]> {
    return this.client.listPermissions()
  }

  questions(): Promise<QuestionRequest[]> {
    return this.client.listQuestions()
  }

  subscribe(listener: TuiBackendListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async shutdown(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    this.abort.abort()
    await this.streamPromise?.catch(() => undefined)
    this.streamPromise = null
  }

  private emitEvent(envelope: AgentEventEnvelope): void {
    for (const listener of this.listeners) listener.event(envelope.event)
  }

  private emitResync(): void {
    for (const listener of this.listeners) listener.resync()
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(finish, ms)
      const signal = this.abort.signal
      function finish(): void {
        clearTimeout(timer)
        signal.removeEventListener('abort', finish)
        resolve()
      }
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
    })
  }

  private async streamLoop(): Promise<void> {
    while (!this.closed) {
      try {
        await this.client.stream((envelope) => this.emitEvent(envelope), this.abort.signal)
      } catch {
        // Disconnects and HTTP errors are retried below; a closed backend exits.
      }
      if (this.closed) return
      await this.wait(this.reconnectDelayMs)
      if (this.closed) return
      // Events may have been missed while the stream was down.
      this.emitResync()
    }
  }
}
