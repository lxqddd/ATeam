import type { ProviderConfigInput, ProviderModelConfigInput } from './agent-types'
import type {
  ModelPublic,
  ModelVariant,
  ModelVariantInput,
  ModelsConfigPublic,
  ProviderPublic
} from './model-types'

/** Normalizes configured model variants into stable ids; invalid or duplicate names are dropped. */
export function normalizeProjectVariants(
  variants: ModelVariantInput[] | undefined
): ModelVariant[] | undefined {
  if (!variants) return undefined
  const result: ModelVariant[] = []
  const seen = new Set<string>()
  for (const variant of variants) {
    const name = typeof variant?.name === 'string' ? variant.name.trim() : ''
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!name || !id || seen.has(id)) continue
    seen.add(id)
    result.push({ id, name, settings: variant.settings ?? {} })
  }
  return result.length > 0 ? result : undefined
}

const CONFIG_CREATED_AT = '1970-01-01T00:00:00.000Z'

function modelFields(
  input: ProviderModelConfigInput,
  variants: ModelVariant[] | undefined
): Partial<ModelPublic> {
  return {
    ...(input.name ? { name: input.name } : {}),
    ...(input.contextWindow !== undefined ? { contextWindow: input.contextWindow } : {}),
    ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
    ...(input.attachment !== undefined ? { attachment: input.attachment } : {}),
    ...(input.costInput !== undefined ? { costInput: input.costInput } : {}),
    ...(input.costOutput !== undefined ? { costOutput: input.costOutput } : {}),
    ...(input.costCacheRead !== undefined ? { costCacheRead: input.costCacheRead } : {}),
    ...(input.costCacheWrite !== undefined ? { costCacheWrite: input.costCacheWrite } : {}),
    ...(input.applyPatch !== undefined ? { applyPatch: input.applyPatch } : {}),
    ...(input.compaction !== undefined ? { compaction: input.compaction } : {}),
    ...(variants ? { variants } : {})
  }
}

/**
 * Merges project-config providers into the public model catalog for display.
 *
 * Mirrors the display-layer rules of the runtime provider merge so the picker
 * lists exactly what the worker can resolve, without exposing credentials:
 * entries without a type are skipped, `openai-compatible` keeps requiring a
 * baseURL, and existing providers/models are overridden field by field.
 */
export function mergeProjectModelCatalog(
  base: ModelsConfigPublic,
  projectProviders: Record<string, ProviderConfigInput> | undefined
): ModelsConfigPublic {
  if (!projectProviders || Object.keys(projectProviders).length === 0) return base
  const providers = [...base.providers]
  const models = [...base.models]

  for (const [id, input] of Object.entries(projectProviders)) {
    const existing = providers.find((provider) => provider.id === id)
    const type = input.type ?? existing?.type
    if (!type) continue
    if (type === 'openai-compatible' && !input.baseURL && !existing?.baseURL) continue

    const provider: ProviderPublic = {
      ...(existing ?? {
        id,
        name: input.name ?? id,
        type,
        hasApiKey: false,
        createdAt: CONFIG_CREATED_AT,
        updatedAt: CONFIG_CREATED_AT
      }),
      ...(input.name ? { name: input.name } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.baseURL ? { baseURL: input.baseURL } : {}),
      // The renderer never sees credentials; an environment reference is the
      // only signal that the main process can resolve a key for this provider.
      hasApiKey: existing?.hasApiKey === true || Boolean(input.apiKeyEnv),
      source: 'config'
    }
    if (existing) {
      const index = providers.findIndex((candidate) => candidate.id === id)
      providers[index] = provider
    } else {
      providers.push(provider)
    }

    for (const [modelId, modelInput] of Object.entries(input.models ?? {})) {
      const fields = modelFields(modelInput, normalizeProjectVariants(modelInput.variants))
      const current = models.find((model) => model.providerId === id && model.modelId === modelId)
      if (current) {
        models[models.indexOf(current)] = { ...current, ...fields, source: 'config' }
        continue
      }
      models.push({
        id: `config:${id}:${modelId}`,
        providerId: id,
        modelId,
        name: modelInput.name ?? modelId,
        createdAt: CONFIG_CREATED_AT,
        ...fields,
        source: 'config'
      })
    }
  }

  const first = models[0]
  return {
    providers,
    models,
    defaultModel:
      base.defaultModel ?? (first ? { providerId: first.providerId, modelId: first.modelId } : null)
  }
}
