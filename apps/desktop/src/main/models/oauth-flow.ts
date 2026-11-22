import type { ProviderOAuthConfig } from '@ateam/shared'
import { McpOAuthCallbackServer } from '../agent/integrations/mcp-oauth-callback'
import {
  createOAuthState,
  createPkcePair,
  exchangeAuthorizationCode,
  refreshOAuthToken,
  type OAuthTokenResponse
} from '../agent/integrations/mcp-oauth'
import type { ProviderAuthStoreLike } from './oauth-tokens'

export const DEFAULT_PROVIDER_CALLBACK_PORT = 19_877
export const PROVIDER_CALLBACK_PATH = '/provider/oauth/callback'

export interface AuthorizeProviderInput {
  providerId: string
  providerName: string
  oauth: ProviderOAuthConfig
  clientSecret?: string | null
  authStore: ProviderAuthStoreLike
  openExternal: (url: string) => Promise<void>
  fetch?: typeof fetch
  callbackServer?: Pick<McpOAuthCallbackServer, 'start' | 'waitForCode' | 'close' | 'redirectUri'>
  timeoutMs?: number
}

function callbackPort(redirectUri: string): number {
  const url = new URL(redirectUri)
  return url.port ? Number(url.port) : 80
}

function authorizationUrl(
  oauth: ProviderOAuthConfig,
  input: { redirectUri: string; state: string; challenge: string }
): string {
  const url = new URL(oauth.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', oauth.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (oauth.scope) url.searchParams.set('scope', oauth.scope)
  return url.toString()
}

export async function authorizeProvider(input: AuthorizeProviderInput): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scope: string | null
}> {
  const { oauth } = input
  let callback = input.callbackServer
  let redirectUri: string
  if (callback) {
    redirectUri = oauth.redirectUri ?? (await callback.start())
  } else {
    const server = new McpOAuthCallbackServer({
      port: oauth.redirectUri ? callbackPort(oauth.redirectUri) : DEFAULT_PROVIDER_CALLBACK_PORT,
      path: oauth.redirectUri ? new URL(oauth.redirectUri).pathname : PROVIDER_CALLBACK_PATH,
      timeoutMs: input.timeoutMs
    })
    redirectUri = oauth.redirectUri ?? (await server.start())
    callback = server
  }

  try {
    const { verifier, challenge } = createPkcePair()
    const state = createOAuthState()
    const pendingCode = callback.waitForCode(state)
    try {
      await input.openExternal(authorizationUrl(oauth, { redirectUri, state, challenge }))
    } catch (error) {
      await pendingCode.catch(() => undefined)
      throw error
    }
    const code = await pendingCode
    const token = await exchangeAuthorizationCode(
      {
        tokenEndpoint: oauth.tokenEndpoint,
        clientId: oauth.clientId,
        clientSecret: input.clientSecret,
        code,
        verifier,
        redirectUri
      },
      input.fetch
    )
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1_000 : null,
      scope: token.scope ?? oauth.scope ?? null
    }
  } finally {
    await callback.close().catch(() => undefined)
  }
}

export async function refreshProviderAuth(
  record: import('@ateam/shared').ProviderAuthRecord,
  fetchImpl: typeof fetch = fetch
): Promise<import('@ateam/shared').ProviderAuthRecord | null> {
  if (!record.refreshToken) return null
  const token: OAuthTokenResponse = await refreshOAuthToken(
    {
      tokenEndpoint: record.tokenEndpoint,
      clientId: record.clientId,
      clientSecret: record.clientSecret,
      refreshToken: record.refreshToken
    },
    fetchImpl
  )
  return {
    ...record,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? record.refreshToken,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1_000 : record.expiresAt,
    scope: token.scope ?? record.scope
  }
}
