import { countTokens as countClaudeTokens } from '@anthropic-ai/tokenizer'
import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base'
import { encode as encodeO200k } from 'gpt-tokenizer/encoding/o200k_base'
import type { ProviderType } from '@ateam/shared'

export type TokenCounter = (text: string) => number

const O200K_MODELS = /(gpt-4o|gpt-4\.1|gpt-5|gpt-6|o1|o3|o4|chatgpt|codex)/i
const CL100K_MODELS = /(gpt-4$|gpt-4-|gpt-3\.5|gpt-35|davinci|curie|babbage|ada)/i

export function tokenCounterFor(
  providerType: ProviderType | undefined,
  modelId: string | undefined
): TokenCounter | undefined {
  const model = modelId?.trim() ?? ''
  if (providerType === 'anthropic' || /^claude/i.test(model)) {
    return (text) => countClaudeTokens(text)
  }
  if (providerType === 'openai' || providerType === 'openai-compatible') {
    if (O200K_MODELS.test(model)) return (text) => encodeO200k(text).length
    if (CL100K_MODELS.test(model)) return (text) => encodeCl100k(text).length
  }
  return undefined
}
