import type { ModelRef } from '@ateam/shared'
import { ANTHROPIC_PROMPT } from './anthropic'
import { DEFAULT_PROMPT } from './default'
import { GOOGLE_PROMPT } from './google'
import { KIMI_PROMPT } from './kimi'
import { OPENAI_PROMPT } from './openai'

export interface ModelPrompt {
  /** Stable identifier used by tests and prompt provenance. */
  id: 'anthropic' | 'openai' | 'google' | 'kimi' | 'default'
  prompt: string
}

/** Pick the full base prompt for a model family. */
export function modelPrompt(model?: ModelRef | null): ModelPrompt {
  const modelId = model?.modelId.toLowerCase() ?? ''
  const providerId = model?.providerId.toLowerCase() ?? ''
  const matches = (pattern: RegExp): boolean => pattern.test(modelId) || pattern.test(providerId)

  if (matches(/claude|anthropic/)) return { id: 'anthropic', prompt: ANTHROPIC_PROMPT }
  if (matches(/gemini|google/)) return { id: 'google', prompt: GOOGLE_PROMPT }
  if (matches(/kimi|moonshot/)) return { id: 'kimi', prompt: KIMI_PROMPT }
  if (matches(/gpt|codex|(?:^|[^a-z])o[1-4](?:[^a-z]|$)|openai/)) {
    return { id: 'openai', prompt: OPENAI_PROMPT }
  }
  return { id: 'default', prompt: DEFAULT_PROMPT }
}
