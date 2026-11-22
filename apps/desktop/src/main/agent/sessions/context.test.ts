import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@ateam/shared'
import {
  compactionKeepTokens,
  contextTokenLimit,
  estimateContextTokens,
  estimateMessagesTokens,
  estimateTextTokens,
  messagesAfterCompaction,
  planCompaction,
  shouldCompact,
  summaryPrompt,
  systemWithSummary
} from './context'
import { makeMessage, makeTextPart, makeToolPart } from '../test/factories'

function user(id: string, text: string): ChatMessage {
  return makeMessage({ id, role: 'user', parts: [makeTextPart(text)] })
}

function assistant(id: string, text: string): ChatMessage {
  return makeMessage({ id, role: 'assistant', parts: [makeTextPart(text)] })
}

describe('estimateTextTokens', () => {
  it('returns zero for empty text and grows with content', () => {
    expect(estimateTextTokens('')).toBe(0)
    expect(estimateTextTokens('abcd')).toBe(1)
    expect(estimateTextTokens('abcde')).toBe(2)
    expect(estimateTextTokens('x'.repeat(4_000))).toBe(1_000)
  })

  it('counts non-ASCII characters more heavily', () => {
    expect(estimateTextTokens('你好世界')).toBe(4)
    expect(estimateTextTokens('hello 世界')).toBe(4)
  })
})

describe('estimateMessagesTokens', () => {
  it('counts text, reasoning and tool payloads', () => {
    const plain = user('u1', 'x'.repeat(400))
    const withTool = makeMessage({
      id: 'a1',
      role: 'assistant',
      parts: [
        makeTextPart('x'.repeat(400)),
        makeToolPart({ input: { path: 'a'.repeat(400) }, output: 'y'.repeat(400) })
      ]
    })

    expect(estimateMessagesTokens([plain])).toBeGreaterThan(90)
    expect(estimateMessagesTokens([withTool])).toBeGreaterThan(estimateMessagesTokens([plain]))
  })
})

describe('contextTokenLimit', () => {
  it('keeps a proportional buffer with a minimum reserve', () => {
    expect(contextTokenLimit(128_000)).toBe(108_800)
    expect(contextTokenLimit(200_000)).toBe(170_000)
    expect(contextTokenLimit(32_000)).toBe(16_000)
    expect(contextTokenLimit(10_000)).toBe(1)
  })
})

describe('compactionKeepTokens', () => {
  it('keeps a larger recent window but scales down for small models', () => {
    expect(compactionKeepTokens(128_000)).toBe(15_000)
    expect(compactionKeepTokens(20_000)).toBe(2_000)
    expect(compactionKeepTokens(10_000)).toBe(500)
  })
})

describe('estimateMessagesTokens media', () => {
  it('counts image attachments and tool images', () => {
    const attachment = makeMessage({
      role: 'user',
      parts: [
        {
          type: 'attachment',
          attachment: {
            id: 'a1',
            name: 'pixel.png',
            mimeType: 'image/png',
            size: 100,
            kind: 'image',
            path: '/tmp/pixel.png'
          }
        }
      ]
    })
    const toolImage = makeMessage({
      parts: [
        makeToolPart({
          state: 'completed',
          images: [{ mimeType: 'image/png', data: 'AQID' }]
        })
      ]
    })

    expect(estimateMessagesTokens([attachment])).toBeGreaterThanOrEqual(1_500)
    expect(estimateMessagesTokens([toolImage])).toBeGreaterThanOrEqual(1_500)
  })
})

describe('estimateContextTokens', () => {
  const reported = makeMessage({
    id: 'a1',
    role: 'assistant',
    parts: [makeTextPart('done')],
    usage: { inputTokens: 5_000, outputTokens: 200 }
  })

  it('uses provider usage as the anchor', () => {
    expect(estimateContextTokens([user('u1', 'x'.repeat(4_000)), reported])).toBe(5_200)
  })

  it('adds estimated tokens for messages after the usage anchor', () => {
    const followUp = user('u2', 'y'.repeat(40))

    expect(estimateContextTokens([user('u1', 'x'.repeat(4_000)), reported, followUp])).toBe(
      5_200 + estimateMessagesTokens([followUp])
    )
  })

  it('prefers last-step context usage over cumulative totals', () => {
    const message = makeMessage({
      id: 'a1',
      role: 'assistant',
      parts: [makeTextPart('done')],
      usage: { inputTokens: 60, outputTokens: 15 },
      contextUsage: { inputTokens: 20, outputTokens: 5 }
    })

    expect(estimateContextTokens([message])).toBe(25)
  })

  it('ignores usage from messages created before a compaction boundary', () => {
    const message = makeMessage({
      id: 'a1',
      role: 'assistant',
      parts: [makeTextPart('done')],
      usage: { inputTokens: 70_000, outputTokens: 0 },
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    const messages = [user('u1', 'short'), message]

    expect(estimateContextTokens(messages, { usageCreatedAfter: '2026-02-01T00:00:00.000Z' })).toBe(
      estimateMessagesTokens(messages)
    )
  })

  it('ignores usage from incomplete assistant messages', () => {
    const message = makeMessage({
      id: 'a1',
      role: 'assistant',
      status: 'interrupted',
      parts: [makeTextPart('partial')],
      usage: { inputTokens: 70_000, outputTokens: 0 }
    })

    expect(estimateContextTokens([user('u1', 'short'), message])).toBe(
      estimateMessagesTokens([user('u1', 'short'), message])
    )
  })

  it('falls back to the heuristic without reported usage', () => {
    const messages = [user('u1', 'x'.repeat(4_000)), assistant('a1', 'done')]

    expect(estimateContextTokens(messages)).toBe(estimateMessagesTokens(messages))
  })
})

describe('shouldCompact', () => {
  it('compacts once the history exceeds the model limit', () => {
    const messages = [user('u1', 'x'.repeat(200_000))]

    expect(shouldCompact(messages, 64_000)).toBe(true)
    expect(shouldCompact(messages, 128_000)).toBe(false)
  })
})

describe('planCompaction', () => {
  it('keeps recent complete turns and marks the last removed message', () => {
    const messages = [
      user('u1', 'a'.repeat(40_000)),
      assistant('a1', 'b'.repeat(40_000)),
      user('u2', 'c'.repeat(4_000)),
      assistant('a2', 'd'.repeat(4_000))
    ]

    const plan = planCompaction(messages, 128_000, 2_000)

    expect(plan).not.toBeNull()
    expect(plan?.keep[0].role).toBe('user')
    expect(plan?.keep.map((message) => message.id)).toEqual(['u2', 'a2'])
    expect(plan?.older.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(plan?.throughMessageId).toBe('a1')
    expect(plan?.tokensBefore).toBeGreaterThan(plan?.keepTokens ?? 0)
  })

  it('does not cut between an assistant reply and its following user turn', () => {
    const messages = [
      user('u1', 'a'.repeat(4_000)),
      assistant('a1', 'b'.repeat(40_000)),
      user('u2', 'c'.repeat(4_000)),
      assistant('a2', 'd'.repeat(400))
    ]

    const plan = planCompaction(messages, 128_000, 2_000)

    expect(plan?.keep.map((message) => message.id)).toEqual(['u2', 'a2'])
  })

  it('returns null when there is nothing old enough to remove', () => {
    const messages = [user('u1', 'short'), assistant('a1', 'short')]

    expect(planCompaction(messages, 128_000, 15_000)).toBeNull()
  })

  it('returns null when no user boundary can be kept', () => {
    const messages = [assistant('a1', 'x'.repeat(40_000)), assistant('a2', 'y'.repeat(40_000))]

    expect(planCompaction(messages, 128_000, 2_000)).toBeNull()
  })
})

describe('messagesAfterCompaction', () => {
  const messages = [user('u1', 'one'), assistant('a1', 'two'), user('u2', 'three')]

  it('returns the full history without a compaction boundary', () => {
    expect(messagesAfterCompaction(messages, null)).toEqual(messages)
  })

  it('returns only messages after the stored boundary', () => {
    expect(
      messagesAfterCompaction(messages, {
        summary: 'summary',
        throughMessageId: 'a1',
        createdAt: '2026-01-01T00:00:00.000Z',
        tokensBefore: 100,
        tokensAfter: 20
      }).map((message) => message.id)
    ).toEqual(['u2'])
  })

  it('falls back to the full history when the boundary is missing', () => {
    expect(
      messagesAfterCompaction(messages, {
        summary: 'summary',
        throughMessageId: 'missing',
        createdAt: '2026-01-01T00:00:00.000Z',
        tokensBefore: 100,
        tokensAfter: 20
      })
    ).toEqual(messages)
  })
})

describe('summaryPrompt', () => {
  it('includes the previous summary, conversation text and important tool results', () => {
    const older = [
      user('u1', 'Please fix the parser'),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        parts: [
          makeTextPart('I found the bug'),
          makeToolPart({ toolName: 'shell', input: { command: 'bun test' }, output: '3 passing' })
        ]
      })
    ]

    const prompt = summaryPrompt(older, 'Earlier context')

    expect(prompt).toContain('Earlier context')
    expect(prompt).toContain('Please fix the parser')
    expect(prompt).toContain('I found the bug')
    expect(prompt).toContain('bun test')
    expect(prompt).toContain('3 passing')
    expect(prompt).toMatch(/summary/i)
  })
})

describe('systemWithSummary', () => {
  it('appends the compaction summary to the system prompt', () => {
    expect(systemWithSummary('Base prompt', 'Earlier work')).toBe(
      'Base prompt\n\nEarlier conversation summary:\nEarlier work'
    )
  })

  it('leaves the system prompt unchanged without a summary', () => {
    expect(systemWithSummary('Base prompt', null)).toBe('Base prompt')
    expect(systemWithSummary('Base prompt', '   ')).toBe('Base prompt')
  })
})
