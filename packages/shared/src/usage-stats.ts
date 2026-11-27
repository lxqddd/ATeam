/** Time ranges offered by the local usage statistics page. */
export const USAGE_STATS_RANGES = ['all', '7d', '30d'] as const

export type UsageStatsRange = (typeof USAGE_STATS_RANGES)[number]

/** Token totals aggregated from stored message usage records. */
export interface UsageStatsTokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

/** One row of the tool call distribution. */
export interface UsageStatsToolRow {
  toolName: string
  calls: number
  failed: number
}

/** One row of the model distribution. */
export interface UsageStatsModelRow {
  providerId: string
  modelId: string
  messages: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/**
 * Local usage aggregates computed from persisted session records.
 *
 * Only values that were actually recorded are summed. Assistant messages
 * without a usage record or cost estimate are reported through the
 * `assistantMessagesWithout*` counters instead of being treated as zero.
 */
export interface UsageStats {
  range: UsageStatsRange
  /** Visible sessions updated inside the range. */
  sessionCount: number
  /** Messages created inside the range; includes subagent sessions. */
  messageCount: number
  assistantMessageCount: number
  toolCallCount: number
  tokens: UsageStatsTokens
  costUsd: number
  assistantMessagesWithoutUsage: number
  assistantMessagesWithoutCost: number
  tools: UsageStatsToolRow[]
  models: UsageStatsModelRow[]
}
