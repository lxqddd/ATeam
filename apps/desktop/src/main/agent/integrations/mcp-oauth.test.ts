import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  buildAuthorizationUrl,
  createPkcePair,
  discoverOAuth,
  discoverAuthorizationServer,
  exchangeAuthorizationCode,
  parseWwwAuthenticate,
  refreshOAuthToken,
  registerOAuthClient
} from './mcp-oauth'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe('PKCE', () => {
  it('creates an S256 verifier and challenge', () => {
    const { verifier, challenge } = createPkcePair()

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })
})

describe('parseWwwAuthenticate', () => {
  it('reads resource metadata and scope hints', () => {
    expect(
      parseWwwAuthenticate(
        'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files"'
      )
    ).toEqual({
      resourceMetadata: 'https://mcp.example.com/.well-known/oauth-protected-resource',
      scope: 'files'
    })
  })

  it('ignores missing headers', () => {
    expect(parseWwwAuthenticate(null)).toEqual({})
  })
})

describe('discovery', () => {
  const resourceMetadata = {
    resource: 'https://mcp.example.com/mcp',
    authorization_servers: ['https://auth.example.com'],
    scopes_supported: ['files']
  }
  const authorizationMetadata = {
    issuer: 'https://auth.example.com',
    authorization_endpoint: 'https://auth.example.com/authorize',
    token_endpoint: 'https://auth.example.com/token',
    registration_endpoint: 'https://auth.example.com/register',
    code_challenge_methods_supported: ['S256']
  }

  it('discovers from the WWW-Authenticate resource metadata URL', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === 'https://mcp.example.com/mcp') {
        return new Response('unauthorized', {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer resource_metadata="https://mcp.example.com/meta/resource"'
          }
        })
      }
      if (url === 'https://mcp.example.com/meta/resource') return jsonResponse(resourceMetadata)
      if (url === 'https://auth.example.com/.well-known/oauth-authorization-server') {
        return jsonResponse(authorizationMetadata)
      }
      return new Response('not found', { status: 404 })
    })

    const discovery = await discoverOAuth('https://mcp.example.com/mcp', fetchMock)

    expect(discovery.authorizationServer.authorization_endpoint).toBe(
      'https://auth.example.com/authorize'
    )
    expect(discovery.resource.resource).toBe('https://mcp.example.com/mcp')
  })

  it('falls back to well-known protected resource metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/.well-known/oauth-protected-resource/mcp')) {
        return jsonResponse(resourceMetadata)
      }
      if (url === 'https://auth.example.com/.well-known/oauth-authorization-server') {
        return jsonResponse(authorizationMetadata)
      }
      return new Response('not found', { status: 404 })
    })

    const discovery = await discoverOAuth('https://mcp.example.com/mcp', fetchMock)
    expect(discovery.resourceMetadataUrl).toContain('oauth-protected-resource')
  })

  it('falls back to the resource origin when no authorization servers are listed', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/.well-known/oauth-protected-resource/mcp')) {
        return jsonResponse({ resource: 'https://mcp.example.com/mcp' })
      }
      if (url === 'https://mcp.example.com/.well-known/oauth-authorization-server') {
        return jsonResponse({
          authorization_endpoint: 'https://mcp.example.com/authorize',
          token_endpoint: 'https://mcp.example.com/token'
        })
      }
      return new Response('not found', { status: 404 })
    })

    const discovery = await discoverOAuth('https://mcp.example.com/mcp', fetchMock)
    expect(discovery.authorizationServer.token_endpoint).toBe('https://mcp.example.com/token')
  })

  it('rejects insecure authorization servers', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(authorizationMetadata))
    await expect(discoverAuthorizationServer('http://auth.example.com', fetchMock)).rejects.toThrow(
      'authorization server'
    )
  })

  it('requires PKCE S256 when advertised', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ...authorizationMetadata, code_challenge_methods_supported: ['plain'] })
    )
    await expect(
      discoverAuthorizationServer('https://auth.example.com', fetchMock)
    ).rejects.toThrow('S256')
  })
})

describe('client registration', () => {
  it('posts client metadata and returns credentials', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        redirect_uris: ['http://127.0.0.1:19876/mcp/oauth/callback'],
        client_name: 'ATeam',
        token_endpoint_auth_method: 'none'
      })
      return jsonResponse({ client_id: 'client-1', client_secret: 'secret-1' }, 201)
    })

    await expect(
      registerOAuthClient(
        {
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register'
        },
        {
          redirectUri: 'http://127.0.0.1:19876/mcp/oauth/callback',
          clientName: 'ATeam'
        },
        fetchMock
      )
    ).resolves.toEqual({ client_id: 'client-1', client_secret: 'secret-1' })
  })

  it('requires a registration endpoint when no client id is configured', async () => {
    await expect(
      registerOAuthClient(
        {
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token'
        },
        { redirectUri: 'http://127.0.0.1:19876/cb', clientName: 'ATeam' }
      )
    ).rejects.toThrow('pre-registered')
  })
})

describe('authorization URL', () => {
  it('includes PKCE, state, scope and resource', () => {
    const url = new URL(
      buildAuthorizationUrl({
        metadata: {
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token'
        },
        clientId: 'client-1',
        redirectUri: 'http://127.0.0.1:19876/mcp/oauth/callback',
        state: 'state-1',
        challenge: 'challenge-1',
        scope: 'files',
        resource: 'https://mcp.example.com/mcp'
      })
    )

    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('resource')).toBe('https://mcp.example.com/mcp')
  })
})

describe('token exchange', () => {
  it('exchanges the code with the verifier and resource', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const params = new URLSearchParams(String(init?.body))
      expect(params.get('grant_type')).toBe('authorization_code')
      expect(params.get('code')).toBe('code-1')
      expect(params.get('code_verifier')).toBe('verifier-1')
      expect(params.get('resource')).toBe('https://mcp.example.com/mcp')
      return jsonResponse({ access_token: 'access-1', expires_in: 300, refresh_token: 'refresh-1' })
    })

    await expect(
      exchangeAuthorizationCode(
        {
          tokenEndpoint: 'https://auth.example.com/token',
          clientId: 'client-1',
          code: 'code-1',
          verifier: 'verifier-1',
          redirectUri: 'http://127.0.0.1:19876/cb',
          resource: 'https://mcp.example.com/mcp'
        },
        fetchMock
      )
    ).resolves.toMatchObject({ access_token: 'access-1', refresh_token: 'refresh-1' })
  })

  it('refreshes tokens', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const params = new URLSearchParams(String(init?.body))
      expect(params.get('grant_type')).toBe('refresh_token')
      expect(params.get('refresh_token')).toBe('refresh-1')
      return jsonResponse({ access_token: 'access-2', expires_in: 300 })
    })

    await expect(
      refreshOAuthToken(
        {
          tokenEndpoint: 'https://auth.example.com/token',
          clientId: 'client-1',
          refreshToken: 'refresh-1'
        },
        fetchMock
      )
    ).resolves.toMatchObject({ access_token: 'access-2' })
  })

  it('surfaces token errors', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: 'invalid_grant', error_description: 'code expired' }, 400)
    )

    await expect(
      refreshOAuthToken(
        {
          tokenEndpoint: 'https://auth.example.com/token',
          clientId: 'client-1',
          refreshToken: 'refresh-1'
        },
        fetchMock
      )
    ).rejects.toThrow('code expired')
  })
})
