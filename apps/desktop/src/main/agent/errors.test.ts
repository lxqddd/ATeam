import { describe, expect, it } from 'vitest'
import { normalizeError } from './errors'

describe('normalizeError', () => {
  it('maps AbortError to a stable message', () => {
    const error = new Error('aborted')
    error.name = 'AbortError'
    expect(normalizeError(error)).toBe('Request interrupted')
  })

  it('maps 401 and 403 to authentication failure', () => {
    expect(normalizeError(new Error('401 Unauthorized'))).toBe(
      'Model authentication failed. Check the provider API key.'
    )
    expect(normalizeError(new Error('403 Forbidden'))).toBe(
      'Model authentication failed. Check the provider API key.'
    )
  })

  it('maps 404 to an unknown model message', () => {
    expect(normalizeError(new Error('404 Not Found'))).toBe(
      'The provider does not recognize this model ID.'
    )
  })

  it('maps 429 to a rate limit message', () => {
    expect(normalizeError(new Error('429 Too Many Requests'))).toBe(
      'The provider is rate limiting requests. Try again shortly.'
    )
  })

  it('maps context overflows', () => {
    expect(normalizeError(new Error('maximum context length exceeded'))).toBe(
      'The conversation exceeds the model context window. Start a new chat or shorten the input.'
    )
  })

  it('maps network failures', () => {
    expect(normalizeError(new Error('fetch failed'))).toBe(
      'Network error while contacting the model provider.'
    )
    expect(normalizeError(new Error('getaddrinfo ENOTFOUND api.example.com'))).toBe(
      'Network error while contacting the model provider.'
    )
  })

  it('maps 5xx responses', () => {
    expect(normalizeError(new Error('500 Internal Server Error'))).toBe(
      'The model provider returned a server error.'
    )
  })

  it('maps NO_MODEL and MODEL_NOT_FOUND', () => {
    expect(normalizeError(new Error('NO_MODEL'))).toBe(
      'No model configured. Add a model in Settings → Models.'
    )
    expect(normalizeError(new Error('MODEL_NOT_FOUND'))).toBe(
      'The selected model is no longer configured.'
    )
  })

  it('redacts API keys', () => {
    const message = normalizeError(new Error('provider rejected key sk-abcdefghijklmnopqrstuvwxyz'))
    expect(message).toBe('provider rejected key [redacted]')
    expect(message).not.toContain('abcdefghijklmnopqrstuvwxyz')
  })

  it('redacts oc_sk keys', () => {
    expect(normalizeError(new Error('bad oc_sk-abcdefghijklmnopqrstuvwxyz'))).toBe('bad [redacted]')
  })

  it('redacts Authorization headers and server passwords', () => {
    expect(normalizeError(new Error('Authorization: Bearer abc123'))).toBe(
      'Authorization: [redacted]'
    )
    expect(normalizeError(new Error('server password hunter2'))).toBe('server password [redacted]')
  })

  it('truncates long messages to 1000 characters', () => {
    const message = normalizeError(new Error('x'.repeat(1500)))
    expect(message).toHaveLength(1000)
  })

  it('falls back for non-Error values', () => {
    expect(normalizeError('plain failure')).toBe('plain failure')
    expect(normalizeError('')).toBe('The agent run failed.')
  })
})
