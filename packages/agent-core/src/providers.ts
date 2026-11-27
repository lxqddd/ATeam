import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { randomUUID } from 'node:crypto'
import type { LanguageModel } from 'ai'
import {
  normalizeProjectVariants,
  type ChatRetryStatus,
  type ModelPublic,
  type ModelRef,
  type ProviderConfigInput,
  type RetryConfig,
  type RuntimeModelsConfig
} from '@ateam/shared'
import { createRetryFetch } from './retry-fetch'

const PROJECT_MODEL_CREATED_AT = '1970-01-01T00:00:00.000Z'

/** Merge project provider overlays into the desktop-owned runtime model config. */
export function mergeRuntimeProviders(
  base: RuntimeModelsConfig,
  configured: Record<string, ProviderConfigInput> | undefined,
  env: NodeJS.ProcessEnv = process.env,
  onWarning?: (message: string) => void
): RuntimeModelsConfig {
  if (!configured || Object.keys(configured).length === 0) return base
  const providers = [...base.providers]
  const models = [...base.models]

  for (const [id, input] of Object.entries(configured)) {
    const existing = providers.find((provider) => provider.id === id)
    const type = input.type ?? existing?.type
    if (!type) {
      onWarning?.(`provider ${id} has no type and no global provider to inherit from`)
      continue
    }
    if (type === 'openai-compatible' && !input.baseURL && !existing?.baseURL) {
      onWarning?.(`provider ${id} requires baseURL for openai-compatible`)
      continue
    }
    const envKey = input.apiKeyEnv ? env[input.apiKeyEnv] : undefined
    const endpointChanged =
      Boolean(existing) &&
      ((input.baseURL !== undefined && input.baseURL !== existing?.baseURL) ||
        (input.type !== undefined && input.type !== existing?.type))
    if (existing && endpointChanged && !envKey) {
      onWarning?.(
        `provider ${id} endpoint override ignored: apiKeyEnv credential is required to redirect an existing provider`
      )
    }
    const allowEndpointOverride = !existing || !endpointChanged || Boolean(envKey)
    const apiKey = existing ? (envKey ?? existing.apiKey) : envKey
    if (!existing && !apiKey) {
      onWarning?.(`provider ${id} has no credential (apiKeyEnv=${input.apiKeyEnv ?? 'unset'})`)
    }
    const merged = {
      ...(existing ?? { id, name: input.name ?? id, type }),
      ...(input.name ? { name: input.name } : {}),
      ...(allowEndpointOverride && input.type ? { type: input.type } : {}),
      ...(allowEndpointOverride && input.baseURL ? { baseURL: input.baseURL } : {}),
      ...(apiKey ? { apiKey } : {})
    }
    if (existing) {
      const index = providers.findIndex((provider) => provider.id === id)
      providers[index] = merged
    } else {
      providers.push(merged)
    }

    for (const [modelId, modelInput] of Object.entries(input.models ?? {})) {
      const variants = normalizeProjectVariants(modelInput.variants)
      const current = models.find((model) => model.providerId === id && model.modelId === modelId)
      if (current) {
        const index = models.indexOf(current)
        models[index] = {
          ...current,
          ...(modelInput.name ? { name: modelInput.name } : {}),
          ...(modelInput.contextWindow !== undefined
            ? { contextWindow: modelInput.contextWindow }
            : {}),
          ...(modelInput.maxOutputTokens !== undefined
            ? { maxOutputTokens: modelInput.maxOutputTokens }
            : {}),
          ...(modelInput.reasoning !== undefined ? { reasoning: modelInput.reasoning } : {}),
          ...(modelInput.attachment !== undefined ? { attachment: modelInput.attachment } : {}),
          ...(modelInput.costInput !== undefined ? { costInput: modelInput.costInput } : {}),
          ...(modelInput.costOutput !== undefined ? { costOutput: modelInput.costOutput } : {}),
          ...(modelInput.costCacheRead !== undefined
            ? { costCacheRead: modelInput.costCacheRead }
            : {}),
          ...(modelInput.costCacheWrite !== undefined
            ? { costCacheWrite: modelInput.costCacheWrite }
            : {}),
          ...(modelInput.applyPatch !== undefined ? { applyPatch: modelInput.applyPatch } : {}),
          ...(modelInput.compaction !== undefined ? { compaction: modelInput.compaction } : {}),
          ...(variants ? { variants } : {})
        }
        continue
      }
      const model: ModelPublic = {
        id: `config:${id}:${modelId}`,
        providerId: id,
        modelId,
        name: modelInput.name ?? modelId,
        createdAt: PROJECT_MODEL_CREATED_AT,
        ...(modelInput.contextWindow !== undefined
          ? { contextWindow: modelInput.contextWindow }
          : {}),
        ...(modelInput.maxOutputTokens !== undefined
          ? { maxOutputTokens: modelInput.maxOutputTokens }
          : {}),
        ...(modelInput.reasoning !== undefined ? { reasoning: modelInput.reasoning } : {}),
        ...(modelInput.attachment !== undefined ? { attachment: modelInput.attachment } : {}),
        ...(modelInput.costInput !== undefined ? { costInput: modelInput.costInput } : {}),
        ...(modelInput.costOutput !== undefined ? { costOutput: modelInput.costOutput } : {}),
        ...(modelInput.costCacheRead !== undefined
          ? { costCacheRead: modelInput.costCacheRead }
          : {}),
        ...(modelInput.costCacheWrite !== undefined
          ? { costCacheWrite: modelInput.costCacheWrite }
          : {}),
        ...(modelInput.applyPatch !== undefined ? { applyPatch: modelInput.applyPatch } : {}),
        ...(modelInput.compaction !== undefined ? { compaction: modelInput.compaction } : {}),
        ...(variants ? { variants } : {})
      }
      models.push(model)
    }
  }

  // A project can be the only source of models; fall back to its first model so
  // a session without an explicit model can still send.
  const first = models[0]
  return {
    providers,
    models,
    defaultModel:
      base.defaultModel ?? (first ? { providerId: first.providerId, modelId: first.modelId } : null)
  }
}

export function resolveModelRef(
  config: RuntimeModelsConfig,
  ref: ModelRef | null
): {
  ref: ModelRef
  provider: RuntimeModelsConfig['providers'][number]
  model: RuntimeModelsConfig['models'][number]
} {
  const target = ref ?? config.defaultModel
  if (!target) throw new Error('NO_MODEL')

  const provider = config.providers.find((candidate) => candidate.id === target.providerId)
  if (!provider) throw new Error(`MODEL_NOT_FOUND: ${target.providerId}/${target.modelId}`)

  const model = config.models.find(
    (candidate) =>
      candidate.providerId === target.providerId && candidate.modelId === target.modelId
  )
  if (!model) throw new Error(`MODEL_NOT_FOUND: ${target.providerId}/${target.modelId}`)

  return { ref: target, provider, model }
}

/** OpenCode Go requires a per-conversation routing header on every request. */
export function providerHeaders(
  baseURL: string | undefined,
  sessionId?: string
): Record<string, string> | undefined {
  if (!baseURL) return undefined
  try {
    const host = new URL(baseURL).hostname
    if (host === 'opencode.ai' || host.endsWith('.opencode.ai')) {
      return { 'x-opencode-session': sessionId ?? randomUUID() }
    }
  } catch {
    return undefined
  }
  return undefined
}

/** The Anthropic SDK appends `/messages` to its baseURL, which must include the version segment. */
export function normalizeAnthropicBaseURL(baseURL: string | undefined): string | undefined {
  if (!baseURL) return undefined
  const trimmed = baseURL.replace(/\/+$/, '')
  try {
    const pathname = new URL(trimmed).pathname
    if (/\/v\d+$/.test(pathname)) return trimmed
  } catch {
    return trimmed
  }
  return `${trimmed}/v1`
}

export function createLanguageModel(
  config: RuntimeModelsConfig,
  ref: ModelRef | null,
  options: {
    sessionId?: string
    retry?: RetryConfig
    onRetry?: (info: ChatRetryStatus | null) => void
  } = {}
): LanguageModel {
  const { ref: target, provider } = resolveModelRef(config, ref)
  const apiKey = provider.apiKey
  const headers = providerHeaders(provider.baseURL, options.sessionId)
  const fetch = createRetryFetch({
    onRetry: options.onRetry,
    ...(options.retry
      ? {
          maxAttempts: options.retry.maxRetries + 1,
          maxDelayMs: options.retry.maxDelayMs,
          timeoutMs: options.retry.timeoutMs
        }
      : {})
  })

  switch (provider.type) {
    case 'anthropic':
      return createAnthropic({
        apiKey,
        baseURL: normalizeAnthropicBaseURL(provider.baseURL),
        headers,
        fetch
      })(target.modelId)
    case 'openai':
      return createOpenAI({ apiKey, baseURL: provider.baseURL, headers, fetch })(target.modelId)
    case 'google':
      return createGoogle({ apiKey, baseURL: provider.baseURL, headers, fetch })(target.modelId)
    case 'openai-compatible':
      if (!provider.baseURL) throw new Error('INVALID_PROVIDER: baseURL is required')
      return createOpenAICompatible({
        name: provider.name,
        baseURL: provider.baseURL,
        apiKey,
        headers,
        fetch
      })(target.modelId)
  }
}
