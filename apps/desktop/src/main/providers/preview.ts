import type { ProviderType, RuntimeProvider } from '@ateam/shared'

export interface ModelPreviewInput {
  type: ProviderType
  baseURL?: string
  apiKey?: string
}

function normalizeBaseURL(value?: string): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

export function previewApiKey(
  input: ModelPreviewInput,
  stored?: RuntimeProvider
): string | undefined {
  const explicit = input.apiKey?.trim()
  if (explicit) return explicit
  if (!stored) return undefined
  if (stored.type !== input.type) return undefined
  if (normalizeBaseURL(stored.baseURL) !== normalizeBaseURL(input.baseURL)) return undefined
  return stored.apiKey
}
