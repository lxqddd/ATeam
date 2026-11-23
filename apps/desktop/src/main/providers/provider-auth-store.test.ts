import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  decryptString: vi.fn((value: Buffer) => {
    const text = value.toString('utf8')
    if (!text.startsWith('enc:')) throw new Error('bad secret')
    return text.slice(4)
  })
}))

vi.mock('electron', () => ({ safeStorage }))

import { ProviderAuthStore } from './provider-auth-store'

let directory: string
let store: ProviderAuthStore

function authFile(): string {
  return path.join(directory, 'auth.json')
}

async function readAuth(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(authFile(), 'utf8')) as Record<string, unknown>
}

beforeEach(async () => {
  safeStorage.isEncryptionAvailable.mockReturnValue(true)
  safeStorage.decryptString.mockClear()
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-provider-auth-')))
  store = new ProviderAuthStore(directory)
  await store.init()
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('ProviderAuthStore', () => {
  it('stores API keys as plaintext in a 0600 auth file', async () => {
    await store.setApiKey('provider-1', 'sk-secret')

    expect(await readAuth()).toEqual({
      'provider-1': { type: 'api', key: 'sk-secret' }
    })
    expect((await fs.stat(authFile())).mode & 0o777).toBe(0o600)
    expect(store.getApiKey('provider-1')).toBe('sk-secret')
    expect(store.hasApiKey('provider-1')).toBe(true)
  })

  it('merges OAuth tokens with the stored client secret', async () => {
    await store.setClientSecret('provider-1', 'client-secret')
    await store.set({
      providerId: 'provider-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_900_000_000_000,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'client-1',
      scope: 'models.read'
    })

    const stored = await readAuth()
    expect(stored['provider-1']).toEqual({
      type: 'oauth',
      access: 'access-1',
      refresh: 'refresh-1',
      expires: 1_900_000_000_000,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'client-1',
      clientSecret: 'client-secret',
      scope: 'models.read'
    })
    expect(store.get('provider-1')).toMatchObject({
      providerId: 'provider-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_900_000_000_000,
      clientId: 'client-1',
      clientSecret: 'client-secret'
    })
    expect(store.list()).toHaveLength(1)

    await store.clearTokens('provider-1')

    expect(store.get('provider-1')).toBeNull()
    expect(store.getClientSecret('provider-1')).toBe('client-secret')
  })

  it('replaces OAuth credentials when an API key is saved', async () => {
    await store.setClientSecret('provider-1', 'client-secret')
    await store.set({
      providerId: 'provider-1',
      accessToken: 'access-1',
      refreshToken: null,
      expiresAt: null,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'client-1'
    })

    await store.setApiKey('provider-1', 'sk-secret')

    expect(await readAuth()).toEqual({
      'provider-1': { type: 'api', key: 'sk-secret' }
    })
    expect(store.getClientSecret('provider-1')).toBeNull()
  })

  it('removes provider credentials and reports statuses', async () => {
    await store.setClientSecret('provider-1', 'client-secret')
    await store.set({
      providerId: 'provider-1',
      accessToken: 'access-1',
      refreshToken: null,
      expiresAt: 1_900_000_000_000,
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'client-1'
    })

    expect(
      store.statuses([
        {
          id: 'provider-1',
          name: 'Provider',
          type: 'openai',
          authMode: 'oauth',
          oauth: null,
          hasApiKey: false,
          hasOAuthClientSecret: true,
          createdAt: '',
          updatedAt: ''
        }
      ])
    ).toEqual([
      {
        providerId: 'provider-1',
        providerName: 'Provider',
        authorized: true,
        expiresAt: new Date(1_900_000_000_000).toISOString()
      }
    ])

    await store.remove('provider-1')

    expect(await readAuth()).toEqual({})
    expect(store.list()).toEqual([])
  })

  it('migrates legacy encrypted credentials into auth.json', async () => {
    const encode = (value: string): string => Buffer.from(`enc:${value}`).toString('base64')
    await fs.mkdir(path.join(directory, 'models'), { recursive: true })
    await fs.writeFile(
      path.join(directory, 'models', 'config.json'),
      JSON.stringify({
        version: 1,
        providers: [
          { id: 'provider-api', name: 'API', type: 'anthropic', authMode: 'apiKey' },
          {
            id: 'provider-oauth',
            name: 'OAuth',
            type: 'openai',
            authMode: 'oauth',
            oauth: {
              authorizationEndpoint: 'https://auth.example.com/authorize',
              tokenEndpoint: 'https://auth.example.com/token',
              clientId: 'legacy-client'
            }
          }
        ],
        models: []
      })
    )
    await fs.writeFile(
      path.join(directory, 'models', 'secrets.json'),
      JSON.stringify({
        version: 1,
        keys: {
          'provider-api': encode('sk-legacy'),
          'oauth:provider-api': encode('legacy-client-secret'),
          'oauth:provider-oauth': encode('oauth-client-secret')
        }
      })
    )
    await fs.writeFile(
      path.join(directory, 'models', 'oauth-tokens.json'),
      JSON.stringify({
        version: 1,
        providers: {
          'provider-oauth': {
            payload: encode(
              JSON.stringify({
                providerId: 'provider-oauth',
                accessToken: 'legacy-access',
                refreshToken: 'legacy-refresh',
                expiresAt: 1_900_000_000_000,
                tokenEndpoint: 'https://auth.example.com/token',
                clientId: 'legacy-client'
              })
            ),
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      })
    )

    const migrated = new ProviderAuthStore(directory)
    await migrated.init()

    const data = await readAuth()
    expect(data['provider-api']).toEqual({ type: 'api', key: 'sk-legacy' })
    expect(data['provider-oauth']).toMatchObject({
      type: 'oauth',
      access: 'legacy-access',
      refresh: 'legacy-refresh',
      clientSecret: 'oauth-client-secret'
    })
  })

  it('skips corrupted entries', async () => {
    await fs.writeFile(
      authFile(),
      JSON.stringify({
        good: { type: 'api', key: 'sk-good' },
        bad: { type: 'oauth', access: 1 },
        alsoBad: 'nope'
      })
    )

    const reloaded = new ProviderAuthStore(directory)
    await reloaded.init()

    expect(reloaded.getApiKey('good')).toBe('sk-good')
    expect(reloaded.list()).toEqual([])
  })
})
