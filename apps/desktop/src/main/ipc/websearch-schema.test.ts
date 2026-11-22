import { describe, expect, it } from 'vitest'
import { webSearchUpdateSchema } from './websearch-schema'

describe('webSearchUpdateSchema', () => {
  it('accepts every supported provider', () => {
    for (const provider of ['tavily', 'exa', 'brave', 'serper']) {
      expect(webSearchUpdateSchema.parse({ provider, apiKey: 'key' })).toEqual({
        provider,
        apiKey: 'key'
      })
    }
  })

  it('rejects unknown providers', () => {
    expect(() => webSearchUpdateSchema.parse({ provider: 'unknown' })).toThrow()
  })
})
