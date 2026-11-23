import { describe, expect, it } from 'vitest'
import { tokenCounterFor } from './tokenizer'

describe('tokenCounterFor', () => {
  it('uses OpenAI encodings for OpenAI models', async () => {
    const o200k = await tokenCounterFor('openai', 'gpt-4o')
    expect(o200k?.('hello world')).toBe(2)
    const cl100k = await tokenCounterFor('openai', 'gpt-4')
    expect(cl100k?.('hello world')).toBe(2)
    expect((await tokenCounterFor('openai-compatible', 'o3-mini'))?.('hello world')).toBe(2)
  })

  it('uses the Claude 2 tokenizer only for Claude 2 models', async () => {
    const counter = await tokenCounterFor('anthropic', 'claude-2.1')
    expect(counter?.('hello world')).toBe(2)
    await expect(tokenCounterFor('anthropic', 'claude-sonnet-4')).resolves.toBeUndefined()
  })

  it('falls back for unknown providers and models', async () => {
    await expect(tokenCounterFor('google', 'gemini-2.5-pro')).resolves.toBeUndefined()
    await expect(tokenCounterFor('openai', 'local-model')).resolves.toBeUndefined()
    await expect(tokenCounterFor(undefined, undefined)).resolves.toBeUndefined()
  })
})
