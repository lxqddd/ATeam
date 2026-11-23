import type { ModelPublic, TokenUsage } from '@ateam/shared'

/** Estimate the USD cost of one message from per-million-token pricing. */
export function computeMessageCost(
  usage: TokenUsage,
  model: Pick<ModelPublic, 'costInput' | 'costOutput'>
): number | null {
  if (model.costInput === undefined && model.costOutput === undefined) return null
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cost =
    (input / 1_000_000) * (model.costInput ?? 0) + (output / 1_000_000) * (model.costOutput ?? 0)
  return Number(cost.toFixed(6))
}
