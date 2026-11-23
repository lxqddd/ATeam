import type { RuntimeProvider, RuntimeProviderAuth } from '@ateam/shared'

/** Overlay provider credentials saved outside the model config, such as plugin logins. */
export function applyProviderAuth(
  providers: RuntimeProvider[],
  auths: RuntimeProviderAuth[]
): RuntimeProvider[] {
  if (auths.length === 0) return providers
  const byProvider = new Map(auths.map((auth) => [auth.providerId, auth]))
  return providers.map((provider) => {
    const auth = byProvider.get(provider.id)
    if (!auth) return provider
    return {
      ...provider,
      apiKey: auth.type === 'api' ? auth.key : auth.accessToken
    }
  })
}
