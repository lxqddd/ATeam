import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerConfig } from '@ateam/shared'

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^enc:/, ''))
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
  safeStorage.encryptString.mockClear()
  safeStorage.decryptString.mockClear()
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-mcp-auth-')))
  store = new McpAuthStore(directory)
  await store.init()
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('McpAuthStore', () => {
  it('encrypts, reloads and lists OAuth records', async () => {
    await store.set(AUTH)
    const encrypted = await fs.readFile(path.join(directory, 'agent', 'mcp-auth.json'), 'utf8')
    expect(encrypted).not.toContain('access-1')

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

  it('requires safe storage to persist tokens', async () => {
    safeStorage.isEncryptionAvailable.mockReturnValue(false)

    await expect(store.set(AUTH)).rejects.toThrow('ENCRYPTION_UNAVAILABLE')
    expect(store.list()).toEqual([])
  })

  it('skips corrupted entries', async () => {
    const file = path.join(directory, 'agent', 'mcp-auth.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        servers: {
          good: {
            serverUrl: AUTH.serverUrl,
            payload: Buffer.from('enc:not json').toString('base64'),
            updatedAt: 'x'
          },
          bad: { serverUrl: AUTH.serverUrl, payload: 1 }
        }
      })
    )

    const reloaded = new McpAuthStore(directory)
    await reloaded.init()
    expect(reloaded.list()).toEqual([])
  })
})
