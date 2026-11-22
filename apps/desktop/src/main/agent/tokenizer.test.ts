import { describe, expect, it } from 'vitest'
import { tokenCounterFor } from './tokenizer'

describe('tokenCounterFor', () => {
  it('uses OpenAI encodings for OpenAI models', () => {
    const o200k = tokenCounterFor('openai', 'gpt-4o')
    expect(o200k?.('hello world')).toBe(2)
    const cl100k = tokenCounterFor('openai', 'gpt-4')
    expect(cl100k?.('hello world')).toBe(2)
    expect(tokenCounterFor('openai-compatible', 'o3-mini')?.('hello world')).toBe(2)
  })

  it('uses the Claude tokenizer for Anthropic models', () => {
    const counter = tokenCounterFor('anthropic', 'claude-sonnet-4')
    expect(counter?.('hello world')).toBe(2)
  })

  it('falls back for unknown providers and models', () => {
    expect(tokenCounterFor('google', 'gemini-2.5-pro')).toBeUndefined()
    expect(tokenCounterFor('openai', 'local-model')).toBeUndefined()
    expect(tokenCounterFor(undefined, undefined)).toBeUndefined()
  })
})
