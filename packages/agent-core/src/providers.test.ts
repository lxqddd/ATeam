import { describe, expect, it } from 'vitest'
import { normalizeAnthropicBaseURL, providerHeaders } from './providers'

describe('providerHeaders', () => {
  it('adds the OpenCode session header for opencode.ai endpoints', () => {
    expect(providerHeaders('https://opencode.ai/inference/go/anthropic', 'session-1')).toEqual({
      'x-opencode-session': 'session-1'
    })
    expect(providerHeaders('https://api.opencode.ai/v1', 'session-2')).toEqual({
      'x-opencode-session': 'session-2'
    })
  })

  it('generates a session id when none is provided', () => {
    const headers = providerHeaders('https://opencode.ai/inference/go/anthropic')

    expect(headers?.['x-opencode-session']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('ignores other providers and invalid URLs', () => {
    expect(providerHeaders('https://api.anthropic.com')).toBeUndefined()
    expect(providerHeaders('https://example.com/opencode.ai')).toBeUndefined()
    expect(providerHeaders('not a url')).toBeUndefined()
    expect(providerHeaders(undefined)).toBeUndefined()
  })
})

describe('normalizeAnthropicBaseURL', () => {
  it('appends the version segment expected by the Anthropic SDK', () => {
    expect(normalizeAnthropicBaseURL('https://opencode.ai/inference/go/anthropic')).toBe(
      'https://opencode.ai/inference/go/anthropic/v1'
    )
    expect(normalizeAnthropicBaseURL('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1'
    )
    expect(normalizeAnthropicBaseURL('https://proxy.example.com/anthropic/')).toBe(
      'https://proxy.example.com/anthropic/v1'
    )
  })

  it('keeps base URLs that already include a version segment', () => {
    expect(normalizeAnthropicBaseURL('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1'
    )
    expect(normalizeAnthropicBaseURL('https://proxy.example.com/v2')).toBe(
      'https://proxy.example.com/v2'
    )
  })

  it('passes through missing values', () => {
    expect(normalizeAnthropicBaseURL(undefined)).toBeUndefined()
  })
})
