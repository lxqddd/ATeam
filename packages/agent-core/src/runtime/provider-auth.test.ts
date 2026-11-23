import { describe, expect, it } from 'vitest'
import type { RuntimeProvider } from '@ateam/shared'
import { applyProviderAuth } from './provider-auth'

describe('applyProviderAuth', () => {
  it('applies api keys and oauth access tokens by provider id', () => {
    const providers: RuntimeProvider[] = [
      { id: 'api-provider', name: 'API', type: 'openai' },
      { id: 'oauth-provider', name: 'OAuth', type: 'openai', apiKey: 'stale' },
      { id: 'untouched', name: 'Untouched', type: 'anthropic', apiKey: 'keep' }
    ]

    expect(
      applyProviderAuth(providers, [
        { providerId: 'api-provider', type: 'api', key: 'api-key' },
        { providerId: 'oauth-provider', type: 'oauth', accessToken: 'access-token' }
      ])
    ).toEqual([
      { id: 'api-provider', name: 'API', type: 'openai', apiKey: 'api-key' },
      { id: 'oauth-provider', name: 'OAuth', type: 'openai', apiKey: 'access-token' },
      { id: 'untouched', name: 'Untouched', type: 'anthropic', apiKey: 'keep' }
    ])
  })

  it('returns the same provider references when no credentials match', () => {
    const providers: RuntimeProvider[] = [{ id: 'p', name: 'P', type: 'openai', apiKey: 'key' }]
    const result = applyProviderAuth(providers, [])
    expect(result).toEqual(providers)
    expect(result[0]).toBe(providers[0])
  })
})
