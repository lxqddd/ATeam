import type { McpAuthRecord, McpServerConfig } from '@ateam/shared'
import { DEFAULT_OAUTH_CALLBACK_PORT, McpOAuthCallbackServer } from './mcp-oauth-callback'
import {
  buildAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  discoverOAuth,
  exchangeAuthorizationCode,
  registerOAuthClient
} from './mcp-oauth'

export interface McpAuthStoreLike {
  list(): McpAuthRecord[]
  get(serverId: string, serverUrl?: string): McpAuthRecord | null
  set(auth: McpAuthRecord): Promise<void>
  remove(serverId: string): Promise<void>
}

export interface AuthorizeMcpServerInput {
  server: McpServerConfig
  authStore: McpAuthStoreLike
  openExternal: (url: string) => Promise<void>
  fetch?: typeof fetch
  callbackServer?: Pick<McpOAuthCallbackServer, 'start' | 'waitForCode' | 'close' | 'redirectUri'>
  timeoutMs?: number
}

function callbackEndpoint(redirectUri: string): { port: number; path: string } {
  const url = new URL(redirectUri)
  const port = url.port ? Number(url.port) : 80
  return { port, path: url.pathname || '/mcp/oauth/callback' }
}

export async function authorizeMcpServer(input: AuthorizeMcpServerInput): Promise<McpAuthRecord> {
  const { server } = input
  if (server.type !== 'remote' || !server.url) {
    throw new Error('OAuth is only available for remote MCP servers')
  }
  const fetchImpl = input.fetch ?? fetch
  const existing = input.authStore.get(server.id, server.url)
  const discovery = await discoverOAuth(server.url, fetchImpl)
  const scope =
    server.oauthScope?.trim() || existing?.scope || discovery.resource.scopes_supported?.[0] || null
  const resource = discovery.resource.resource ?? server.url

  let callback = input.callbackServer
  let redirectUri: string
  if (callback) {
    redirectUri = server.oauthRedirectUri ?? (await callback.start())
  } else {
    const endpoint = server.oauthRedirectUri ? callbackEndpoint(server.oauthRedirectUri) : null
    const serverCallback = new McpOAuthCallbackServer({
      port: endpoint?.port ?? (server.oauthClientId ? DEFAULT_OAUTH_CALLBACK_PORT : null),
      path: endpoint?.path,
      timeoutMs: input.timeoutMs
    })
    redirectUri = server.oauthRedirectUri ?? (await serverCallback.start())
    callback = serverCallback
  }

  try {
    const client = await resolveClient({
      server,
      discovery,
      existing,
      redirectUri,
      scope,
      fetchImpl
    })
    const { verifier, challenge } = createPkcePair()
    const state = createOAuthState()
    const authorizationUrl = buildAuthorizationUrl({
      metadata: discovery.authorizationServer,
      clientId: client.client_id,
      redirectUri,
      state,
      challenge,
      scope,
      resource
    })

    const pendingCode = callback.waitForCode(state)
    try {
      await input.openExternal(authorizationUrl)
    } catch (error) {
      await pendingCode.catch(() => undefined)
      throw error
    }
    const code = await pendingCode
    const token = await exchangeAuthorizationCode(
      {
        tokenEndpoint: discovery.authorizationServer.token_endpoint,
        clientId: client.client_id,
        clientSecret: client.client_secret ?? null,
        code,
        verifier,
        redirectUri,
        resource
      },
      fetchImpl
    )
    const record: McpAuthRecord = {
      serverId: server.id,
      serverUrl: server.url,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? existing?.refreshToken ?? null,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1_000 : null,
      tokenEndpoint: discovery.authorizationServer.token_endpoint,
      clientId: client.client_id,
      clientSecret: client.client_secret ?? existing?.clientSecret ?? null,
      scope: token.scope ?? scope,
      resource
    }
    await input.authStore.set(record)
    return record
  } finally {
    await callback.close().catch(() => undefined)
  }
}

async function resolveClient(input: {
  server: McpServerConfig
  discovery: Awaited<ReturnType<typeof discoverOAuth>>
  existing: McpAuthRecord | null
  redirectUri: string
  scope: string | null
  fetchImpl: typeof fetch
}): Promise<{ client_id: string; client_secret?: string }> {
  if (input.server.oauthClientId?.trim()) {
    return {
      client_id: input.server.oauthClientId.trim(),
      client_secret: input.existing?.clientSecret ?? undefined
    }
  }
  if (input.existing?.clientId) {
    return {
      client_id: input.existing.clientId,
      client_secret: input.existing.clientSecret ?? undefined
    }
  }
  return registerOAuthClient(
    input.discovery.authorizationServer,
    { redirectUri: input.redirectUri, clientName: 'ATeam', scope: input.scope },
    input.fetchImpl
  )
}
