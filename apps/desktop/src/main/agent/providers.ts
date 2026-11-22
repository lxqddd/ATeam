import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { randomUUID } from 'node:crypto'
import type { LanguageModel } from 'ai'
import type { ChatRetryStatus, ModelRef, RuntimeModelsConfig } from '@ateam/shared'
import { createRetryFetch } from '../models/retry-fetch'

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
    onRetry?: (info: ChatRetryStatus | null) => void
  } = {}
): LanguageModel {
  const { ref: target, provider } = resolveModelRef(config, ref)
  const apiKey = provider.apiKey
  const headers = providerHeaders(provider.baseURL, options.sessionId)
  const fetch = createRetryFetch({ onRetry: options.onRetry })

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
