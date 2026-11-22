import type { ProviderType } from '@ateam/shared'

export type TokenCounter = (text: string) => number

type TokenFamily = 'o200k' | 'cl100k' | 'claude2'

const O200K_MODELS = /^(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|gpt-6|o[1-9]|chatgpt|codex)/i
const CL100K_MODELS = /^(gpt-4($|-)|gpt-3\.5|gpt-35|davinci|curie|babbage|ada)/i

const loaders = new Map<TokenFamily, Promise<TokenCounter>>()

function loadFamily(family: TokenFamily): Promise<TokenCounter> {
  let loader = loaders.get(family)
  if (!loader) {
    loader =
      family === 'o200k'
        ? import('gpt-tokenizer/encoding/o200k_base').then(
            (module) => (text) => module.encode(text).length
          )
        : family === 'cl100k'
          ? import('gpt-tokenizer/encoding/cl100k_base').then(
              (module) => (text) => module.encode(text).length
            )
          : import('@anthropic-ai/tokenizer').then((module) => (text) => module.countTokens(text))
    loaders.set(family, loader)
  }
  return loader
}

function familyFor(
  providerType: ProviderType | undefined,
  modelId: string | undefined
): TokenFamily | undefined {
  const model = modelId?.trim() ?? ''
  if (providerType === 'anthropic') {
    return /^claude-2/i.test(model) ? 'claude2' : undefined
  }
  if (providerType === 'openai' || providerType === 'openai-compatible') {
    if (O200K_MODELS.test(model)) return 'o200k'
    if (CL100K_MODELS.test(model)) return 'cl100k'
  }
  return undefined
}

export async function tokenCounterFor(
  providerType: ProviderType | undefined,
  modelId: string | undefined
): Promise<TokenCounter | undefined> {
  const family = familyFor(providerType, modelId)
  if (!family) return undefined
  try {
    return await loadFamily(family)
  } catch {
    return undefined
  }
}
