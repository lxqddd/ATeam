import type { AvailableModel, RuntimeProvider } from '@ateam/shared'
import { normalizeAnthropicBaseURL, providerHeaders } from '@ateam/agent-core/providers'

const REQUEST_TIMEOUT_MS = 15_000

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}

function trimBase(value: string): string {
  return value.replace(/\/+$/, '')
}

/** Fetch the models the provider itself exposes, using the stored credentials. */
export async function listProviderModels(provider: RuntimeProvider): Promise<AvailableModel[]> {
  const headers = providerHeaders(provider.baseURL) ?? {}

  switch (provider.type) {
    case 'anthropic': {
      const base = normalizeAnthropicBaseURL(provider.baseURL) ?? 'https://api.anthropic.com/v1'
      const data = (await getJson(`${base}/models`, {
        'x-api-key': provider.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        ...headers
      })) as { data?: Array<{ id: string; display_name?: string }> }

      return (data.data ?? []).map((model) => ({ id: model.id, name: model.display_name }))
    }
    case 'openai':
    case 'openai-compatible': {
      const base = trimBase(provider.baseURL ?? 'https://api.openai.com/v1')
      const data = (await getJson(`${base}/models`, {
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
        ...headers
      })) as { data?: Array<{ id: string; name?: string }> }

      return (data.data ?? []).map((model) => ({ id: model.id, name: model.name }))
    }
    case 'google': {
      const base = trimBase(provider.baseURL ?? 'https://generativelanguage.googleapis.com/v1beta')
      const url = new URL(`${base}/models`)
      if (provider.apiKey) url.searchParams.set('key', provider.apiKey)
      const data = (await getJson(url.toString(), headers)) as {
        models?: Array<{ name: string; displayName?: string }>
      }

      return (data.models ?? []).map((model) => ({
        id: model.name.replace(/^models\//, ''),
        name: model.displayName
      }))
    }
  }
}
