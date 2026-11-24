import { describe, expect, it } from 'vitest'
import { modelPrompt } from './index'

describe('modelPrompt', () => {
  it('selects full prompt files by model family', () => {
    expect(modelPrompt({ providerId: 'p', modelId: 'claude-sonnet-5' }).id).toBe('anthropic')
    expect(modelPrompt({ providerId: 'p', modelId: 'gpt-5' }).id).toBe('openai')
    expect(modelPrompt({ providerId: 'p', modelId: 'o3-mini' }).id).toBe('openai')
    expect(modelPrompt({ providerId: 'p', modelId: 'gemini-3-pro' }).id).toBe('google')
    expect(modelPrompt({ providerId: 'p', modelId: 'kimi-k2' }).id).toBe('kimi')
    expect(modelPrompt({ providerId: 'p', modelId: 'some-model' }).id).toBe('default')
    expect(modelPrompt(null).id).toBe('default')
  })

  it('keeps prompts distinct and includes shared operating rules', () => {
    const anthropic = modelPrompt({ providerId: 'p', modelId: 'claude-sonnet-5' })
    const openai = modelPrompt({ providerId: 'p', modelId: 'gpt-5' })
    const google = modelPrompt({ providerId: 'p', modelId: 'gemini-3-pro' })
    const kimi = modelPrompt({ providerId: 'p', modelId: 'kimi-k2' })

    expect(anthropic.prompt).toContain('Claude')
    expect(openai.prompt).toContain('GPT or Codex')
    expect(google.prompt).toContain('Gemini')
    expect(kimi.prompt).toContain('Kimi or Moonshot')
    for (const prompt of [anthropic, openai, google, kimi]) {
      expect(prompt.prompt).toContain('Operating rules:')
      expect(prompt.prompt).toContain('Read a file before editing it')
    }
    expect(new Set([anthropic.prompt, openai.prompt, google.prompt, kimi.prompt]).size).toBe(4)
  })
})
