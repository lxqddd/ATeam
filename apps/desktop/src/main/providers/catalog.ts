import type { ModelCatalogEntry, ProviderType } from '@ateam/shared'

const CATALOG_URL = 'https://models.dev/api.json'
const DEFAULT_TIMEOUT_MS = 15_000

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function costNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function providerTypeFromNpm(value: unknown): ProviderType | null {
  if (typeof value !== 'string' || !value) return null
  if (value.includes('anthropic')) return 'anthropic'
  if (value.includes('google')) return 'google'
  if (value === '@ai-sdk/openai' || value.includes('openai')) return 'openai'
  return 'openai-compatible'
}

export function parseModelCatalog(payload: unknown): ModelCatalogEntry[] {
  if (!payload || typeof payload !== 'object') return []

  const entries: ModelCatalogEntry[] = []
  for (const [providerKey, rawProvider] of Object.entries(payload as Record<string, unknown>)) {
    if (!rawProvider || typeof rawProvider !== 'object') continue
    const provider = rawProvider as {
      id?: unknown
      name?: unknown
      api?: unknown
      npm?: unknown
      models?: unknown
    }
    if (!provider.models || typeof provider.models !== 'object' || Array.isArray(provider.models)) {
      continue
    }
    const providerId = typeof provider.id === 'string' && provider.id ? provider.id : providerKey
    const providerName =
      typeof provider.name === 'string' && provider.name ? provider.name : providerId
    const providerApi = typeof provider.api === 'string' && provider.api ? provider.api : null
    const providerType = providerTypeFromNpm(provider.npm)

    for (const [modelKey, rawModel] of Object.entries(provider.models as Record<string, unknown>)) {
      if (!rawModel || typeof rawModel !== 'object') continue
      const model = rawModel as {
        id?: unknown
        name?: unknown
        reasoning?: unknown
        attachment?: unknown
        limit?: { context?: unknown; output?: unknown }
        cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown }
      }
      const modelId = typeof model.id === 'string' && model.id ? model.id : modelKey
      entries.push({
        providerId,
        providerName,
        providerApi,
        providerType,
        modelId,
        name: typeof model.name === 'string' && model.name ? model.name : modelId,
        contextWindow: positiveNumber(model.limit?.context),
        maxOutputTokens: positiveNumber(model.limit?.output),
        reasoning: model.reasoning === true,
        attachment: model.attachment === true,
        costInput: costNumber(model.cost?.input),
        costOutput: costNumber(model.cost?.output),
        costCacheRead: costNumber(model.cost?.cache_read),
        costCacheWrite: costNumber(model.cost?.cache_write)
      })
    }
  }
  return entries
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    /aborted|timed out/i.test(error instanceof Error ? error.message : String(error))
  )
}

export async function fetchModelCatalog(
  options: { fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<ModelCatalogEntry[]> {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  let response: Response
  try {
    response = await fetchImpl(CATALOG_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Model catalog request timed out after ${timeoutMs}ms`)
    }
    throw new Error(
      `Model catalog request failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  return parseModelCatalog(await response.json())
}
