import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderAuthRecord } from '@ateam/shared'

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^enc:/, ''))
}))

vi.mock('electron', () => ({ safeStorage }))

import { ProviderAuthStore } from './provider-auth-store'
import { refreshExpiringProviderAuth, runtimeModelsWithOAuth } from './runtime-config'

const RECORD: ProviderAuthRecord = {
  providerId: 'provider-1',
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: Date.now() + 10 * 60_000,
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'client-1',
  clientSecret: 'secret-1',
  scope: 'models.read'
}

let directory: string
let store: ProviderAuthStore

beforeEach(async () => {
  safeStorage.isEncryptionAvailable.mockReturnValue(true)
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-provider-auth-')))
  store = new ProviderAuthStore(directory)
  await store.init()
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('ProviderAuthStore', () => {
  it('stores plaintext provider tokens and reloads them', async () => {
    await store.set(RECORD)
    const file = await fs.readFile(path.join(directory, 'auth.json'), 'utf8')
    expect(file).toContain('access-1')

    const reloaded = new ProviderAuthStore(directory)
    await reloaded.init()
    expect(reloaded.get('provider-1')).toEqual(RECORD)
    expect(reloaded.list()).toEqual([RECORD])
  })

  it('removes tokens and reports status', async () => {
    await store.set(RECORD)
    expect(
      store.statuses([
        {
          id: 'provider-1',
          name: 'OpenAI',
          type: 'openai',
          hasApiKey: false,
          createdAt: RECORD.accessToken,
          updatedAt: RECORD.accessToken
        }
      ])[0]
    ).toMatchObject({ authorized: true, providerName: 'OpenAI' })

    await store.remove('provider-1')
    expect(store.list()).toEqual([])
  })
})

describe('provider runtime helpers', () => {
  it('injects access tokens into provider runtime config', () => {
    const config = {
      providers: [
        { id: 'provider-1', name: 'OpenAI', type: 'openai' as const, apiKey: 'api-key' },
        { id: 'provider-2', name: 'Other', type: 'openai' as const, apiKey: 'other-key' }
      ],
      models: [],
      defaultModel: null
    }
    const injected = runtimeModelsWithOAuth(config, {
      list: () => [RECORD],
      get: (id) => (id === 'provider-1' ? RECORD : null),
      set: vi.fn(),
      remove: vi.fn()
    })

    expect(injected.providers[0].apiKey).toBe('access-1')
    expect(injected.providers[1].apiKey).toBe('other-key')
  })

  it('refreshes expiring tokens', async () => {
    const expiring = { ...RECORD, expiresAt: Date.now() + 10_000 }
    const saved: ProviderAuthRecord[] = []
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ access_token: 'access-2', expires_in: 300 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    const authStore = {
      list: () => [expiring],
      get: () => expiring,
      set: vi.fn(async (record: ProviderAuthRecord) => {
        saved.push(record)
      }),
      remove: vi.fn()
    }

    await expect(refreshExpiringProviderAuth(authStore, fetchMock)).resolves.toBe(true)
    expect(saved[0]).toMatchObject({ accessToken: 'access-2' })
  })

  it('does not restore a token removed while refreshing', async () => {
    const expiring = { ...RECORD, expiresAt: Date.now() + 10_000 }
    let current: ProviderAuthRecord | null = expiring
    let release: (response: Response) => void = () => undefined
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        })
    )
    const set = vi.fn(async () => undefined)
    const authStore = {
      list: () => [expiring],
      get: () => current,
      set,
      remove: vi.fn()
    }

    const pending = refreshExpiringProviderAuth(authStore, fetchMock)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    current = null
    release(
      new Response(JSON.stringify({ access_token: 'access-2', expires_in: 300 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )

    await expect(pending).resolves.toBe(false)
    expect(set).not.toHaveBeenCalled()
  })

  it('skips tokens that are still fresh', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const authStore = {
      list: () => [RECORD],
      get: () => RECORD,
      set: vi.fn(),
      remove: vi.fn()
    }

    await expect(refreshExpiringProviderAuth(authStore, fetchMock)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
