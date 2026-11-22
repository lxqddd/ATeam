import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  McpClient,
  createHttpTransport,
  createStdioTransport,
  parseJsonLines,
  type McpJsonRpcMessage,
  type McpProcessLike,
  type McpTransport
} from './mcp-client'

class FakeTransport implements McpTransport {
  readonly sent: McpJsonRpcMessage[] = []
  closed = false
  private messageHandlers: Array<(message: McpJsonRpcMessage) => void> = []
  private closeHandlers: Array<(error: Error) => void> = []

  async start(): Promise<void> {
    return undefined
  }

  async send(message: McpJsonRpcMessage): Promise<void> {
    this.sent.push(message)
  }

  onMessage(handler: (message: McpJsonRpcMessage) => void): void {
    this.messageHandlers.push(handler)
  }

  onClose(handler: (error: Error) => void): void {
    this.closeHandlers.push(handler)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  emit(message: McpJsonRpcMessage): void {
    for (const handler of this.messageHandlers) handler(message)
  }

  fail(error: Error): void {
    for (const handler of this.closeHandlers) handler(error)
  }

  requests(): McpJsonRpcMessage[] {
    return this.sent.filter((message) => message.id !== undefined)
  }
}

function createClient(options: { requestTimeoutMs?: number } = {}): {
  client: McpClient
  transport: FakeTransport
} {
  const transport = new FakeTransport()
  const client = new McpClient({
    name: 'demo',
    transport,
    requestTimeoutMs: options.requestTimeoutMs ?? 1_000
  })
  return { client, transport }
}

class FakeProcess extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  killed = false
  kill(): boolean {
    this.killed = true
    return true
  }
}

describe('parseJsonLines', () => {
  it('splits complete lines and keeps the partial tail', () => {
    const decoded = parseJsonLines('{"a":1}\n{"b":2}\n{"c"')
    expect(decoded.messages).toEqual([{ a: 1 }, { b: 2 }])
    expect(decoded.rest).toBe('{"c"')

    const next = parseJsonLines(`${decoded.rest}:3}\n`)
    expect(next.messages).toEqual([{ c: 3 }])
    expect(next.rest).toBe('')
  })

  it('ignores malformed lines', () => {
    expect(parseJsonLines('not json\n{"ok":true}\n').messages).toEqual([{ ok: true }])
  })
})

describe('McpClient', () => {
  it('initializes the server and announces the client', async () => {
    const { client, transport } = createClient()

    const connecting = client.connect()
    await vi.waitFor(() => expect(transport.requests()).toHaveLength(1))
    const [request] = transport.requests()
    expect(request).toMatchObject({
      method: 'initialize',
      params: {
        protocolVersion: expect.any(String),
        clientInfo: { name: 'ATeam', version: expect.any(String) }
      }
    })
    transport.emit({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18' } })

    await connecting
    expect(transport.sent).toContainEqual(
      expect.objectContaining({ method: 'notifications/initialized' })
    )
    expect(client.connected).toBe(true)
  })

  it('lists tools and follows pagination cursors', async () => {
    const { client, transport } = createClient()

    const listing = client.listTools()
    await vi.waitFor(() => expect(transport.requests()).toHaveLength(1))
    transport.emit({
      jsonrpc: '2.0',
      id: transport.requests()[0].id,
      result: { tools: [{ name: 'read' }], nextCursor: 'page-2' }
    })
    await vi.waitFor(() => expect(transport.requests()).toHaveLength(2))
    expect(transport.requests()[1].params).toEqual({ cursor: 'page-2' })
    transport.emit({
      jsonrpc: '2.0',
      id: transport.requests()[1].id,
      result: { tools: [{ name: 'write', description: 'Write', inputSchema: { type: 'object' } }] }
    })

    await expect(listing).resolves.toEqual([
      { name: 'read', description: undefined, inputSchema: undefined },
      { name: 'write', description: 'Write', inputSchema: { type: 'object' } }
    ])
  })

  it('calls tools and preserves error results', async () => {
    const { client, transport } = createClient()

    const calling = client.callTool('echo', { text: 'hi' })
    await vi.waitFor(() => expect(transport.requests()).toHaveLength(1))
    expect(transport.requests()[0]).toMatchObject({
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'hi' } }
    })
    transport.emit({
      jsonrpc: '2.0',
      id: transport.requests()[0].id,
      result: { content: [{ type: 'text', text: 'boom' }], isError: true }
    })

    await expect(calling).resolves.toEqual({
      content: [{ type: 'text', text: 'boom' }],
      isError: true
    })
  })

  it('notifies listeners when the tool list changes', async () => {
    const { client, transport } = createClient()
    const handler = vi.fn()
    client.onToolsChanged(handler)

    transport.emit({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('answers unsupported server requests with an error', async () => {
    const { transport } = createClient()
    transport.emit({ jsonrpc: '2.0', id: 7, method: 'sampling/createMessage', params: {} })

    expect(transport.sent).toContainEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32601, message: expect.stringContaining('not supported') }
    })
  })

  it('times out requests', async () => {
    const { client } = createClient({ requestTimeoutMs: 20 })

    await expect(client.listTools()).rejects.toThrow('MCP request timed out: tools/list')
  })

  it('rejects pending requests when the transport closes', async () => {
    const { client, transport } = createClient()

    const listing = client.listTools()
    await vi.waitFor(() => expect(transport.requests()).toHaveLength(1))
    transport.fail(new Error('connection lost'))

    await expect(listing).rejects.toThrow('connection lost')
    expect(client.connected).toBe(false)
  })

  it('rejects JSON-RPC errors from the server', async () => {
    const { client, transport } = createClient()

    const listing = client.listTools()
    await vi.waitFor(() => expect(transport.requests()).toHaveLength(1))
    transport.emit({
      jsonrpc: '2.0',
      id: transport.requests()[0].id,
      error: { code: -32603, message: 'internal error' }
    })

    await expect(listing).rejects.toThrow('internal error')
  })

  it('reads prompts and resources', async () => {
    const { client, transport } = createClient()

    const prompts = client.listPrompts()
    await vi.waitFor(() => expect(transport.requests()).toHaveLength(1))
    transport.emit({
      jsonrpc: '2.0',
      id: transport.requests()[0].id,
      result: {
        prompts: [
          {
            name: 'summarize',
            description: 'Summarize a file',
            arguments: [{ name: 'path', required: true }]
          }
        ]
      }
    })
    await expect(prompts).resolves.toEqual([
      {
        name: 'summarize',
        description: 'Summarize a file',
        arguments: [{ name: 'path', required: true }]
      }
    ])

    const resources = client.listResources()
    await vi.waitFor(() => expect(transport.requests()).toHaveLength(2))
    transport.emit({
      jsonrpc: '2.0',
      id: transport.requests()[1].id,
      result: { resources: [{ uri: 'file:///a.txt', name: 'a.txt' }] }
    })
    await expect(resources).resolves.toEqual([{ uri: 'file:///a.txt', name: 'a.txt' }])

    const contents = client.readResource('file:///a.txt')
    await vi.waitFor(() => expect(transport.requests()).toHaveLength(3))
    transport.emit({
      jsonrpc: '2.0',
      id: transport.requests()[2].id,
      result: { contents: [{ uri: 'file:///a.txt', text: 'hello' }] }
    })
    await expect(contents).resolves.toEqual([{ uri: 'file:///a.txt', text: 'hello' }])
  })
})

describe('createStdioTransport', () => {
  it('spawns the server with merged environment and newline-delimited messages', async () => {
    const child = new FakeProcess()
    const spawn = vi.fn(() => child as unknown as McpProcessLike)
    const transport = createStdioTransport({
      command: 'npx',
      args: ['-y', 'server'],
      cwd: '/work',
      env: { TOKEN: 'x' },
      spawn,
      processEnv: { PATH: '/bin' }
    })
    const written: string[] = []
    child.stdin.on('data', (chunk: Buffer) => written.push(String(chunk)))
    const received: unknown[] = []
    transport.onMessage((message) => received.push(message))

    await transport.start()
    expect(spawn).toHaveBeenCalledWith('npx', ['-y', 'server'], {
      cwd: '/work',
      env: { PATH: '/bin', TOKEN: 'x' }
    })

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(written.join('')).toBe(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`
    )

    child.stdout.write('{"jsonrpc":"2.0","id":1,"res')
    expect(received).toEqual([])
    child.stdout.write('ult":{"tools":[]}}\n')
    expect(received).toEqual([{ jsonrpc: '2.0', id: 1, result: { tools: [] } }])
  })

  it('reports server exits with stderr context', async () => {
    const child = new FakeProcess()
    const transport = createStdioTransport({
      command: 'node',
      args: [],
      cwd: '/work',
      spawn: () => child as unknown as McpProcessLike
    })
    const closed: Error[] = []
    transport.onClose((error) => closed.push(error))

    await transport.start()
    child.stderr.write('cannot start server\n')
    child.emit('exit', 1)

    expect(closed).toHaveLength(1)
    expect(closed[0].message).toContain('cannot start server')
  })
})

describe('createHttpTransport', () => {
  function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init
    })
  }

  it('posts JSON-RPC with custom headers and parses JSON responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } })
    )
    const transport = createHttpTransport({
      url: 'https://mcp.example.com/rpc',
      headers: { Authorization: 'Bearer token' },
      fetch: fetchMock
    })
    const received: McpJsonRpcMessage[] = []
    transport.onMessage((message) => received.push(message))

    await transport.start()
    await transport.send({ jsonrpc: '2.0', id: 1, method: 'ping' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://mcp.example.com/rpc')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: expect.stringContaining('text/event-stream'),
      Authorization: 'Bearer token'
    })
    expect(init?.body).toBe(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }))
    expect(received).toEqual([{ jsonrpc: '2.0', id: 1, result: { ok: true } }])
  })

  it('reuses the session id returned by initialize', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as McpJsonRpcMessage
      return jsonResponse(
        { jsonrpc: '2.0', id: body.id, result: {} },
        { headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' } }
      )
    })
    const transport = createHttpTransport({ url: 'https://example.com/mcp', fetch: fetchMock })

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    await transport.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })

    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ 'mcp-session-id': 'session-1' })
  })

  it('parses server-sent events', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n')
        )
        controller.close()
      }
    })
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    )
    const transport = createHttpTransport({ url: 'https://example.com/mcp', fetch: fetchMock })
    const received: McpJsonRpcMessage[] = []
    transport.onMessage((message) => received.push(message))

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

    expect(received).toEqual([{ jsonrpc: '2.0', id: 1, result: { tools: [] } }])
  })

  it('aborts in-flight requests when closed', async () => {
    let signal: AbortSignal | undefined
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
    )
    const transport = createHttpTransport({ url: 'https://example.com/mcp', fetch: fetchMock })
    const received: McpJsonRpcMessage[] = []
    transport.onMessage((message) => received.push(message))

    const pending = transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    await vi.waitFor(() => expect(signal).toBeDefined())
    await transport.close()
    await pending

    expect(signal?.aborted).toBe(true)
    expect(received).toEqual([
      expect.objectContaining({ id: 1, error: expect.objectContaining({ code: -32000 }) })
    ])
  })

  it('fails instead of buffering an oversized SSE event', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(1_000))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 3; index += 1) controller.enqueue(chunk)
        controller.close()
      }
    })
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    )
    const transport = createHttpTransport({
      url: 'https://example.com/mcp',
      fetch: fetchMock,
      maxSseBytes: 1_500
    })
    const received: McpJsonRpcMessage[] = []
    transport.onMessage((message) => received.push(message))

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

    expect(received).toEqual([
      expect.objectContaining({
        id: 1,
        error: expect.objectContaining({ message: expect.stringContaining('too large') })
      })
    ])
  })

  it('times out requests that never settle', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )
    const transport = createHttpTransport({
      url: 'https://example.com/mcp',
      fetch: fetchMock,
      maxRequestMs: 20
    })
    const received: McpJsonRpcMessage[] = []
    transport.onMessage((message) => received.push(message))

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

    expect(received).toEqual([
      expect.objectContaining({
        id: 1,
        error: expect.objectContaining({ message: expect.stringContaining('timed out') })
      })
    ])
  })

  it('turns HTTP failures into JSON-RPC errors', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('server exploded', { status: 500 })
    )
    const transport = createHttpTransport({ url: 'https://example.com/mcp', fetch: fetchMock })
    const received: McpJsonRpcMessage[] = []
    transport.onMessage((message) => received.push(message))

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

    expect(received).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: expect.stringContaining('HTTP 500') }
      }
    ])
  })

  it('turns network failures into JSON-RPC errors', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const transport = createHttpTransport({ url: 'https://example.com/mcp', fetch: fetchMock })
    const received: McpJsonRpcMessage[] = []
    transport.onMessage((message) => received.push(message))

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

    expect(received).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: expect.stringContaining('ECONNREFUSED') }
      }
    ])
  })
})

describe('McpClient prompts', () => {
  it('loads a prompt with arguments', async () => {
    const { client, transport } = createClient()

    const loading = client.getPrompt('greet', { name: 'Ada' })
    await vi.waitFor(() => expect(transport.requests()).toHaveLength(1))
    expect(transport.requests()[0]).toMatchObject({
      method: 'prompts/get',
      params: { name: 'greet', arguments: { name: 'Ada' } }
    })
    transport.emit({
      jsonrpc: '2.0',
      id: transport.requests()[0].id,
      result: {
        messages: [
          { role: 'user', content: { type: 'text', text: 'Hello Ada' } },
          { role: 'assistant', content: { type: 'text', text: 'Hi!' } }
        ]
      }
    })

    await expect(loading).resolves.toBe('Hello Ada\n\nHi!')
  })
})
