import { describe, expect, it, vi } from 'vitest'
import { fetchModelCatalog, parseModelCatalog } from './catalog'

const PAYLOAD = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    api: 'https://api.anthropic.com',
    npm: '@ai-sdk/anthropic',
    models: {
      'claude-sonnet-4': {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        attachment: true,
        reasoning: true,
        limit: { context: 200_000, output: 64_000 },
        cost: { input: 3, output: 15 }
      },
      'no-limits': { id: 'no-limits', name: 'No limits' }
    }
  },
  custom: {
    id: 'custom',
    name: 'Custom LLM',
    api: 'https://llm.example',
    npm: 'some-other-sdk',
    models: { m: { id: 'm', name: 'M' } }
  },
  empty: { id: 'empty', name: 'Empty Provider' },
  invalid: 'nope'
}

describe('parseModelCatalog', () => {
  it('maps providers and models to catalog entries', () => {
    const entries = parseModelCatalog(PAYLOAD)

    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({
      providerId: 'anthropic',
      providerName: 'Anthropic',
      providerApi: 'https://api.anthropic.com',
      providerType: 'anthropic',
      modelId: 'claude-sonnet-4',
      name: 'Claude Sonnet 4',
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      reasoning: true,
      attachment: true,
      costInput: 3,
      costOutput: 15
    })
    expect(entries[1]).toMatchObject({
      modelId: 'no-limits',
      contextWindow: null,
      maxOutputTokens: null,
      reasoning: false,
      attachment: false,
      costInput: null,
      costOutput: null
    })
    expect(entries[2]).toMatchObject({
      providerId: 'custom',
      providerApi: 'https://llm.example',
      providerType: 'openai-compatible',
      modelId: 'm'
    })
  })

  it('ignores malformed payloads', () => {
    expect(parseModelCatalog(null)).toEqual([])
    expect(parseModelCatalog({ p: { models: 'nope' } })).toEqual([])
    expect(
      parseModelCatalog({ p: { id: 'p', name: 'P', models: { m: { name: 'M' } } } })
    ).toMatchObject([{ providerId: 'p', modelId: 'm', name: 'M' }])
  })
})

describe('fetchModelCatalog', () => {
  it('fetches models.dev and parses the payload', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )

    const entries = await fetchModelCatalog({ fetch: fetchMock })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://models.dev/api.json',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) })
    )
    expect(entries).toHaveLength(3)
  })

  it('rejects HTTP failures', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('nope', { status: 503, statusText: 'Unavailable' })
    )

    await expect(fetchModelCatalog({ fetch: fetchMock })).rejects.toThrow('HTTP 503')
  })

  it('times out slow requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )

    await expect(fetchModelCatalog({ fetch: fetchMock, timeoutMs: 10 })).rejects.toThrow(
      'timed out'
    )
  })
})
