import type { RetryMetricsSnapshot } from '@ateam/shared'

/** In-memory retry counters for one agent process. */
export class RetryMetricsCollector {
  private retries = 0
  private successes = 0
  private failures = 0
  private totalDelayMs = 0
  private lastReason: string | null = null
  private lastRetriedAt: string | null = null

  recordRetry(info: { delayMs: number; reason: string }, at = new Date()): void {
    this.retries += 1
    this.totalDelayMs += Math.max(0, info.delayMs)
    this.lastReason = info.reason
    this.lastRetriedAt = at.toISOString()
  }

  /** Record the outcome of a run that had at least one retry. */
  recordOutcome(success: boolean): void {
    if (success) this.successes += 1
    else this.failures += 1
  }

  snapshot(): RetryMetricsSnapshot {
    const finished = this.successes + this.failures
    return {
      retries: this.retries,
      successes: this.successes,
      failures: this.failures,
      successRate: finished > 0 ? this.successes / finished : null,
      totalDelayMs: this.totalDelayMs,
      averageDelayMs: this.retries > 0 ? Math.round(this.totalDelayMs / this.retries) : 0,
      lastReason: this.lastReason,
      lastRetriedAt: this.lastRetriedAt
    }
  }
}
