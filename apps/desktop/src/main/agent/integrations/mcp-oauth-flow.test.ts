import { describe, expect, it, vi } from 'vitest'
import type { McpAuthRecord, McpServerConfig } from '@ateam/shared'
import { authorizeMcpServer } from './mcp-oauth-flow'
import { refreshMcpAuthRecord } from './mcp-oauth'

const SERVER: McpServerConfig = {
  id: 'server-1',
  name: 'demo',
  type: 'remote',
  command: null,
  args: [],
  url: 'https://mcp.example.com/mcp',
  headers: {},
  env: {},
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function responsiveFetch() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url === SERVER.url) {
      return new Response('unauthorized', {
        status: 401,
        headers: {
          'www-authenticate':
            'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"'
        }
      })
    }
    if (url.endsWith('oauth-protected-resource')) {
      return json({
        resource: SERVER.url,
        authorization_servers: ['https://auth.example.com'],
        scopes_supported: ['files']
      })
    }
    if (url.endsWith('oauth-authorization-server')) {
      return json({
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        registration_endpoint: 'https://auth.example.com/register'
      })
    }
    if (url === 'https://auth.example.com/register') {
      return json({ client_id: 'client-1', client_secret: 'secret-1' }, 201)
    }
    if (url === 'https://auth.example.com/token') {
      const params = new URLSearchParams(String(init?.body))
      expect(params.get('code')).toBe('code-1')
      expect(params.get('resource')).toBe(SERVER.url)
      return json({ access_token: 'access-1', expires_in: 300, refresh_token: 'refresh-1' })
    }
    return new Response('not found', { status: 404 })
  })
}

function fakeCallback(code = 'code-1') {
  const calls: string[] = []
  return {
    calls,
    server: {
      get redirectUri() {
        return 'http://127.0.0.1:19876/mcp/oauth/callback'
      },
      async start() {
        calls.push('start')
        return 'http://127.0.0.1:19876/mcp/oauth/callback'
      },
      waitForCode(state: string) {
        calls.push(`wait:${state}`)
        return Promise.resolve(code)
      },
      async close() {
        calls.push('close')
      }
    }
  }
}

function fakeStore(existing: McpAuthRecord | null = null) {
  const records: McpAuthRecord[] = existing ? [existing] : []
  return {
    records,
    list: () => records,
    get: () => (existing ? (records[0] ?? null) : null),
    set: vi.fn(async (auth: McpAuthRecord) => {
      records.push(auth)
    }),
    remove: vi.fn(async () => undefined)
  }
}

describe('authorizeMcpServer', () => {
  it('runs discovery, registration, PKCE exchange and stores tokens', async () => {
    const callback = fakeCallback()
    const store = fakeStore()
    const fetchMock = responsiveFetch()
    const openExternal = vi.fn(async (_url: string) => undefined)

    const auth = await authorizeMcpServer({
      server: SERVER,
      authStore: store,
      openExternal,
      fetch: fetchMock,
      callbackServer: callback.server
    })

    expect(auth).toMatchObject({
      serverId: 'server-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      tokenEndpoint: 'https://auth.example.com/token',
      resource: SERVER.url
    })
    expect(auth.expiresAt).toBeGreaterThan(Date.now())
    expect(store.set).toHaveBeenCalledWith(auth)
    expect(callback.calls).toEqual(expect.arrayContaining(['start', 'close']))

    const authorizationUrl = new URL(openExternal.mock.calls[0][0])
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizationUrl.searchParams.get('resource')).toBe(SERVER.url)
    expect(authorizationUrl.searchParams.get('scope')).toBe('files')
  })

  it('uses a configured client id without dynamic registration', async () => {
    const store = fakeStore()
    const fetchMock = responsiveFetch()
    const registerCalls: string[] = []
    const wrapped = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes('/register')) registerCalls.push(String(input))
      return fetchMock(input, init)
    })

    await authorizeMcpServer({
      server: { ...SERVER, oauthClientId: 'pre-registered', oauthScope: 'read' },
      authStore: store,
      openExternal: vi.fn(async () => undefined),
      fetch: wrapped,
      callbackServer: fakeCallback().server
    })

    expect(registerCalls).toEqual([])
  })

  it('closes the callback server when the browser cannot be opened', async () => {
    const callback = fakeCallback()
    const store = fakeStore()

    await expect(
      authorizeMcpServer({
        server: SERVER,
        authStore: store,
        openExternal: async () => {
          throw new Error('no browser')
        },
        fetch: responsiveFetch(),
        callbackServer: callback.server
      })
    ).rejects.toThrow('no browser')

    expect(callback.calls).toContain('close')
    expect(store.set).not.toHaveBeenCalled()
  })
})

describe('refreshMcpAuthRecord', () => {
  const auth: McpAuthRecord = {
    serverId: 'server-1',
    serverUrl: SERVER.url ?? '',
    accessToken: 'old',
    refreshToken: 'refresh-1',
    tokenEndpoint: 'https://auth.example.com/token',
    clientId: 'client-1',
    resource: SERVER.url
  }

  it('refreshes and updates expiry', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ access_token: 'new', expires_in: 120, refresh_token: 'refresh-2' })
    )

    await expect(refreshMcpAuthRecord(auth, fetchMock)).resolves.toMatchObject({
      accessToken: 'new',
      refreshToken: 'refresh-2'
    })
  })

  it('returns null without refresh credentials', async () => {
    await expect(refreshMcpAuthRecord({ ...auth, refreshToken: null })).resolves.toBeNull()
  })
})
