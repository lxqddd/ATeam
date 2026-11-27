import { describe, expect, it } from 'vitest'
import type { ModelPublic, TokenUsage } from '@ateam/shared'
import { computeCacheSavings, computeMessageCost } from './cost'

function model(overrides: Partial<ModelPublic> = {}): ModelPublic {
  return {
    id: 'm1',
    providerId: 'p1',
    modelId: 'claude',
    name: 'Claude',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('computeMessageCost', () => {
  it('prices uncached input, cache read, cache write and output separately', () => {
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      cacheReadTokens: 400_000,
      cacheWriteTokens: 100_000,
      outputTokens: 500_000
    }
    expect(
      computeMessageCost(
        usage,
        model({ costInput: 3, costOutput: 15, costCacheRead: 0.3, costCacheWrite: 3.75 })
      )
    ).toBe(9.495)
  })

  it('falls back to the input price when cache prices are missing', () => {
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      cacheReadTokens: 400_000,
      cacheWriteTokens: 100_000,
      outputTokens: 500_000
    }
    expect(computeMessageCost(usage, model({ costInput: 3, costOutput: 15 }))).toBe(10.5)
    expect(computeMessageCost({ inputTokens: 1_000_000 }, model({ costInput: 3 }))).toBe(3)
  })

  it('prices a partially configured model', () => {
    expect(
      computeMessageCost(
        { inputTokens: 1_000_000, outputTokens: 500_000 },
        model({ costOutput: 15 })
      )
    ).toBe(7.5)
    expect(
      computeMessageCost(
        { inputTokens: 1_000, cacheReadTokens: 1_000 },
        model({ costCacheRead: 0.3 })
      )
    ).toBe(0.0003)
  })

  it('clamps cached tokens that exceed the reported input total', () => {
    const usage: TokenUsage = {
      inputTokens: 1_000,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 1_000
    }
    expect(
      computeMessageCost(usage, model({ costInput: 3, costCacheRead: 0.3, costCacheWrite: 3.75 }))
    ).toBe(0.00435)
  })

  it('rounds to six decimals', () => {
    expect(
      computeMessageCost(
        { inputTokens: 3, outputTokens: 4 },
        model({ costInput: 3, costOutput: 15 })
      )
    ).toBe(0.000069)
  })

  it('returns null without any pricing metadata', () => {
    expect(computeMessageCost({ inputTokens: 10, cacheReadTokens: 5 }, model())).toBeNull()
  })

  it('treats missing token counts as zero', () => {
    expect(computeMessageCost({}, model({ costInput: 3, costOutput: 15 }))).toBe(0)
  })
})

describe('computeCacheSavings', () => {
  it('estimates the cache-read discount', () => {
    expect(
      computeCacheSavings(
        { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 },
        model({ costInput: 3, costCacheRead: 0.3 })
      )
    ).toBe(2.7)
    expect(
      computeCacheSavings(
        { inputTokens: 1_000, cacheReadTokens: 1_000 },
        model({ costInput: 3, costCacheRead: 0.3 })
      )
    ).toBe(0.0027)
  })

  it('returns zero without both prices', () => {
    expect(computeCacheSavings({ cacheReadTokens: 1_000 }, model({ costInput: 3 }))).toBe(0)
    expect(computeCacheSavings({ cacheReadTokens: 1_000 }, model({ costCacheRead: 0.3 }))).toBe(0)
  })

  it('returns zero without cache reads or when the cache price is higher', () => {
    expect(
      computeCacheSavings({ cacheReadTokens: 0 }, model({ costInput: 3, costCacheRead: 0.3 }))
    ).toBe(0)
    expect(
      computeCacheSavings({ cacheReadTokens: 1_000 }, model({ costInput: 3, costCacheRead: 4 }))
    ).toBe(0)
  })

  it('treats missing token counts as zero', () => {
    expect(computeCacheSavings({}, model({ costInput: 3, costCacheRead: 0.3 }))).toBe(0)
  })
})
