import { describe, expect, it } from 'vitest'
import type { RuntimeProvider } from '@ateam/shared'
import { previewApiKey } from './preview'

const STORED: RuntimeProvider = {
  id: 'provider-1',
  name: 'OpenAI',
  type: 'openai',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'stored-key'
}

describe('previewApiKey', () => {
  it('uses the stored key only for the same endpoint', () => {
    expect(previewApiKey({ type: 'openai', baseURL: 'https://api.openai.com/v1' }, STORED)).toBe(
      'stored-key'
    )
    expect(previewApiKey({ type: 'openai', baseURL: 'https://api.openai.com/v1/' }, STORED)).toBe(
      'stored-key'
    )
    expect(
      previewApiKey({ type: 'openai', baseURL: 'https://attacker.example/v1' }, STORED)
    ).toBeUndefined()
    expect(
      previewApiKey({ type: 'openai-compatible', baseURL: STORED.baseURL }, STORED)
    ).toBeUndefined()
  })

  it('prefers an explicit key for any endpoint', () => {
    expect(
      previewApiKey(
        { type: 'openai', baseURL: 'https://attacker.example/v1', apiKey: ' typed ' },
        STORED
      )
    ).toBe('typed')
  })

  it('never returns a key without a stored provider or explicit input', () => {
    expect(previewApiKey({ type: 'openai' })).toBeUndefined()
    expect(previewApiKey({ type: 'openai' }, STORED)).toBeUndefined()
  })
})
