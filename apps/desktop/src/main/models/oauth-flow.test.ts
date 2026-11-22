import { describe, expect, it, vi } from 'vitest'
import type { ProviderAuthRecord, ProviderOAuthConfig } from '@ateam/shared'
import { authorizeProvider, refreshProviderAuth } from './oauth-flow'

const OAUTH: ProviderOAuthConfig = {
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  clientId: 'client-1',
  scope: 'models.read'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function fakeCallback(code = 'code-1') {
  return {
    get redirectUri() {
      return 'http://127.0.0.1:19877/provider/oauth/callback'
    },
    start: vi.fn(async () => 'http://127.0.0.1:19877/provider/oauth/callback'),
    waitForCode: vi.fn(async () => code),
    close: vi.fn(async () => undefined)
  }
}

describe('authorizeProvider', () => {
  it('runs PKCE authorization and returns tokens', async () => {
    const callback = fakeCallback()
    const openExternal = vi.fn(async (_url: string) => undefined)
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const params = new URLSearchParams(String(init?.body))
      expect(params.get('code')).toBe('code-1')
      expect(params.get('client_secret')).toBe('secret-1')
      expect(params.get('code_verifier')).toBeTruthy()
      return json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 300 })
    })

    const tokens = await authorizeProvider({
      providerId: 'provider-1',
      providerName: 'OpenAI',
      oauth: OAUTH,
      clientSecret: 'secret-1',
      authStore: { list: () => [], get: () => null, set: vi.fn(), remove: vi.fn() },
      openExternal,
      fetch: fetchMock,
      callbackServer: callback
    })

    expect(tokens).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' })
    const url = new URL(openExternal.mock.calls[0][0])
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('models.read')
    expect(callback.close).toHaveBeenCalled()
  })

  it('closes the callback server when the browser fails', async () => {
    const callback = fakeCallback()

    await expect(
      authorizeProvider({
        providerId: 'provider-1',
        providerName: 'OpenAI',
        oauth: OAUTH,
        authStore: { list: () => [], get: () => null, set: vi.fn(), remove: vi.fn() },
        openExternal: async () => {
          throw new Error('no browser')
        },
        callbackServer: callback
      })
    ).rejects.toThrow('no browser')

    expect(callback.close).toHaveBeenCalled()
  })
})

describe('refreshProviderAuth', () => {
  const record: ProviderAuthRecord = {
    providerId: 'provider-1',
    accessToken: 'old',
    refreshToken: 'refresh-1',
    tokenEndpoint: OAUTH.tokenEndpoint,
    clientId: OAUTH.clientId
  }

  it('refreshes access tokens', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ access_token: 'new', expires_in: 120, refresh_token: 'refresh-2' })
    )

    await expect(refreshProviderAuth(record, fetchMock)).resolves.toMatchObject({
      accessToken: 'new',
      refreshToken: 'refresh-2'
    })
  })

  it('returns null without a refresh token', async () => {
    await expect(refreshProviderAuth({ ...record, refreshToken: null })).resolves.toBeNull()
  })
})
