import { describe, expect, it } from 'vitest'
import { githubErrorCode, githubErrorKey, githubErrorMessage } from './github-errors'

describe('githubErrorCode', () => {
  it('extracts the stable code and returns null for other failures', () => {
    expect(githubErrorCode(new Error('GITHUB_UNPROCESSABLE: invalid'))).toBe('GITHUB_UNPROCESSABLE')
    expect(githubErrorCode(new Error('plain failure'))).toBeNull()
  })
})

describe('githubErrorKey', () => {
  it('maps stable GITHUB_* codes embedded in the message', () => {
    expect(githubErrorKey(new Error('GITHUB_TOKEN_MISSING: set a token'))).toBe(
      'chat.githubErrorTokenMissing'
    )
    expect(githubErrorKey(new Error('GITHUB_RATE_LIMITED: slow down'))).toBe(
      'chat.githubErrorRateLimited'
    )
    expect(githubErrorKey(new Error('GITHUB_UNPROCESSABLE: nope'))).toBe(
      'chat.githubErrorUnprocessable'
    )
  })

  it('unwraps Electron IPC error prefixes', () => {
    expect(
      githubErrorKey(
        new Error(
          "Error invoking remote method 'agent:github:context': Error: GITHUB_NOT_FOUND: gone"
        )
      )
    ).toBe('chat.githubErrorNotFound')
  })

  it('returns null for other failures and unknown codes', () => {
    expect(githubErrorKey(new Error('plain failure'))).toBeNull()
    expect(githubErrorKey('not an error')).toBeNull()
    expect(githubErrorKey(new Error('GITHUB_SOMETHING_NEW: x'))).toBeNull()
  })
})

describe('githubErrorMessage', () => {
  it('translates known codes and falls back to the raw message', () => {
    const translate = (key: string): string => `t:${key}`

    expect(githubErrorMessage(new Error('GITHUB_FORBIDDEN: denied'), translate)).toBe(
      't:chat.githubErrorForbidden'
    )
    expect(githubErrorMessage(new Error('boom'), translate)).toBe('boom')
  })
})
