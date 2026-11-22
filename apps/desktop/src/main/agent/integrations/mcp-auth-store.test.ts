import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@ateam/shared'

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  decryptString: vi.fn((value: Buffer) => {
    const text = value.toString('utf8')
    if (!text.startsWith('enc:')) throw new Error('bad secret')
    return text.slice(4)
  })
}))

vi.mock('electron', () => ({ safeStorage }))

import { McpAuthStore } from './mcp-auth-store'

const AUTH = {
  serverId: 'server-1',
  serverUrl: 'https://mcp.example.com/mcp',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: 1_900_000_000_000,
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  scope: 'files',
  resource: 'https://mcp.example.com/mcp'
}

function server(id: string, url: string): McpServerConfig {
  return {
    id,
    name: id,
    type: 'remote',
    command: null,
    args: [],
    url,
    headers: {},
    env: {},
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

let directory: string
let store: McpAuthStore

beforeEach(async () => {
  safeStorage.isEncryptionAvailable.mockReturnValue(true)
  safeStorage.decryptString.mockClear()
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-mcp-auth-')))
  store = new McpAuthStore(directory)
  await store.init()
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('McpAuthStore', () => {
  it('stores plaintext OAuth tokens and reloads them', async () => {
    await store.set(AUTH)
    const file = path.join(directory, 'agent', 'mcp-auth.json')
    const raw = await fs.readFile(file, 'utf8')
    expect(raw).toContain('access-1')
    expect(JSON.parse(raw)).toMatchObject({
      version: 2,
      servers: {
        'server-1': {
          serverUrl: AUTH.serverUrl,
          tokens: {
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            expiresAt: 1_900_000_000_000,
            scope: 'files'
          },
          clientInfo: {
            clientId: 'client-1',
            clientSecret: 'secret-1',
            tokenEndpoint: 'https://auth.example.com/token',
            resource: 'https://mcp.example.com/mcp'
          }
        }
      }
    })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)

    const reloaded = new McpAuthStore(directory)
    await reloaded.init()
    expect(reloaded.list()).toEqual([AUTH])
    expect(reloaded.get('server-1', AUTH.serverUrl)).toEqual(AUTH)
  })

  it('ignores tokens for a different server URL', async () => {
    await store.set(AUTH)

    expect(store.get('server-1', 'https://other.example.com/mcp')).toBeNull()
    expect(store.statuses([server('server-1', 'https://other.example.com/mcp')])[0]).toMatchObject({
      authorized: false
    })
  })

  it('reports authorization status with expiry', async () => {
    await store.set(AUTH)

    expect(store.statuses([server('server-1', AUTH.serverUrl)])[0]).toEqual({
      serverId: 'server-1',
      serverName: 'server-1',
      authorized: true,
      expiresAt: new Date(1_900_000_000_000).toISOString()
    })
  })

  it('removes credentials', async () => {
    await store.set(AUTH)
    await store.remove('server-1')

    expect(store.list()).toEqual([])
    const reloaded = new McpAuthStore(directory)
    await reloaded.init()
    expect(reloaded.list()).toEqual([])
  })

  it('migrates legacy encrypted entries', async () => {
    const file = path.join(directory, 'agent', 'mcp-auth.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        servers: {
          'server-1': {
            serverUrl: AUTH.serverUrl,
            payload: Buffer.from(`enc:${JSON.stringify(AUTH)}`).toString('base64'),
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      })
    )

    const migrated = new McpAuthStore(directory)
    await migrated.init()

    expect(migrated.get('server-1', AUTH.serverUrl)).toEqual(AUTH)
    const raw = await fs.readFile(file, 'utf8')
    expect(raw).toContain('access-1')
    expect(JSON.parse(raw)).toMatchObject({
      version: 2,
      servers: { 'server-1': { tokens: { accessToken: 'access-1' } } }
    })
  })

  it('skips corrupted entries', async () => {
    const file = path.join(directory, 'agent', 'mcp-auth.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 2,
        servers: {
          good: {
            serverUrl: AUTH.serverUrl,
            tokens: { accessToken: 'access-good' },
            updatedAt: 'x'
          },
          bad: { serverUrl: AUTH.serverUrl, tokens: { accessToken: 1 } }
        }
      })
    )

    const reloaded = new McpAuthStore(directory)
    await reloaded.init()
    expect(reloaded.list()).toHaveLength(1)
    expect(reloaded.get('good')).toMatchObject({ accessToken: 'access-good' })
  })
})
