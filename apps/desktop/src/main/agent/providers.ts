import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { ModelRef, RuntimeModelsConfig } from '@ateam/shared'

export function resolveModelRef(
  config: RuntimeModelsConfig,
  ref: ModelRef | null
): { ref: ModelRef; provider: RuntimeModelsConfig['providers'][number] } {
  const target = ref ?? config.defaultModel
  if (!target) throw new Error('NO_MODEL')

  const provider = config.providers.find((candidate) => candidate.id === target.providerId)
  if (!provider) throw new Error(`MODEL_NOT_FOUND: ${target.providerId}/${target.modelId}`)

  const model = config.models.find(
    (candidate) =>
      candidate.providerId === target.providerId && candidate.modelId === target.modelId
  )
  if (!model) throw new Error(`MODEL_NOT_FOUND: ${target.providerId}/${target.modelId}`)

  return { ref: target, provider }
}

export function createLanguageModel(
  config: RuntimeModelsConfig,
  ref: ModelRef | null
): LanguageModel {
  const { ref: target, provider } = resolveModelRef(config, ref)
  const apiKey = provider.apiKey

  switch (provider.type) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL: provider.baseURL })(target.modelId)
    case 'openai':
      return createOpenAI({ apiKey, baseURL: provider.baseURL })(target.modelId)
    case 'google':
      return createGoogle({ apiKey, baseURL: provider.baseURL })(target.modelId)
    case 'openai-compatible':
      if (!provider.baseURL) throw new Error('INVALID_PROVIDER: baseURL is required')
      return createOpenAICompatible({
        name: provider.name,
        baseURL: provider.baseURL,
        apiKey
      })(target.modelId)
  }
}
