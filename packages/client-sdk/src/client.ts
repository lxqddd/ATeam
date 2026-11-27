import type {
  AgentDefinition,
  AgentEventEnvelope,
  CommandDefinition,
  MessagesSnapshot,
  ModelRef,
  PermissionDecision,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  ResourceConfigSnapshot,
  ResourceLspServer,
  ResourceMcpServer,
  ResourceProvider,
  SessionMeta,
  WorkspaceFileContent,
  WorkspaceFileFindResult,
  WorkspaceFileGrepResult,
  WorkspaceFileList
} from './types'

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

export interface ListFilesOptions {
  /** Directory relative to the session workspace; defaults to the root. */
  path?: string
  /** Recursion depth; the server clamps it to its maximum. */
  depth?: number
  /** Entry limit; the server clamps it to its maximum. */
  limit?: number
}

export interface FindFilesOptions {
  /** Directory relative to the session workspace; defaults to the root. */
  path?: string
  /** Glob pattern matched against paths below `path`. */
  pattern: string
  limit?: number
}

export interface GrepFilesOptions {
  /** Directory relative to the session workspace; defaults to the root. */
  path?: string
  /** JavaScript regular expression, or literal text when `literal` is set. */
  pattern: string
  /** Optional filename filter such as `*.ts`. */
  include?: string
  literal?: boolean
  caseSensitive?: boolean
  limit?: number
}

/**
 * Selects the workspace a resource route reads. With no `sessionId` the server
 * uses its default workspace.
 */
export interface ResourceQuery {
  sessionId?: string
}

function queryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ''
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

  /** Retry the last failed or interrupted turn. */
  retrySession(id: string): Promise<{ retried: boolean }> {
    return this.request(`/sessions/${encodeURIComponent(id)}/retry`, { method: 'POST' })
  }

  /** Queue a message for the active turn, delivered after the current step. */
  steerSession(id: string, text: string): Promise<{ queued: boolean }> {
    return this.request(`/sessions/${encodeURIComponent(id)}/steer`, {
      method: 'POST',
      body: JSON.stringify({ text })
    })
  }

  compactSession(id: string, force = false): Promise<SessionMeta> {
    return this.request(`/sessions/${encodeURIComponent(id)}/compact`, {
      method: 'POST',
      body: JSON.stringify({ force })
    })
  }

  /** List files and directories inside the session workspace. */
  listFiles(sessionId: string, options: ListFilesOptions = {}): Promise<WorkspaceFileList> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/files${queryString({
        path: options.path,
        depth: options.depth,
        limit: options.limit
      })}`
    )
  }

  /** Read a text file inside the session workspace. */
  readFile(sessionId: string, path: string): Promise<WorkspaceFileContent> {
    if (!path) throw new Error('path is required')
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/files/content${queryString({ path })}`
    )
  }

  /** Find files by glob pattern inside the session workspace. */
  findFiles(sessionId: string, options: FindFilesOptions): Promise<WorkspaceFileFindResult> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/files/find${queryString({
        path: options.path,
        pattern: options.pattern,
        limit: options.limit
      })}`
    )
  }

  /** Search file contents inside the session workspace. */
  grepFiles(sessionId: string, options: GrepFilesOptions): Promise<WorkspaceFileGrepResult> {
    return this.request(
      `/sessions/${encodeURIComponent(sessionId)}/files/grep${queryString({
        path: options.path,
        pattern: options.pattern,
        include: options.include,
        literal: options.literal,
        caseSensitive: options.caseSensitive,
        limit: options.limit
      })}`
    )
  }

  /** List agent definitions visible in the workspace. */
  listAgents(query: ResourceQuery = {}): Promise<AgentDefinition[]> {
    return this.request(`/agents${queryString({ sessionId: query.sessionId })}`)
  }

  /** List slash commands visible in the workspace. */
  listCommands(query: ResourceQuery = {}): Promise<CommandDefinition[]> {
    return this.request(`/commands${queryString({ sessionId: query.sessionId })}`)
  }

  /** Effective merged configuration; credentials are masked or removed. */
  getConfig(query: ResourceQuery = {}): Promise<ResourceConfigSnapshot> {
    return this.request(`/config${queryString({ sessionId: query.sessionId })}`)
  }

  /** Providers with `hasApiKey` instead of the credential itself. */
  listProviders(query: ResourceQuery = {}): Promise<ResourceProvider[]> {
    return this.request(`/providers${queryString({ sessionId: query.sessionId })}`)
  }

  /** MCP servers with credential names only and their last known status. */
  listMcpServers(query: ResourceQuery = {}): Promise<ResourceMcpServer[]> {
    return this.request(`/mcp${queryString({ sessionId: query.sessionId })}`)
  }

  /** LSP servers with environment variable names only. */
  listLspServers(query: ResourceQuery = {}): Promise<ResourceLspServer[]> {
    return this.request(`/lsp${queryString({ sessionId: query.sessionId })}`)
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
