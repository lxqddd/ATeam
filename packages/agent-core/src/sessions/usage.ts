import type {
  UsageStats,
  UsageStatsModelRow,
  UsageStatsRange,
  UsageStatsToolRow
} from '@ateam/shared'
import type { SessionRecord } from './sessions-store'

const DAY_MS = 24 * 60 * 60 * 1_000

const RANGE_DAYS: Record<Exclude<UsageStatsRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30
}

export interface ComputeUsageStatsOptions {
  range: UsageStatsRange
  /** Clock override for tests; defaults to the current time. */
  now?: Date
}

/**
 * Aggregates stored session records into local usage statistics.
 *
 * Sessions are counted when a visible session was updated inside the range;
 * messages, tokens, costs and tool calls are counted by message creation time
 * across every record, including hidden subagent sessions, so totals match what
 * was actually spent. Missing usage or cost data is counted separately rather
 * than summed as zero.
 */
export function computeUsageStats(
  records: readonly SessionRecord[],
  options: ComputeUsageStatsOptions
): UsageStats {
  const cutoff =
    options.range === 'all'
      ? null
      : (options.now ?? new Date()).getTime() - RANGE_DAYS[options.range] * DAY_MS

  const stats: UsageStats = {
    range: options.range,
    sessionCount: 0,
    messageCount: 0,
    assistantMessageCount: 0,
    toolCallCount: 0,
    tokens: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0
    },
    costUsd: 0,
    assistantMessagesWithoutUsage: 0,
    assistantMessagesWithoutCost: 0,
    tools: [],
    models: []
  }
  const tools = new Map<string, UsageStatsToolRow>()
  const models = new Map<string, UsageStatsModelRow>()

  for (const record of records) {
    if (!record.session.hidden && withinRange(record.session.updatedAt, cutoff)) {
      stats.sessionCount += 1
    }

    for (const message of record.messages) {
      if (!withinRange(message.createdAt, cutoff)) continue
      stats.messageCount += 1

      for (const part of message.parts) {
        if (part.type !== 'tool') continue
        stats.toolCallCount += 1
        const row = tools.get(part.toolName) ?? { toolName: part.toolName, calls: 0, failed: 0 }
        row.calls += 1
        if (part.state === 'failed') row.failed += 1
        tools.set(part.toolName, row)
      }

      if (message.role !== 'assistant') continue
      stats.assistantMessageCount += 1

      if (message.usage) {
        stats.tokens.inputTokens += message.usage.inputTokens ?? 0
        stats.tokens.outputTokens += message.usage.outputTokens ?? 0
        stats.tokens.cacheReadTokens += message.usage.cacheReadTokens ?? 0
        stats.tokens.cacheWriteTokens += message.usage.cacheWriteTokens ?? 0
        stats.tokens.totalTokens +=
          message.usage.totalTokens ??
          (message.usage.inputTokens ?? 0) + (message.usage.outputTokens ?? 0)
      } else {
        stats.assistantMessagesWithoutUsage += 1
      }

      const cost = message.costUsd
      if (typeof cost === 'number' && Number.isFinite(cost)) stats.costUsd += cost
      else stats.assistantMessagesWithoutCost += 1

      if (!message.model) continue
      const key = `${message.model.providerId}\u0000${message.model.modelId}`
      const row = models.get(key) ?? {
        providerId: message.model.providerId,
        modelId: message.model.modelId,
        messages: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0
      }
      row.messages += 1
      row.inputTokens += message.usage?.inputTokens ?? 0
      row.outputTokens += message.usage?.outputTokens ?? 0
      if (typeof cost === 'number' && Number.isFinite(cost)) row.costUsd += cost
      models.set(key, row)
    }
  }

  stats.costUsd = roundCost(stats.costUsd)
  stats.tools = [...tools.values()].sort(
    (a, b) => b.calls - a.calls || a.toolName.localeCompare(b.toolName)
  )
  stats.models = [...models.values()]
    .map((row) => ({ ...row, costUsd: roundCost(row.costUsd) }))
    .sort(
      (a, b) =>
        b.messages - a.messages ||
        `${a.providerId}/${a.modelId}`.localeCompare(`${b.providerId}/${b.modelId}`)
    )
  return stats
}

function withinRange(timestamp: string, cutoff: number | null): boolean {
  if (cutoff === null) return true
  const time = Date.parse(timestamp)
  return Number.isFinite(time) && time >= cutoff
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
