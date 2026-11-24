import type { ModelMessage } from 'ai'
import type { RuntimeModelsConfig } from '@ateam/shared'
import { applyAnthropicCache } from './message-history'
import { contextTokenLimit } from './sessions/context'

type Provider = RuntimeModelsConfig['providers'][number]
type ProviderOptions = Record<string, Record<string, unknown>>

export interface ProviderTransformInput {
  provider: Pick<Provider, 'type'>
  sessionId: string
  system: string
  messages: ModelMessage[]
  nativeCompaction: boolean
  contextWindow: number
}

export interface ProviderTransformResult {
  system: string
  /** Provider options for the system message, e.g. an Anthropic cache breakpoint. */
  systemProviderOptions?: ProviderOptions
  messages: ModelMessage[]
  providerOptions?: ProviderOptions
}

const ANTHROPIC_CACHE = { anthropic: { cacheControl: { type: 'ephemeral' } } }

/** Apply provider-specific prompt shaping in one place. */
export function transformProviderRequest(input: ProviderTransformInput): ProviderTransformResult {
  const providerOptions: ProviderOptions = {}
  let systemProviderOptions: ProviderOptions | undefined
  let messages = input.messages

  if (input.provider.type === 'anthropic') {
    systemProviderOptions = ANTHROPIC_CACHE
    messages = applyAnthropicCache(messages)
    if (input.nativeCompaction) {
      providerOptions.anthropic = {
        contextManagement: {
          edits: [
            {
              type: 'compact_20260112',
              trigger: { type: 'input_tokens', value: contextTokenLimit(input.contextWindow) }
            }
          ]
        }
      }
    }
  }

  if (input.provider.type === 'openai') {
    providerOptions.openai = { promptCacheKey: input.sessionId }
  }

  return {
    system: input.system,
    messages,
    ...(systemProviderOptions ? { systemProviderOptions } : {}),
    ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {})
  }
}
