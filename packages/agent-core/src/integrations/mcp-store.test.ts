import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpStore, readMcpServers } from './mcp-store'

let directory: string
let store: McpStore

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-mcp-')))
  store = new McpStore(directory)
  await store.init()
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('McpStore', () => {
  it('starts without servers', async () => {
    expect(store.list()).toEqual([])
    expect(await readMcpServers(directory)).toEqual([])
  })

  it('stores local servers with normalized fields', async () => {
    const server = await store.add({
      name: ' filesystem ',
      type: 'local',
      command: ' npx ',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: { HOME: '/tmp/home' },
      headers: { 'X-Ignored': 'value' }
    })

    expect(server).toMatchObject({
      name: 'filesystem',
      type: 'local',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      url: null,
      env: { HOME: '/tmp/home' },
      headers: {},
      enabled: true
    })
    expect(server.id).toBeTruthy()
    expect(store.list()).toHaveLength(1)
  })

  it('stores remote servers with headers', async () => {
    const server = await store.add({
      name: 'docs',
      type: 'remote',
      url: ' https://mcp.example.com/v1 ',
      headers: { Authorization: 'Bearer token' }
    })

    expect(server).toMatchObject({
      type: 'remote',
      url: 'https://mcp.example.com/v1',
      command: null,
      args: [],
      env: {},
      headers: { Authorization: 'Bearer token' }
    })
  })

  it('stores per-server timeout and working directory', async () => {
    const local = await store.add({
      name: 'local',
      type: 'local',
      command: 'node',
      timeout: 5_000,
      cwd: ' packages/app '
    })
    expect(local).toMatchObject({ timeout: 5_000, cwd: 'packages/app' })

    const remote = await store.add({
      name: 'remote',
      type: 'remote',
      url: 'https://example.com/mcp',
      timeout: 2_000,
      cwd: '/ignored'
    })
    expect(remote).toMatchObject({ timeout: 2_000, cwd: null })

    const cleared = await store.update(local.id, { timeout: null, cwd: null })
    expect(cleared).toMatchObject({ timeout: null, cwd: null })

    const reloaded = new McpStore(directory)
    await reloaded.init()
    expect(reloaded.list().find((server) => server.name === 'local')).toMatchObject({
      timeout: null,
      cwd: null
    })
  })

  it('rejects invalid timeouts and working directories', async () => {
    await expect(
      store.add({ name: 'fast', type: 'local', command: 'node', timeout: 10 })
    ).rejects.toThrow('between 100 and 600000')
    await expect(
      store.add({ name: 'bad-cwd', type: 'local', command: 'node', cwd: 'a\nb' })
    ).rejects.toThrow('invalid characters')
  })

  it('requires a command for local servers', async () => {
    await expect(store.add({ name: 'local', type: 'local' })).rejects.toThrow(
      'Local MCP servers require a command'
    )
  })

  it('requires an http(s) url for remote servers', async () => {
    await expect(
      store.add({ name: 'remote', type: 'remote', url: 'ftp://example.com' })
    ).rejects.toThrow('Remote MCP servers require an http(s) URL')
    await expect(store.add({ name: 'remote2', type: 'remote' })).rejects.toThrow(
      'Remote MCP servers require an http(s) URL'
    )
  })

  it('rejects duplicate names case-insensitively', async () => {
    await store.add({ name: 'GitHub', type: 'remote', url: 'https://example.com/mcp' })

    await expect(
      store.add({ name: 'github', type: 'remote', url: 'https://example.com/other' })
    ).rejects.toThrow('already used')
  })

  it('rejects newlines in header values', async () => {
    await expect(
      store.add({
        name: 'bad',
        type: 'remote',
        url: 'https://example.com',
        headers: { 'X-Test': 'a\r\nInjected: b' }
      })
    ).rejects.toThrow('Invalid header')
  })

  it('updates and removes servers and persists changes', async () => {
    const server = await store.add({
      name: 'docs',
      type: 'remote',
      url: 'https://example.com/mcp'
    })

    const updated = await store.update(server.id, {
      enabled: false,
      headers: { 'X-Team': 'ateam' }
    })
    expect(updated).toMatchObject({ enabled: false, headers: { 'X-Team': 'ateam' } })
    expect(updated.createdAt).toBe(server.createdAt)
    await expect(store.update(server.id, { name: 'Docs Copy' })).resolves.toMatchObject({
      name: 'Docs Copy'
    })

    await expect(store.remove(server.id)).resolves.toBe(true)
    expect(store.list()).toEqual([])
    const reloaded = new McpStore(directory)
    await reloaded.init()
    expect(reloaded.list()).toEqual([])
  })

  it('stores OAuth settings for remote servers', async () => {
    const server = await store.add({
      name: 'oauth',
      type: 'remote',
      url: 'https://mcp.example.com/mcp',
      oauthClientId: 'client-1',
      oauthScope: 'files',
      oauthRedirectUri: 'http://127.0.0.1:19876/mcp/oauth/callback'
    })

    expect(server).toMatchObject({
      oauthClientId: 'client-1',
      oauthScope: 'files',
      oauthRedirectUri: 'http://127.0.0.1:19876/mcp/oauth/callback'
    })
    const reloaded = new McpStore(directory)
    await reloaded.init()
    expect(reloaded.list()[0]).toMatchObject({ oauthClientId: 'client-1' })

    await expect(
      store.add({
        name: 'bad',
        type: 'remote',
        url: 'https://evil.example.com/mcp',
        oauthRedirectUri: 'http://evil.example.com/callback'
      })
    ).rejects.toThrow('localhost')
  })

  it('rejects unknown ids and partial updates that break validation', async () => {
    await expect(store.update('missing', { enabled: false })).rejects.toThrow('not found')

    const server = await store.add({ name: 'docs', type: 'local', command: 'node' })
    await expect(store.update(server.id, { type: 'remote' })).rejects.toThrow(
      'Remote MCP servers require an http(s) URL'
    )
  })

  it('keeps valid entries when the stored file contains invalid ones', async () => {
    const file = path.join(directory, 'agent', 'mcp.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        servers: [
          {
            id: 'a',
            name: 'ok',
            type: 'local',
            command: 'node',
            args: [],
            headers: {},
            env: {},
            enabled: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          },
          {
            id: 'b',
            name: 'bad',
            type: 'local',
            command: '',
            args: [],
            headers: {},
            env: {},
            enabled: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          },
          'nonsense'
        ]
      })
    )

    const servers = await readMcpServers(directory)
    expect(servers.map((server) => server.name)).toEqual(['ok'])
  })
})
