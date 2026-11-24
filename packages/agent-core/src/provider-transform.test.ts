import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import { transformProviderRequest } from './provider-transform'

const MESSAGES: ModelMessage[] = [
  { role: 'user', content: 'one' },
  { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call-1',
        toolName: 'read',
        output: { type: 'text', value: 'file' }
      }
    ]
  }
]

describe('transformProviderRequest', () => {
  it('adds Anthropic system and last-message cache breakpoints', () => {
    const result = transformProviderRequest({
      provider: { type: 'anthropic' },
      sessionId: 'session-1',
      system: 'system prompt',
      messages: MESSAGES,
      nativeCompaction: false,
      contextWindow: 100_000
    })

    expect(result.system).toBe('system prompt')
    expect(result.systemProviderOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } }
    })
    expect(result.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
        }
      ]
    })
    expect(result.providerOptions).toBeUndefined()
    expect(MESSAGES.at(-1)).not.toMatchObject({
      content: [{ providerOptions: expect.anything() }]
    })
  })

  it('adds Anthropic native compaction settings', () => {
    const result = transformProviderRequest({
      provider: { type: 'anthropic' },
      sessionId: 'session-1',
      system: 'system',
      messages: [],
      nativeCompaction: true,
      contextWindow: 100_000
    })

    expect(result.providerOptions).toEqual({
      anthropic: {
        contextManagement: {
          edits: [
            {
              type: 'compact_20260112',
              trigger: { type: 'input_tokens', value: expect.any(Number) }
            }
          ]
        }
      }
    })
  })

  it('uses a session-scoped prompt cache key for OpenAI', () => {
    const result = transformProviderRequest({
      provider: { type: 'openai' },
      sessionId: 'session-1',
      system: 'system',
      messages: MESSAGES,
      nativeCompaction: false,
      contextWindow: 100_000
    })

    expect(result.providerOptions).toEqual({ openai: { promptCacheKey: 'session-1' } })
    expect(result.systemProviderOptions).toBeUndefined()
    expect(result.messages).toBe(MESSAGES)
  })

  it('leaves other providers unchanged', () => {
    const result = transformProviderRequest({
      provider: { type: 'google' },
      sessionId: 'session-1',
      system: 'system',
      messages: MESSAGES,
      nativeCompaction: false,
      contextWindow: 100_000
    })

    expect(result).toEqual({ system: 'system', messages: MESSAGES })
  })
})
