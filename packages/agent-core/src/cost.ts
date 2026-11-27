import type { ModelPublic, TokenUsage } from '@ateam/shared'

type ModelPricing = Pick<
  ModelPublic,
  'costInput' | 'costOutput' | 'costCacheRead' | 'costCacheWrite'
>

/**
 * Estimate the USD cost of one message from per-million-token pricing.
 * `inputTokens` includes cached tokens, so the three input segments are priced
 * separately. Missing cache prices fall back to the input price, which keeps
 * the previous total for models without cache pricing.
 */
export function computeMessageCost(usage: TokenUsage, model: ModelPricing): number | null {
  if (
    model.costInput === undefined &&
    model.costOutput === undefined &&
    model.costCacheRead === undefined &&
    model.costCacheWrite === undefined
  ) {
    return null
  }
  const input = usage.inputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  const uncached = Math.max(0, input - cacheRead - cacheWrite)
  const output = usage.outputTokens ?? 0
  const cost =
    (uncached / 1_000_000) * (model.costInput ?? 0) +
    (cacheRead / 1_000_000) * (model.costCacheRead ?? model.costInput ?? 0) +
    (cacheWrite / 1_000_000) * (model.costCacheWrite ?? model.costInput ?? 0) +
    (output / 1_000_000) * (model.costOutput ?? 0)
  return Number(cost.toFixed(6))
}

/**
 * Estimate USD saved by cache reads versus paying the full input price.
 * Cache writes cost extra, so they are not counted as savings.
 */
export function computeCacheSavings(usage: TokenUsage, model: ModelPricing): number {
  const inputPrice = model.costInput
  const cachePrice = model.costCacheRead
  if (inputPrice === undefined || cachePrice === undefined) return 0
  const cacheRead = usage.cacheReadTokens ?? 0
  if (cacheRead <= 0) return 0
  const saved = (cacheRead / 1_000_000) * Math.max(0, inputPrice - cachePrice)
  return Number(saved.toFixed(6))
}
