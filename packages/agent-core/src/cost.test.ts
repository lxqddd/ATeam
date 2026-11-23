import { describe, expect, it } from 'vitest'
import type { ModelPublic, TokenUsage } from '@ateam/shared'
import { computeMessageCost } from './cost'

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
  it('computes USD cost from usage and per-million prices', () => {
    const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 500_000 }
    expect(computeMessageCost(usage, model({ costInput: 3, costOutput: 15 }))).toBe(10.5)
  })

  it('rounds to six decimals', () => {
    expect(
      computeMessageCost(
        { inputTokens: 3, outputTokens: 4 },
        model({ costInput: 3, costOutput: 15 })
      )
    ).toBe(0.000069)
  })

  it('returns null without pricing metadata', () => {
    expect(computeMessageCost({ inputTokens: 10 }, model())).toBeNull()
  })

  it('treats missing token counts as zero', () => {
    expect(computeMessageCost({}, model({ costInput: 3, costOutput: 15 }))).toBe(0)
  })
})
