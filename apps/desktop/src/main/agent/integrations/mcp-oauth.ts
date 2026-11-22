import { createHash, randomBytes } from 'node:crypto'

const REQUEST_TIMEOUT_MS = 15_000

export interface OAuthResourceMetadata {
  resource?: string
  authorization_servers?: string[]
  scopes_supported?: string[]
}

export interface OAuthAuthorizationServerMetadata {
  issuer?: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  scopes_supported?: string[]
  code_challenge_methods_supported?: string[]
}

export interface OAuthClientRegistration {
  client_id: string
  client_secret?: string
  client_secret_expires_at?: number
}

export interface OAuthTokenResponse {
  access_token: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
}

export interface OAuthDiscovery {
  resource: OAuthResourceMetadata
  authorizationServer: OAuthAuthorizationServerMetadata
  resourceMetadataUrl: string | null
}

export interface WwwAuthenticateInfo {
  resourceMetadata?: string
  scope?: string
  error?: string
}

function base64Url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function createOAuthState(): string {
  return base64Url(randomBytes(32))
}

/** Parse a WWW-Authenticate header for RFC 9728 resource metadata hints. */
export function parseWwwAuthenticate(header: string | null): WwwAuthenticateInfo {
  if (!header) return {}
  const info: WwwAuthenticateInfo = {}
  for (const match of header.matchAll(/([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"/g)) {
    const key = match[1].toLowerCase()
    if (key === 'resource_metadata') info.resourceMetadata = match[2]
    else if (key === 'scope') info.scope = match[2]
    else if (key === 'error') info.error = match[2]
  }
  const bareError = /\berror\s*=\s*([^\s,]+)/i.exec(header)
  if (!info.error && bareError) info.error = bareError[1]
  return info
}

export function isSecureOAuthUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

function requireSecureUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isSecureOAuthUrl(value)) {
    throw new Error(`Invalid ${label} in OAuth metadata`)
  }
  return value
}

async function fetchJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<{ status: number; data: unknown; headers: Headers }> {
  const response = await fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const text = await response.text().catch(() => '')
  let data: unknown = null
  if (text.trim()) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  return { status: response.status, data, headers: response.headers }
}

function resourceMetadataUrls(serverUrl: string): string[] {
  const url = new URL(serverUrl)
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  const origin = url.origin
  return [
    `${origin}/.well-known/oauth-protected-resource${path}`,
    `${origin}/.well-known/oauth-protected-resource`
  ]
}

async function fetchResourceMetadata(
  url: string,
  fetchImpl: typeof fetch
): Promise<OAuthResourceMetadata | null> {
  try {
    const { status, data } = await fetchJson(
      url,
      { headers: { Accept: 'application/json' } },
      fetchImpl
    )
    if (status !== 200 || !data || typeof data !== 'object') return null
    const raw = data as OAuthResourceMetadata
    const servers = Array.isArray(raw.authorization_servers)
      ? raw.authorization_servers.filter((entry): entry is string => typeof entry === 'string')
      : []
    if (servers.length === 0 && typeof raw.resource !== 'string') return null
    return {
      resource: typeof raw.resource === 'string' ? raw.resource : undefined,
      authorization_servers: servers,
      scopes_supported: Array.isArray(raw.scopes_supported)
        ? raw.scopes_supported.filter((entry): entry is string => typeof entry === 'string')
        : undefined
    }
  } catch {
    return null
  }
}

/**
 * Find protected-resource metadata by probing the MCP endpoint, then by
 * falling back to the RFC 9728 well-known locations.
 */
export async function discoverResourceMetadata(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ metadata: OAuthResourceMetadata; resourceMetadataUrl: string | null } | null> {
  let resourceMetadataUrl: string | null = null
  try {
    const response = await fetchImpl(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'ATeam', version: '0.1.0' }
        }
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    resourceMetadataUrl =
      parseWwwAuthenticate(response.headers.get('www-authenticate')).resourceMetadata ?? null
  } catch {
    resourceMetadataUrl = null
  }

  if (resourceMetadataUrl && isSecureOAuthUrl(resourceMetadataUrl)) {
    const metadata = await fetchResourceMetadata(resourceMetadataUrl, fetchImpl)
    if (metadata) return { metadata, resourceMetadataUrl }
  }
  for (const url of resourceMetadataUrls(serverUrl)) {
    const metadata = await fetchResourceMetadata(url, fetchImpl)
    if (metadata) return { metadata, resourceMetadataUrl: url }
  }
  return null
}

function authorizationServerUrls(issuer: string): string[] {
  const url = new URL(issuer)
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  const origin = url.origin
  return [
    `${origin}/.well-known/oauth-authorization-server${path}`,
    `${origin}/.well-known/openid-configuration${path}`,
    `${origin}/.well-known/openid-configuration`
  ]
}

export async function discoverAuthorizationServer(
  issuer: string,
  fetchImpl: typeof fetch = fetch
): Promise<OAuthAuthorizationServerMetadata> {
  requireSecureUrl(issuer, 'authorization server')
  for (const url of authorizationServerUrls(issuer)) {
    try {
      const { status, data } = await fetchJson(
        url,
        { headers: { Accept: 'application/json' } },
        fetchImpl
      )
      if (status !== 200 || !data || typeof data !== 'object') continue
      const raw = data as Record<string, unknown>
      const authorizationEndpoint = requireSecureUrl(
        raw.authorization_endpoint,
        'authorization endpoint'
      )
      const tokenEndpoint = requireSecureUrl(raw.token_endpoint, 'token endpoint')
      const registrationEndpoint =
        raw.registration_endpoint === undefined
          ? undefined
          : requireSecureUrl(raw.registration_endpoint, 'registration endpoint')
      const methods = Array.isArray(raw.code_challenge_methods_supported)
        ? raw.code_challenge_methods_supported.filter(
            (entry): entry is string => typeof entry === 'string'
          )
        : undefined
      if (methods && !methods.includes('S256')) {
        throw new Error('OAuth server does not support PKCE S256')
      }
      return {
        issuer: typeof raw.issuer === 'string' ? raw.issuer : issuer,
        authorization_endpoint: authorizationEndpoint,
        token_endpoint: tokenEndpoint,
        registration_endpoint: registrationEndpoint,
        scopes_supported: Array.isArray(raw.scopes_supported)
          ? raw.scopes_supported.filter((entry): entry is string => typeof entry === 'string')
          : undefined
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('S256')) throw error
      /* try the next well-known location */
    }
  }
  throw new Error('OAuth authorization server metadata was not found')
}

export async function discoverOAuth(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<OAuthDiscovery> {
  const resource = await discoverResourceMetadata(serverUrl, fetchImpl)
  if (!resource) throw new Error('MCP server does not advertise OAuth metadata')
  const issuer =
    resource.metadata.authorization_servers?.[0] ??
    new URL(resource.metadata.resource ?? resource.resourceMetadataUrl ?? serverUrl).origin
  const authorizationServer = await discoverAuthorizationServer(issuer, fetchImpl)
  return {
    resource: resource.metadata,
    authorizationServer,
    resourceMetadataUrl: resource.resourceMetadataUrl
  }
}

export async function registerOAuthClient(
  metadata: OAuthAuthorizationServerMetadata,
  input: { redirectUri: string; clientName: string; scope?: string | null },
  fetchImpl: typeof fetch = fetch
): Promise<OAuthClientRegistration> {
  if (!metadata.registration_endpoint) {
    throw new Error('OAuth server requires a pre-registered client id')
  }
  const { status, data } = await fetchJson(
    metadata.registration_endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        redirect_uris: [input.redirectUri],
        client_name: input.clientName,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...(input.scope ? { scope: input.scope } : {})
      })
    },
    fetchImpl
  )
  if ((status !== 200 && status !== 201) || !data || typeof data !== 'object') {
    throw new Error('OAuth client registration failed')
  }
  const raw = data as Record<string, unknown>
  if (typeof raw.client_id !== 'string' || !raw.client_id) {
    throw new Error('OAuth client registration returned no client id')
  }
  return {
    client_id: raw.client_id,
    client_secret: typeof raw.client_secret === 'string' ? raw.client_secret : undefined,
    client_secret_expires_at:
      typeof raw.client_secret_expires_at === 'number' ? raw.client_secret_expires_at : undefined
  }
}

export function buildAuthorizationUrl(input: {
  metadata: OAuthAuthorizationServerMetadata
  clientId: string
  redirectUri: string
  state: string
  challenge: string
  scope?: string | null
  resource?: string | null
}): string {
  const url = new URL(input.metadata.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (input.scope) url.searchParams.set('scope', input.scope)
  if (input.resource) url.searchParams.set('resource', input.resource)
  return url.toString()
}

async function tokenRequest(
  tokenEndpoint: string,
  params: URLSearchParams,
  fetchImpl: typeof fetch
): Promise<OAuthTokenResponse> {
  const response = await fetchImpl(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: params.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const text = await response.text().catch(() => '')
  let data: unknown = null
  if (text.trim()) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok || !data || typeof data !== 'object') {
    const raw = (data ?? {}) as Record<string, unknown>
    const detail =
      typeof raw.error_description === 'string'
        ? raw.error_description
        : typeof raw.error === 'string'
          ? raw.error
          : text.trim().slice(0, 300)
    throw new Error(`OAuth token request failed${detail ? `: ${detail}` : ''}`)
  }
  const raw = data as Record<string, unknown>
  if (typeof raw.access_token !== 'string' || !raw.access_token) {
    throw new Error('OAuth token response has no access token')
  }
  return {
    access_token: raw.access_token,
    token_type: typeof raw.token_type === 'string' ? raw.token_type : undefined,
    expires_in: typeof raw.expires_in === 'number' ? raw.expires_in : undefined,
    refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
    scope: typeof raw.scope === 'string' ? raw.scope : undefined
  }
}

export function exchangeAuthorizationCode(
  input: {
    tokenEndpoint: string
    clientId: string
    clientSecret?: string | null
    code: string
    verifier: string
    redirectUri: string
    resource?: string | null
  },
  fetchImpl: typeof fetch = fetch
): Promise<OAuthTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.verifier
  })
  if (input.clientSecret) params.set('client_secret', input.clientSecret)
  if (input.resource) params.set('resource', input.resource)
  return tokenRequest(input.tokenEndpoint, params, fetchImpl)
}

export function refreshOAuthToken(
  input: {
    tokenEndpoint: string
    clientId: string
    clientSecret?: string | null
    refreshToken: string
    resource?: string | null
  },
  fetchImpl: typeof fetch = fetch
): Promise<OAuthTokenResponse> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId
  })
  if (input.clientSecret) params.set('client_secret', input.clientSecret)
  if (input.resource) params.set('resource', input.resource)
  return tokenRequest(input.tokenEndpoint, params, fetchImpl)
}

export async function refreshMcpAuthRecord(
  auth: import('@ateam/shared').McpAuthRecord,
  fetchImpl: typeof fetch = fetch
): Promise<import('@ateam/shared').McpAuthRecord | null> {
  if (!auth.refreshToken || !auth.tokenEndpoint || !auth.clientId) return null
  const token = await refreshOAuthToken(
    {
      tokenEndpoint: auth.tokenEndpoint,
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
      refreshToken: auth.refreshToken,
      resource: auth.resource
    },
    fetchImpl
  )
  return {
    ...auth,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? auth.refreshToken,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1_000 : auth.expiresAt,
    scope: token.scope ?? auth.scope
  }
}
