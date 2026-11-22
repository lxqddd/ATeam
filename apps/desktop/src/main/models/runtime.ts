import type { ProviderAuthRecord, RuntimeModelsConfig } from '@ateam/shared'
import { refreshProviderAuth } from './oauth-flow'
import type { ProviderAuthStoreLike } from './oauth-tokens'

/** Replace OAuth provider keys with stored access tokens before the worker config update. */
export function runtimeModelsWithOAuth(
  config: RuntimeModelsConfig,
  authStore: ProviderAuthStoreLike
): RuntimeModelsConfig {
  return {
    ...config,
    providers: config.providers.map((provider) => {
      const record = authStore.get(provider.id)
      if (!record) return provider
      return { ...provider, apiKey: record.accessToken }
    })
  }
}

/** Refresh tokens that are about to expire; returns true when the config changed. */
export async function refreshExpiringProviderAuth(
  authStore: ProviderAuthStoreLike,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  let changed = false
  for (const record of authStore.list()) {
    if (!record.expiresAt) continue
    if (record.expiresAt - Date.now() > 60_000) continue
    try {
      const refreshed = await refreshProviderAuth(record, fetchImpl)
      if (!refreshed) continue
      const current = authStore.get(record.providerId)
      if (!current || current.accessToken !== record.accessToken) continue
      await authStore.set(refreshed)
      changed = true
    } catch {
      /* keep the existing token; the provider will report an auth error */
    }
  }
  return changed
}

export function providerAuthRecord(input: {
  providerId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  tokenEndpoint: string
  clientId: string
  clientSecret?: string | null
  scope?: string | null
}): ProviderAuthRecord {
  return {
    providerId: input.providerId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt,
    tokenEndpoint: input.tokenEndpoint,
    clientId: input.clientId,
    clientSecret: input.clientSecret ?? null,
    scope: input.scope ?? null
  }
}
