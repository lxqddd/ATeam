import { describe, expect, it } from 'vitest'
import type { ChatMessage, SessionMeta } from '@ateam/shared'
import { makeMessage, makeSession, makeTextPart, makeToolPart } from '../test/factories'
import { computeUsageStats } from './usage'
import type { SessionRecord } from './storage'

const NOW = new Date('2026-11-27T12:00:00.000Z')
const YESTERDAY = '2026-11-26T12:00:00.000Z'
const TEN_DAYS_AGO = '2026-11-17T12:00:00.000Z'
const FORTY_DAYS_AGO = '2026-10-18T12:00:00.000Z'

function record(session: Partial<SessionMeta>, messages: ChatMessage[]): SessionRecord {
  return { session: makeSession(session), messages }
}

function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return makeMessage({ role: 'assistant', createdAt: YESTERDAY, ...overrides })
}

describe('computeUsageStats', () => {
  it('aggregates totals and distributions from stored records', () => {
    const records = [
      record({ id: 's1', updatedAt: YESTERDAY }, [
        makeMessage({ id: 'm1', role: 'user', createdAt: YESTERDAY, parts: [makeTextPart('hi')] }),
        assistant({
          id: 'm2',
          model: { providerId: 'anthropic', modelId: 'claude-opus-5', variant: null },
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            totalTokens: 120,
            cacheReadTokens: 30,
            cacheWriteTokens: 10
          },
          costUsd: 0.012345,
          parts: [
            makeToolPart({ toolName: 'read', state: 'completed' }),
            makeToolPart({ toolName: 'read', state: 'failed' }),
            makeToolPart({ toolName: 'grep', state: 'completed' }),
            makeToolPart({ toolName: 'bash', state: 'completed' })
          ]
        })
      ]),
      record({ id: 's2', updatedAt: YESTERDAY }, [
        assistant({
          id: 'm3',
          model: { providerId: 'openai', modelId: 'gpt-5', variant: null }
        })
      ])
    ]

    const stats = computeUsageStats(records, { range: 'all', now: NOW })

    expect(stats.sessionCount).toBe(2)
    expect(stats.messageCount).toBe(3)
    expect(stats.assistantMessageCount).toBe(2)
    expect(stats.toolCallCount).toBe(4)
    expect(stats.tokens).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      totalTokens: 120
    })
    expect(stats.costUsd).toBe(0.012345)
    expect(stats.assistantMessagesWithoutUsage).toBe(1)
    expect(stats.assistantMessagesWithoutCost).toBe(1)
    expect(stats.tools).toEqual([
      { toolName: 'read', calls: 2, failed: 1 },
      { toolName: 'bash', calls: 1, failed: 0 },
      { toolName: 'grep', calls: 1, failed: 0 }
    ])
    expect(stats.models).toEqual([
      {
        providerId: 'anthropic',
        modelId: 'claude-opus-5',
        messages: 1,
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.012345
      },
      {
        providerId: 'openai',
        modelId: 'gpt-5',
        messages: 1,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0
      }
    ])
  })

  it('filters messages by creation time and sessions by update time', () => {
    const records = [
      record({ id: 'recent', updatedAt: YESTERDAY }, [
        assistant({
          createdAt: YESTERDAY,
          usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
          costUsd: 0.1
        }),
        assistant({
          createdAt: TEN_DAYS_AGO,
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
          costUsd: 1
        })
      ]),
      record({ id: 'older', updatedAt: FORTY_DAYS_AGO }, [
        assistant({
          createdAt: FORTY_DAYS_AGO,
          usage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 },
          costUsd: 10
        })
      ])
    ]

    const week = computeUsageStats(records, { range: '7d', now: NOW })
    expect(week.sessionCount).toBe(1)
    expect(week.messageCount).toBe(1)
    expect(week.tokens.totalTokens).toBe(11)
    expect(week.costUsd).toBe(0.1)

    const month = computeUsageStats(records, { range: '30d', now: NOW })
    expect(month.sessionCount).toBe(1)
    expect(month.messageCount).toBe(2)
    expect(month.tokens.totalTokens).toBe(121)
    expect(month.costUsd).toBe(1.1)

    const all = computeUsageStats(records, { range: 'all', now: NOW })
    expect(all.sessionCount).toBe(2)
    expect(all.messageCount).toBe(3)
    expect(all.tokens.totalTokens).toBe(1221)
    expect(all.costUsd).toBe(11.1)
  })

  it('counts subagent sessions in usage but not in the chat count', () => {
    const records = [
      record({ id: 'parent', updatedAt: YESTERDAY }, []),
      record({ id: 'child', hidden: true, parentId: 'parent', updatedAt: YESTERDAY }, [
        assistant({ usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 } })
      ])
    ]

    const stats = computeUsageStats(records, { range: 'all', now: NOW })

    expect(stats.sessionCount).toBe(1)
    expect(stats.messageCount).toBe(1)
    expect(stats.tokens.totalTokens).toBe(10)
  })

  it('returns zeroed aggregates for empty data', () => {
    const stats = computeUsageStats([], { range: '30d', now: NOW })

    expect(stats).toMatchObject({
      range: '30d',
      sessionCount: 0,
      messageCount: 0,
      assistantMessageCount: 0,
      toolCallCount: 0,
      costUsd: 0,
      assistantMessagesWithoutUsage: 0,
      assistantMessagesWithoutCost: 0,
      tools: [],
      models: []
    })
    expect(stats.tokens.totalTokens).toBe(0)
  })

  it('excludes invalid timestamps from ranged views but keeps them in all time', () => {
    const records = [
      record({ id: 'broken', updatedAt: 'not-a-date' }, [
        assistant({ createdAt: 'also-broken', usage: { totalTokens: 4 } })
      ])
    ]

    const all = computeUsageStats(records, { range: 'all', now: NOW })
    expect(all.sessionCount).toBe(1)
    expect(all.messageCount).toBe(1)

    const week = computeUsageStats(records, { range: '7d', now: NOW })
    expect(week.sessionCount).toBe(0)
    expect(week.messageCount).toBe(0)
  })

  it('falls back to input plus output when totalTokens is missing', () => {
    const records = [
      record({ id: 's1', updatedAt: YESTERDAY }, [
        assistant({ usage: { inputTokens: 7, outputTokens: 3 } })
      ])
    ]

    const stats = computeUsageStats(records, { range: 'all', now: NOW })
    expect(stats.tokens.totalTokens).toBe(10)
  })

  it('sums floating point costs without drift', () => {
    const records = [
      record({ id: 's1', updatedAt: YESTERDAY }, [
        assistant({ costUsd: 0.1 }),
        assistant({ costUsd: 0.2 })
      ])
    ]

    const stats = computeUsageStats(records, { range: 'all', now: NOW })
    expect(stats.costUsd).toBe(0.3)
  })
})
