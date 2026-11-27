import type { CacheMetricsSnapshot, TokenUsage } from '@ateam/shared'

/** In-memory prompt-cache counters for one agent process. */
export class CacheMetricsCollector {
  private requests = 0
  private inputTokens = 0
  private cacheReadTokens = 0
  private cacheWriteTokens = 0
  private savedUsd = 0

  record(usage: TokenUsage, savedUsd = 0): void {
    this.requests += 1
    this.inputTokens += Math.max(0, usage.inputTokens ?? 0)
    this.cacheReadTokens += Math.max(0, usage.cacheReadTokens ?? 0)
    this.cacheWriteTokens += Math.max(0, usage.cacheWriteTokens ?? 0)
    if (Number.isFinite(savedUsd)) this.savedUsd += Math.max(0, savedUsd)
  }

  snapshot(): CacheMetricsSnapshot {
    return {
      requests: this.requests,
      inputTokens: this.inputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      hitRate: this.inputTokens > 0 ? this.cacheReadTokens / this.inputTokens : null,
      savedTokens: this.cacheReadTokens,
      savedUsd: Number(this.savedUsd.toFixed(6))
    }
  }
}
