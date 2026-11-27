import { describe, expect, it } from 'vitest'
import { CacheMetricsCollector } from './cache-metrics'
import { usageFrom } from './messages'

describe('CacheMetricsCollector', () => {
  it('aggregates cached input tokens across requests', () => {
    const metrics = new CacheMetricsCollector()
    metrics.record(
      usageFrom({
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 20 }
      }),
      0.0012
    )
    metrics.record(
      usageFrom({
        inputTokens: 50,
        outputTokens: 5,
        totalTokens: 55,
        inputTokenDetails: { cacheReadTokens: 10, cacheWriteTokens: 0 }
      }),
      0.0003
    )

    expect(metrics.snapshot()).toEqual({
      requests: 2,
      inputTokens: 150,
      cacheReadTokens: 70,
      cacheWriteTokens: 20,
      hitRate: 70 / 150,
      savedTokens: 70,
      savedUsd: 0.0015
    })
  })

  it('reports no hit rate without input tokens', () => {
    const metrics = new CacheMetricsCollector()
    metrics.record({ outputTokens: 3 })

    expect(metrics.snapshot()).toMatchObject({
      requests: 1,
      inputTokens: 0,
      hitRate: null,
      savedTokens: 0,
      savedUsd: 0
    })
  })

  it('ignores negative or non-finite savings', () => {
    const metrics = new CacheMetricsCollector()
    metrics.record({ inputTokens: 10 }, -1)
    metrics.record({ inputTokens: 10 }, Number.NaN)

    expect(metrics.snapshot().savedUsd).toBe(0)
  })
})
