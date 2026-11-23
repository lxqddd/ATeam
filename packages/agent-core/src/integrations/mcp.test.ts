import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ToolSet } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpManager, type McpClientLike, type McpToolContext } from './mcp'
import type {
  McpPromptDefinition,
  McpResourceDefinition,
  McpToolCallResult,
  McpToolDefinition
} from './mcp-client'

interface FakeClientOptions {
  tools?: McpToolDefinition[]
  prompts?: McpPromptDefinition[]
  resources?: McpResourceDefinition[]
  call?: (name: string, args: Record<string, unknown>) => Promise<McpToolCallResult>
  connectError?: Error
}

function makeClient(options: FakeClientOptions = {}): {
  client: McpClientLike
  notifyChange: () => void
} {
  let changeHandler: (() => void) | null = null
  const client: McpClientLike = {
    connect: vi.fn(async () => {
      if (options.connectError) throw options.connectError
    }),
    listTools: vi.fn(async () => options.tools ?? []),
    listPrompts: vi.fn(async () => options.prompts ?? []),
    listResources: vi.fn(async () => options.resources ?? []),
    getPrompt: vi.fn(async () => ''),
    readResource: vi.fn(async () => []),
    callTool: vi.fn(
      options.call ?? (async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }))
    ),
    onToolsChanged: vi.fn((handler: () => void) => {
      changeHandler = handler
      return () => {
        changeHandler = null
      }
    }),
    close: vi.fn(async () => undefined)
  }
  return { client, notifyChange: () => changeHandler?.() }
}

async function runTool(
  tools: ToolSet,
  name: string,
  input: Record<string, unknown> = {},
  toolCallId = 'call-1'
): Promise<string> {
  const executable = tools[name] as unknown as {
    execute: (input: Record<string, unknown>, options: { toolCallId: string }) => Promise<string>
  }
  return executable.execute(input, { toolCallId })
}

let directory: string
let askPermission: ReturnType<typeof vi.fn>
let storeOutput: ReturnType<typeof vi.fn>
let context: McpToolContext

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-mcp-mgr-')))
  askPermission = vi.fn(async () => true)
  storeOutput = vi.fn(async (_toolCallId: string, output: string) => ({ output }))
  context = {
    askPermission: askPermission as unknown as McpToolContext['askPermission'],
    storeOutput: storeOutput as unknown as McpToolContext['storeOutput']
  }
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

function createManager(createClient: (config: unknown) => McpClientLike): McpManager {
  return new McpManager({ userDataPath: directory, workspace: directory, createClient })
}

describe('McpManager lifecycle', () => {
  it('closes connections that finish after disposal', async () => {
    let release: () => void = () => undefined
    const { client } = makeClient()
    client.connect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const manager = createManager(() => client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })

    const probe = manager.statuses({ probe: true })
    await vi.waitFor(() => expect(client.connect).toHaveBeenCalled())
    await manager.dispose()
    release()
    await probe

    expect(client.close).toHaveBeenCalled()
  })
})

describe('McpManager tools', () => {
  it('merges and replaces transient client servers', async () => {
    const { client } = makeClient({ tools: [{ name: 'echo' }] })
    const manager = createManager(() => client)
    await manager.setTransientServers([
      { name: 'client', type: 'local', command: 'node', args: ['server.js'] }
    ])

    expect((await manager.servers()).map((server) => server.name)).toEqual(['client'])
    const tools = await manager.tools(context)
    expect(Object.keys(tools)).toEqual(['mcp_client_echo'])

    await manager.setTransientServers([])
    expect(await manager.servers()).toEqual([])
    expect(client.close).toHaveBeenCalled()
    await manager.dispose()
  })

  it('resolves prompts and resources from transient servers', async () => {
    const { client } = makeClient({
      prompts: [{ name: 'greet' }],
      resources: [{ uri: 'demo://readme', name: 'readme' }]
    })
    const manager = createManager(() => client)
    await manager.setTransientServers([{ name: 'client', type: 'local', command: 'node' }])

    await expect(manager.getPrompt('client', 'greet')).resolves.toBe('')
    await expect(manager.readResource('client', 'demo://readme')).resolves.toBe('(empty resource)')
    await manager.dispose()
  })

  it('exposes prefixed, sanitized tool names', async () => {
    const { client } = makeClient({ tools: [{ name: 'read_file' }, { name: 'do:thing' }] })
    const manager = createManager(() => client)
    await manager.addServer({ name: 'Demo Server', type: 'local', command: 'node' })

    const tools = await manager.tools(context)

    expect(Object.keys(tools)).toEqual(['mcp_Demo_Server_read_file', 'mcp_Demo_Server_do_thing'])
    await manager.dispose()
  })

  it('executes tools with arguments and serializes content blocks', async () => {
    const { client } = makeClient({
      tools: [{ name: 'echo' }],
      call: async () => ({
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' }
        ],
        isError: false
      })
    })
    const manager = createManager(() => client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })
    const tools = await manager.tools(context)

    const result = await runTool(tools, 'mcp_demo_echo', { text: 'hi' })

    expect(client.callTool).toHaveBeenCalledWith('echo', { text: 'hi' })
    expect(result).toBe('hello\n{"type":"image","data":"AAAA","mimeType":"image/png"}')
    await manager.dispose()
  })

  it('asks for mcp permission with the server and tool resource', async () => {
    const { client } = makeClient({ tools: [{ name: 'echo' }] })
    const manager = createManager(() => client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })
    const tools = await manager.tools(context)

    await runTool(tools, 'mcp_demo_echo')

    expect(askPermission).toHaveBeenCalledWith('mcp', 'demo/echo', 'mcp_demo_echo', 'call-1')
    await manager.dispose()
  })

  it('does not call denied tools', async () => {
    const { client } = makeClient({ tools: [{ name: 'echo' }] })
    const manager = createManager(() => client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })
    const tools = await manager.tools(context)
    askPermission.mockResolvedValue(false)

    await expect(runTool(tools, 'mcp_demo_echo')).resolves.toBe(
      'Permission denied; the MCP tool was not called.'
    )
    expect(client.callTool).not.toHaveBeenCalled()
    await manager.dispose()
  })

  it('reports tool errors as error strings', async () => {
    const { client } = makeClient({
      tools: [{ name: 'echo' }],
      call: async () => ({ content: [{ type: 'text', text: 'boom' }], isError: true })
    })
    const manager = createManager(() => client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })
    const tools = await manager.tools(context)

    await expect(runTool(tools, 'mcp_demo_echo')).resolves.toBe('Error: boom')
    await manager.dispose()
  })

  it('bounds large outputs through the output store', async () => {
    const { client } = makeClient({
      tools: [{ name: 'echo' }],
      call: async () => ({ content: [{ type: 'text', text: 'x'.repeat(5_000) }], isError: false })
    })
    storeOutput.mockResolvedValue({ output: 'bounded' })
    const manager = createManager(() => client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })
    const tools = await manager.tools(context)

    const result = await runTool(tools, 'mcp_demo_echo')

    expect(result).toBe('bounded')
    expect(storeOutput).toHaveBeenCalledWith('call-1', 'x'.repeat(5_000))
    await manager.dispose()
  })

  it('skips disabled servers', async () => {
    const { client } = makeClient({ tools: [{ name: 'echo' }] })
    const manager = createManager(() => client)
    const server = await manager.addServer({ name: 'demo', type: 'local', command: 'node' })
    await manager.updateServer(server.id, { enabled: false })

    await expect(manager.tools(context)).resolves.toEqual({})
    expect(client.connect).not.toHaveBeenCalled()
    await manager.dispose()
  })

  it('isolates failing servers', async () => {
    const failing = makeClient({ connectError: new Error('spawn failed') })
    const working = makeClient({ tools: [{ name: 'echo' }] })
    const clients = [failing.client, working.client]
    const manager = createManager(() => clients.shift() ?? working.client)
    await manager.addServer({ name: 'broken', type: 'local', command: 'missing' })
    await manager.addServer({ name: 'good', type: 'local', command: 'node' })

    const tools = await manager.tools(context)

    expect(Object.keys(tools)).toEqual(['mcp_good_echo'])
    const statuses = await manager.statuses()
    expect(statuses.find((status) => status.name === 'broken')).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('spawn failed')
    })
    expect(statuses.find((status) => status.name === 'good')).toMatchObject({
      state: 'connected',
      toolCount: 1
    })
    await manager.dispose()
  })

  it('refreshes the tool list when the server reports a change', async () => {
    const fake = makeClient({ tools: [{ name: 'echo' }] })
    const manager = createManager(() => fake.client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })

    await manager.tools(context)
    expect(fake.client.listTools).toHaveBeenCalledTimes(1)

    fake.notifyChange()
    await manager.tools(context)

    expect(fake.client.listTools).toHaveBeenCalledTimes(2)
    await manager.dispose()
  })

  it('keeps colliding tool names unique', async () => {
    const first = makeClient({ tools: [{ name: 'echo' }] })
    const second = makeClient({ tools: [{ name: 'echo' }] })
    const clients = [first.client, second.client]
    const manager = createManager(() => clients.shift() ?? second.client)
    await manager.addServer({ name: 'a b', type: 'local', command: 'node' })
    await manager.addServer({ name: 'a_b', type: 'local', command: 'node' })

    const tools = await manager.tools(context)

    expect(Object.keys(tools)).toEqual(['mcp_a_b_echo', 'mcp_a_b_echo_2'])
    await manager.dispose()
  })

  it('truncates very long tool names to 64 characters', async () => {
    const longName = `tool_${'x'.repeat(80)}`
    const { client } = makeClient({ tools: [{ name: longName }] })
    const manager = createManager(() => client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })

    const tools = await manager.tools(context)
    const [name] = Object.keys(tools)

    expect(name.startsWith('mcp_demo_')).toBe(true)
    expect(name.length).toBeLessThanOrEqual(64)
    await manager.dispose()
  })
})

describe('McpManager lifecycle', () => {
  it('reports connection counts and statuses', async () => {
    const { client } = makeClient({
      tools: [{ name: 'echo' }, { name: 'search' }],
      prompts: [{ name: 'summarize' }],
      resources: [{ uri: 'file:///a.txt' }]
    })
    const manager = createManager(() => client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })

    await manager.tools(context)
    const statuses = await manager.statuses()

    expect(statuses).toEqual([
      expect.objectContaining({
        name: 'demo',
        state: 'connected',
        toolCount: 2,
        promptCount: 1,
        resourceCount: 1,
        error: null
      })
    ])
    await manager.dispose()
  })

  it('retries failed servers when statuses are probed', async () => {
    const failing = makeClient({ connectError: new Error('offline') })
    const working = makeClient({ tools: [{ name: 'echo' }] })
    const clients = [failing.client, working.client]
    const manager = createManager(() => clients.shift() ?? working.client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })

    await manager.tools(context)
    const statuses = await manager.statuses({ probe: true })

    expect(statuses[0]).toMatchObject({ state: 'connected', toolCount: 1 })
    await manager.dispose()
  })

  it('closes connections when servers are removed', async () => {
    const { client } = makeClient({ tools: [{ name: 'echo' }] })
    const manager = createManager(() => client)
    const server = await manager.addServer({ name: 'demo', type: 'local', command: 'node' })
    await manager.tools(context)

    await expect(manager.removeServer(server.id)).resolves.toBe(true)

    expect(client.close).toHaveBeenCalled()
    await manager.dispose()
  })

  it('closes all connections on dispose', async () => {
    const { client } = makeClient({ tools: [{ name: 'echo' }] })
    const manager = createManager(() => client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })
    await manager.tools(context)

    await manager.dispose()

    expect(client.close).toHaveBeenCalled()
  })

  it('persists servers through the store', async () => {
    const { client } = makeClient()
    const manager = createManager(() => client)
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })

    await expect(manager.servers()).resolves.toHaveLength(1)
    await manager.dispose()
  })
})

describe('McpManager prompts and resources', () => {
  let directory: string

  beforeEach(async () => {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-mcp-extra-')))
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  function clientWithExtras(): McpClientLike {
    return {
      connect: async () => undefined,
      listTools: async () => [],
      listPrompts: async () => [{ name: 'greet', description: 'Say hello' }],
      listResources: async () => [{ uri: 'demo://readme', name: 'readme' }],
      callTool: async () => ({ content: [], isError: false }),
      getPrompt: async () => 'Hello from prompt',
      readResource: async () => [{ uri: 'demo://readme', text: 'resource body' }],
      onToolsChanged: () => () => undefined,
      close: async () => undefined
    } as McpClientLike
  }

  it('lists prompts and resources across servers', async () => {
    const manager = new McpManager({
      userDataPath: directory,
      workspace: directory,
      createClient: () => clientWithExtras()
    })
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })

    await expect(manager.prompts()).resolves.toEqual([
      { server: 'demo', name: 'greet', description: 'Say hello' }
    ])
    await expect(manager.resources()).resolves.toEqual([
      { server: 'demo', uri: 'demo://readme', name: 'readme', mimeType: undefined }
    ])
    await manager.dispose()
  })

  it('loads prompts and resources for a server', async () => {
    const manager = new McpManager({
      userDataPath: directory,
      workspace: directory,
      createClient: () => clientWithExtras()
    })
    await manager.addServer({ name: 'demo', type: 'local', command: 'node' })

    await expect(manager.getPrompt('demo', 'greet', { name: 'Ada' })).resolves.toBe(
      'Hello from prompt'
    )
    await expect(manager.readResource('demo', 'demo://readme')).resolves.toBe('resource body')
    await expect(manager.getPrompt('missing', 'greet')).rejects.toThrow('UNKNOWN_MCP_SERVER')
    await manager.dispose()
  })
})

describe('McpManager OAuth', () => {
  const AUTH = {
    serverId: 'server-id',
    serverUrl: 'https://mcp.example.com/mcp',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 10 * 60_000,
    tokenEndpoint: 'https://auth.example.com/token',
    clientId: 'client-1',
    resource: 'https://mcp.example.com/mcp'
  }

  async function addRemote(manager: McpManager): Promise<string> {
    const server = await manager.addServer({
      name: 'remote',
      type: 'remote',
      url: AUTH.serverUrl
    })
    return server.id
  }

  it('sends bearer tokens to remote servers', async () => {
    const { client } = makeClient()
    const headers: Array<Record<string, string>> = []
    const manager = new McpManager({
      userDataPath: directory,
      workspace: directory,
      auth: [{ ...AUTH, serverId: 'placeholder' }],
      createClient: (_config, nextHeaders) => {
        headers.push(nextHeaders)
        return client
      }
    })
    const server = await manager.addServer({ name: 'remote', type: 'remote', url: AUTH.serverUrl })
    await manager.setMcpAuth([{ ...AUTH, serverId: server.id }])

    await manager.statuses({ probe: true })

    expect(headers[0]).toMatchObject({ Authorization: 'Bearer access-1' })
    await manager.dispose()
  })

  it('refreshes an expired token after a 401 and notifies the host', async () => {
    const failing = makeClient({ connectError: new Error('HTTP 401: unauthorized') })
    const success = makeClient()
    const onAuthUpdated = vi.fn()
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ access_token: 'access-2', expires_in: 300 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    let attempt = 0
    const manager = new McpManager({
      userDataPath: directory,
      workspace: directory,
      auth: [{ ...AUTH, serverId: 'pending' }],
      fetch: fetchMock,
      onAuthUpdated,
      createClient: () => {
        attempt += 1
        return attempt === 1 ? failing.client : success.client
      }
    })
    const server = await manager.addServer({ name: 'remote', type: 'remote', url: AUTH.serverUrl })
    await manager.setMcpAuth([{ ...AUTH, serverId: server.id }])

    const statuses = await manager.statuses({ probe: true })

    expect(statuses[0]).toMatchObject({ state: 'connected' })
    expect(onAuthUpdated).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'access-2' }))
    await manager.dispose()
  })

  it('does not restore auth removed while refreshing', async () => {
    const failing = makeClient({ connectError: new Error('HTTP 401: unauthorized') })
    let release: (response: Response) => void = () => undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        })
    )
    const onAuthUpdated = vi.fn()
    const manager = new McpManager({
      userDataPath: directory,
      workspace: directory,
      auth: [{ ...AUTH, serverId: 'placeholder', expiresAt: Date.now() + 1_000 }],
      fetch: fetchMock,
      onAuthUpdated,
      createClient: () => failing.client
    })
    const server = await manager.addServer({ name: 'remote', type: 'remote', url: AUTH.serverUrl })
    await manager.setMcpAuth([{ ...AUTH, serverId: server.id, expiresAt: Date.now() + 1_000 }])

    const probe = manager.statuses({ probe: true })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await manager.setMcpAuth([])
    release(
      new Response(JSON.stringify({ access_token: 'access-2', expires_in: 300 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    await probe

    expect(onAuthUpdated).not.toHaveBeenCalled()
    expect((await manager.statuses())[0]).toMatchObject({ state: 'idle' })
    await manager.dispose()
  })

  it('reports auth-required when no refresh credentials exist', async () => {
    const failing = makeClient({ connectError: new Error('HTTP 401: unauthorized') })
    const manager = new McpManager({
      userDataPath: directory,
      workspace: directory,
      createClient: () => failing.client
    })
    await addRemote(manager)

    const statuses = await manager.statuses({ probe: true })

    expect(statuses[0]).toMatchObject({ state: 'auth-required' })
    await manager.dispose()
  })

  it('drops connections when credentials change', async () => {
    const { client } = makeClient()
    const manager = new McpManager({
      userDataPath: directory,
      workspace: directory,
      createClient: () => client
    })
    await manager.addServer({ name: 'remote', type: 'remote', url: AUTH.serverUrl })
    await manager.statuses({ probe: true })

    await manager.setMcpAuth([])

    expect(client.close).toHaveBeenCalled()
    await manager.dispose()
  })
})
