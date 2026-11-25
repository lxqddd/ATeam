import { spawn as nodeSpawn } from 'node:child_process'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const MAX_STDERR_TAIL = 4_000

export interface McpJsonRpcMessage {
  jsonrpc?: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpContentBlock {
  type: string
  text?: string
  data?: string
  mimeType?: string
  uri?: string
}

export interface McpToolCallResult {
  content: McpContentBlock[]
  isError: boolean
}

export interface McpPromptArgument {
  name: string
  description?: string
  required?: boolean
}

export interface McpPromptDefinition {
  name: string
  description?: string
  arguments?: McpPromptArgument[]
}

export interface McpResourceDefinition {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

export interface McpResourceTemplateDefinition {
  uriTemplate: string
  name?: string
  description?: string
  mimeType?: string
}

export interface McpResourceContent {
  uri: string
  mimeType?: string
  text?: string
}

export interface McpClientLike {
  connect(): Promise<void>
  instructions?(): string | undefined
  listTools(): Promise<McpToolDefinition[]>
  listPrompts(): Promise<McpPromptDefinition[]>
  listResources(): Promise<McpResourceDefinition[]>
  listResourceTemplates?(): Promise<McpResourceTemplateDefinition[]>
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult>
  getPrompt(name: string, args?: Record<string, string>): Promise<string>
  readResource(uri: string): Promise<McpResourceContent[]>
  onToolsChanged(handler: () => void): () => void
  close(): Promise<void>
}

export interface McpTransport {
  start(): Promise<void>
  send(message: McpJsonRpcMessage): Promise<void>
  onMessage(handler: (message: McpJsonRpcMessage) => void): void
  onClose(handler: (error: Error) => void): void
  close(): Promise<void>
}

export interface McpProcessLike {
  stdin: NodeJS.WritableStream | null
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'exit', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type McpSpawn = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => McpProcessLike

export function parseJsonLines(buffer: string): { messages: unknown[]; rest: string } {
  const messages: unknown[] = []
  let rest = buffer
  for (;;) {
    const newline = rest.indexOf('\n')
    if (newline === -1) break
    const line = rest.slice(0, newline).trim()
    rest = rest.slice(newline + 1)
    if (!line) continue
    try {
      messages.push(JSON.parse(line))
    } catch {
      /* ignore malformed lines */
    }
  }
  return { messages, rest }
}

export function createStdioTransport(options: {
  command: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  processEnv?: NodeJS.ProcessEnv
  spawn?: McpSpawn
}): McpTransport {
  let child: McpProcessLike | null = null
  let closed = false
  let buffer = ''
  let stderr = ''
  const messageHandlers: Array<(message: McpJsonRpcMessage) => void> = []
  const closeHandlers: Array<(error: Error) => void> = []

  const emitClose = (error: Error): void => {
    if (closed) return
    closed = true
    for (const handler of closeHandlers) handler(error)
  }

  return {
    async start(): Promise<void> {
      const spawn = options.spawn ?? (nodeSpawn as unknown as McpSpawn)
      const env = { ...(options.processEnv ?? process.env), ...(options.env ?? {}) }
      const process_ = spawn(options.command, options.args, { cwd: options.cwd, env })
      child = process_
      process_.stdout?.on('data', (chunk: Buffer | string) => {
        const decoded = parseJsonLines(`${buffer}${String(chunk)}`)
        buffer = decoded.rest
        for (const message of decoded.messages) {
          for (const handler of messageHandlers) handler(message as McpJsonRpcMessage)
        }
      })
      process_.stderr?.on('data', (chunk: Buffer | string) => {
        stderr = `${stderr}${String(chunk)}`.slice(-MAX_STDERR_TAIL)
      })
      process_.on('exit', (code) => {
        emitClose(
          new Error(
            `MCP server exited${code === null ? '' : ` with code ${code}`}${
              stderr.trim() ? `: ${stderr.trim()}` : ''
            }`
          )
        )
      })
      process_.on('error', (error) => emitClose(error))
    },

    async send(message: McpJsonRpcMessage): Promise<void> {
      if (closed || !child?.stdin) throw new Error('MCP server is not running')
      child.stdin.write(`${JSON.stringify(message)}\n`)
    },

    onMessage(handler: (message: McpJsonRpcMessage) => void): void {
      messageHandlers.push(handler)
    },

    onClose(handler: (error: Error) => void): void {
      closeHandlers.push(handler)
    },

    async close(): Promise<void> {
      if (closed) return
      closed = true
      try {
        child?.kill()
      } catch {
        /* the process may already be gone */
      }
      child = null
    }
  }
}

export function createHttpTransport(options: {
  url: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  maxSseBytes?: number
  maxRequestMs?: number
}): McpTransport {
  const fetchImpl = options.fetch ?? fetch
  const maxSseBytes = options.maxSseBytes ?? 10 * 1024 * 1024
  const maxRequestMs = options.maxRequestMs ?? 10 * 60_000
  let sessionId: string | null = null
  let closed = false
  const controllers = new Set<AbortController>()
  const messageHandlers: Array<(message: McpJsonRpcMessage) => void> = []
  const closeHandlers: Array<(error: Error) => void> = []

  const emit = (message: McpJsonRpcMessage): void => {
    for (const handler of messageHandlers) handler(message)
  }

  const emitError = (id: number | string, message: string): void => {
    emit({ jsonrpc: '2.0', id, error: { code: -32000, message } })
  }

  return {
    async start(): Promise<void> {
      return undefined
    },

    async send(message: McpJsonRpcMessage): Promise<void> {
      if (closed) throw new Error('MCP transport is closed')
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(options.headers ?? {})
      }
      if (sessionId) headers['mcp-session-id'] = sessionId
      const controller = new AbortController()
      controllers.add(controller)
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, maxRequestMs)
      const failure = (error: unknown): string =>
        timedOut
          ? `MCP request timed out after ${maxRequestMs}ms`
          : error instanceof Error
            ? error.message
            : String(error)

      try {
        let response: Response
        try {
          response = await fetchImpl(options.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(message),
            signal: controller.signal
          })
        } catch (error) {
          if (message.id !== undefined) emitError(message.id, failure(error))
          return
        }

        const nextSession = response.headers.get('mcp-session-id')
        if (nextSession) sessionId = nextSession

        if (!response.ok) {
          const text = await response.text().catch(() => '')
          if (message.id !== undefined) {
            emitError(
              message.id,
              `HTTP ${response.status}${text.trim() ? `: ${text.trim().slice(0, 500)}` : ''}`
            )
          }
          return
        }

        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('text/event-stream') && response.body) {
          try {
            await consumeSse(response.body, emit, maxSseBytes)
          } catch (error) {
            if (message.id !== undefined) emitError(message.id, failure(error))
          }
          return
        }

        const text = await response.text().catch(() => '')
        if (!text.trim()) return
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          return
        }
        if (Array.isArray(parsed)) {
          for (const entry of parsed) emit(entry as McpJsonRpcMessage)
        } else {
          emit(parsed as McpJsonRpcMessage)
        }
      } finally {
        clearTimeout(timer)
        controllers.delete(controller)
      }
    },

    onMessage(handler: (message: McpJsonRpcMessage) => void): void {
      messageHandlers.push(handler)
    },

    onClose(handler: (error: Error) => void): void {
      closeHandlers.push(handler)
    },

    async close(): Promise<void> {
      closed = true
      for (const controller of controllers) controller.abort()
      controllers.clear()
    }
  }
}

/**
 * Legacy HTTP+SSE transport (protocol revisions before Streamable HTTP): a GET request opens
 * an event stream whose first `endpoint` event announces where JSON-RPC messages are POSTed.
 */
export function createSseTransport(options: {
  url: string
  headers?: Record<string, string>
  fetch?: typeof fetch
  maxSseBytes?: number
  endpointTimeoutMs?: number
  maxRequestMs?: number
}): McpTransport {
  const fetchImpl = options.fetch ?? fetch
  const maxSseBytes = options.maxSseBytes ?? 10 * 1024 * 1024
  const endpointTimeoutMs = options.endpointTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const maxRequestMs = options.maxRequestMs ?? 10 * 60_000
  let endpoint: string | null = null
  let started = false
  let closed = false
  let streamController: AbortController | null = null
  const controllers = new Set<AbortController>()
  const messageHandlers: Array<(message: McpJsonRpcMessage) => void> = []
  const closeHandlers: Array<(error: Error) => void> = []

  const emit = (message: McpJsonRpcMessage): void => {
    for (const handler of messageHandlers) handler(message)
  }

  const emitError = (id: number | string, message: string): void => {
    emit({ jsonrpc: '2.0', id, error: { code: -32000, message } })
  }

  const emitClose = (error: Error): void => {
    if (closed) return
    closed = true
    for (const handler of closeHandlers) handler(error)
  }

  const emitPayload = (data: string): void => {
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (Array.isArray(parsed)) {
      for (const entry of parsed) emit(entry as McpJsonRpcMessage)
    } else {
      emit(parsed as McpJsonRpcMessage)
    }
  }

  const resolveEndpoint = (value: string): string => {
    try {
      return new URL(value, options.url).toString()
    } catch {
      return value
    }
  }

  return {
    async start(): Promise<void> {
      if (started) return
      started = true
      const controller = new AbortController()
      streamController = controller
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        ...(options.headers ?? {})
      }
      let response: Response
      try {
        response = await fetchImpl(options.url, {
          method: 'GET',
          headers,
          signal: controller.signal
        })
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error))
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(
          `HTTP ${response.status}${text.trim() ? `: ${text.trim().slice(0, 500)}` : ''}`
        )
      }
      if (!response.body) throw new Error('MCP SSE response has no body')

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (error?: Error): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (error) reject(error)
          else resolve()
        }
        const timer = setTimeout(() => {
          controller.abort()
          finish(new Error(`MCP SSE endpoint was not announced within ${endpointTimeoutMs}ms`))
        }, endpointTimeoutMs)

        void consumeSseEvents(
          response.body as ReadableStream<Uint8Array>,
          (event, data) => {
            if (event === 'endpoint') {
              if (!endpoint) {
                endpoint = resolveEndpoint(data)
                finish()
              }
              return
            }
            if (event && event !== 'message') return
            emitPayload(data)
          },
          maxSseBytes
        )
          .then(() => {
            finish(new Error('MCP SSE stream closed before an endpoint was announced'))
            emitClose(new Error('MCP SSE stream closed'))
          })
          .catch((error: unknown) => {
            const failure = error instanceof Error ? error : new Error(String(error))
            finish(failure)
            emitClose(failure)
          })
      })
    },

    async send(message: McpJsonRpcMessage): Promise<void> {
      if (closed) throw new Error('MCP transport is closed')
      const target = endpoint
      if (!target) throw new Error('MCP SSE endpoint is not available')
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(options.headers ?? {})
      }
      const controller = new AbortController()
      controllers.add(controller)
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, maxRequestMs)
      const failure = (error: unknown): string =>
        timedOut
          ? `MCP request timed out after ${maxRequestMs}ms`
          : error instanceof Error
            ? error.message
            : String(error)

      try {
        let response: Response
        try {
          response = await fetchImpl(target, {
            method: 'POST',
            headers,
            body: JSON.stringify(message),
            signal: controller.signal
          })
        } catch (error) {
          if (message.id !== undefined) emitError(message.id, failure(error))
          return
        }
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          if (message.id !== undefined) {
            emitError(
              message.id,
              `HTTP ${response.status}${text.trim() ? `: ${text.trim().slice(0, 500)}` : ''}`
            )
          }
          return
        }
        const contentType = response.headers.get('content-type') ?? ''
        if (contentType.includes('application/json')) {
          const text = await response.text().catch(() => '')
          if (text.trim()) emitPayload(text)
          return
        }
        await response.text().catch(() => undefined)
      } finally {
        clearTimeout(timer)
        controllers.delete(controller)
      }
    },

    onMessage(handler: (message: McpJsonRpcMessage) => void): void {
      messageHandlers.push(handler)
    },

    onClose(handler: (error: Error) => void): void {
      closeHandlers.push(handler)
    },

    async close(): Promise<void> {
      if (closed) return
      closed = true
      streamController?.abort()
      streamController = null
      for (const controller of controllers) controller.abort()
      controllers.clear()
    }
  }
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  emit: (message: McpJsonRpcMessage) => void,
  maxBytes: number
): Promise<void> {
  await consumeSseEvents(
    body,
    (event, data) => {
      if (event && event !== 'message') return
      try {
        emit(JSON.parse(data) as McpJsonRpcMessage)
      } catch {
        /* ignore malformed events */
      }
    },
    maxBytes
  )
}

async function consumeSseEvents(
  body: ReadableStream<Uint8Array>,
  emit: (event: string, data: string) => void,
  maxBytes: number
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const flushEvents = (): void => {
    for (;;) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary === -1) return
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      let event = ''
      const dataLines: string[] = []
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      const data = dataLines.join('\n')
      if (!data) continue
      emit(event, data)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, '\n')
      flushEvents()
      if (buffer.length > maxBytes) {
        throw new Error(`MCP SSE event is too large (over ${maxBytes} characters)`)
      }
    }
    flushEvents()
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export class McpClient implements McpClientLike {
  private nextId = 1
  private open = false
  private readonly pending = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()
  private readonly changeHandlers = new Set<() => void>()
  private readonly requestTimeoutMs: number
  private serverInstructions: string | undefined

  constructor(
    private readonly options: {
      name: string
      transport: McpTransport
      clientVersion?: string
      requestTimeoutMs?: number
    }
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    options.transport.onMessage((message) => this.handleMessage(message))
    options.transport.onClose((error) => this.handleClose(error))
  }

  get connected(): boolean {
    return this.open
  }

  async connect(): Promise<void> {
    await this.options.transport.start()
    const initialized = (await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {
        name: 'ATeam',
        version: this.options.clientVersion ?? '0.1.0'
      }
    })) as { instructions?: unknown } | null
    this.serverInstructions =
      typeof initialized?.instructions === 'string' ? initialized.instructions : undefined
    await this.options.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    this.open = true
  }

  instructions(): string | undefined {
    return this.serverInstructions
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const tools: McpToolDefinition[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page += 1) {
      const result = (await this.request('tools/list', cursor ? { cursor } : {})) as {
        tools?: Array<{ name?: unknown; description?: unknown; inputSchema?: unknown }>
        nextCursor?: unknown
      }
      for (const tool of result?.tools ?? []) {
        if (!tool || typeof tool.name !== 'string') continue
        tools.push({
          name: tool.name,
          description: typeof tool.description === 'string' ? tool.description : undefined,
          inputSchema:
            tool.inputSchema && typeof tool.inputSchema === 'object'
              ? (tool.inputSchema as Record<string, unknown>)
              : undefined
        })
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined
      if (!cursor) break
    }
    return tools
  }

  async listPrompts(): Promise<McpPromptDefinition[]> {
    const prompts: McpPromptDefinition[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page += 1) {
      const result = (await this.request('prompts/list', cursor ? { cursor } : {})) as {
        prompts?: Array<{
          name?: unknown
          description?: unknown
          arguments?: Array<{ name?: unknown; description?: unknown; required?: unknown }>
        }>
        nextCursor?: unknown
      }
      for (const prompt of result?.prompts ?? []) {
        if (!prompt || typeof prompt.name !== 'string') continue
        const args = (prompt.arguments ?? [])
          .filter((arg) => arg && typeof arg.name === 'string')
          .map((arg) => ({
            name: arg.name as string,
            description: typeof arg.description === 'string' ? arg.description : undefined,
            required: arg.required === true
          }))
        prompts.push({
          name: prompt.name,
          description: typeof prompt.description === 'string' ? prompt.description : undefined,
          ...(args.length > 0 ? { arguments: args } : {})
        })
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined
      if (!cursor) break
    }
    return prompts
  }

  async listResources(): Promise<McpResourceDefinition[]> {
    const resources: McpResourceDefinition[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page += 1) {
      const result = (await this.request('resources/list', cursor ? { cursor } : {})) as {
        resources?: Array<{
          uri?: unknown
          name?: unknown
          description?: unknown
          mimeType?: unknown
        }>
        nextCursor?: unknown
      }
      for (const resource of result?.resources ?? []) {
        if (!resource || typeof resource.uri !== 'string') continue
        resources.push({
          uri: resource.uri,
          name: typeof resource.name === 'string' ? resource.name : undefined,
          description: typeof resource.description === 'string' ? resource.description : undefined,
          mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : undefined
        })
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined
      if (!cursor) break
    }
    return resources
  }

  async listResourceTemplates(): Promise<McpResourceTemplateDefinition[]> {
    const templates: McpResourceTemplateDefinition[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page += 1) {
      const result = (await this.request('resources/templates/list', cursor ? { cursor } : {})) as {
        resourceTemplates?: Array<{
          uriTemplate?: unknown
          name?: unknown
          description?: unknown
          mimeType?: unknown
        }>
        nextCursor?: unknown
      }
      for (const template of result?.resourceTemplates ?? []) {
        if (!template || typeof template.uriTemplate !== 'string') continue
        templates.push({
          uriTemplate: template.uriTemplate,
          name: typeof template.name === 'string' ? template.name : undefined,
          description: typeof template.description === 'string' ? template.description : undefined,
          mimeType: typeof template.mimeType === 'string' ? template.mimeType : undefined
        })
      }
      cursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined
      if (!cursor) break
    }
    return templates
  }

  async readResource(uri: string): Promise<McpResourceContent[]> {
    const result = (await this.request('resources/read', { uri })) as {
      contents?: Array<{ uri?: unknown; mimeType?: unknown; text?: unknown }>
    }
    const contents: McpResourceContent[] = []
    for (const content of result?.contents ?? []) {
      if (!content || typeof content.uri !== 'string') continue
      contents.push({
        uri: content.uri,
        mimeType: typeof content.mimeType === 'string' ? content.mimeType : undefined,
        text: typeof content.text === 'string' ? content.text : undefined
      })
    }
    return contents
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<string> {
    const result = (await this.request('prompts/get', {
      name,
      ...(args && Object.keys(args).length > 0 ? { arguments: args } : {})
    })) as {
      messages?: Array<{ content?: { type?: string; text?: string } | string }>
    }
    return (result?.messages ?? [])
      .map((message) => {
        const content = message.content
        if (!content) return ''
        if (typeof content === 'string') return content
        return content.type === 'text' ? (content.text ?? '') : ''
      })
      .filter(Boolean)
      .join('\n\n')
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: McpContentBlock[]
      isError?: unknown
    }
    return {
      content: Array.isArray(result?.content) ? result.content : [],
      isError: result?.isError === true
    }
  }

  onToolsChanged(handler: () => void): () => void {
    this.changeHandlers.add(handler)
    return () => {
      this.changeHandlers.delete(handler)
    }
  }

  async close(): Promise<void> {
    this.open = false
    this.handleClose(new Error('MCP client closed'))
    await this.options.transport.close()
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.options.transport.send({ jsonrpc: '2.0', id, method, params }).catch((error) => {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  private handleMessage(message: McpJsonRpcMessage): void {
    if (message.method !== undefined) {
      if (message.id !== undefined) {
        void this.options.transport
          .send({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32601, message: `Method not supported: ${message.method}` }
          })
          .catch(() => undefined)
        return
      }
      if (message.method === 'notifications/tools/list_changed') {
        for (const handler of this.changeHandlers) handler()
      }
      return
    }
    if (message.id === undefined) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) {
      pending.reject(new Error(message.error.message ?? 'MCP request failed'))
    } else {
      pending.resolve(message.result)
    }
  }

  private handleClose(error: Error): void {
    this.open = false
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
