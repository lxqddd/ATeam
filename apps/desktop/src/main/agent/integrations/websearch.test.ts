import { describe, expect, it, vi } from 'vitest'
import { formatSearchResults, searchWeb } from './websearch'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

describe('searchWeb', () => {
  it('calls Tavily and maps results', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        results: [{ title: 'First', url: 'https://a.example', content: 'Snippet A' }]
      })
    )

    const results = await searchWeb(
      { provider: 'tavily', apiKey: 'key-1' },
      { query: 'ateam', count: 3 },
      { fetch: fetchMock }
    )

    expect(results).toEqual([{ title: 'First', url: 'https://a.example', snippet: 'Snippet A' }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.tavily.com/search')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      api_key: 'key-1',
      query: 'ateam',
      max_results: 3
    })
  })

  it('calls Exa with its API key header', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        results: [{ title: 'Exa hit', url: 'https://b.example', text: 'Exa snippet' }]
      })
    )

    const results = await searchWeb(
      { provider: 'exa', apiKey: 'key-2' },
      { query: 'agents', count: 2 },
      { fetch: fetchMock }
    )

    expect(results).toEqual([
      { title: 'Exa hit', url: 'https://b.example', snippet: 'Exa snippet' }
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.exa.ai/search')
    expect(init?.headers).toMatchObject({ 'x-api-key': 'key-2' })
    expect(JSON.parse(String(init?.body))).toMatchObject({ query: 'agents', numResults: 2 })
  })

  it('calls Brave with query parameters and token header', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        web: {
          results: [{ title: 'Brave hit', url: 'https://c.example', description: 'Brave snippet' }]
        }
      })
    )

    const results = await searchWeb(
      { provider: 'brave', apiKey: 'key-3' },
      { query: 'web tools', count: 4 },
      { fetch: fetchMock }
    )

    expect(results).toEqual([
      { title: 'Brave hit', url: 'https://c.example', snippet: 'Brave snippet' }
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('https://api.search.brave.com/res/v1/web/search')
    expect(String(url)).toContain('q=web+tools')
    expect(String(url)).toContain('count=4')
    expect(init?.headers).toMatchObject({ 'X-Subscription-Token': 'key-3' })
  })

  it('reports provider errors with a body preview', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('bad key', { status: 401, statusText: 'Unauthorized' })
    )

    await expect(
      searchWeb(
        { provider: 'tavily', apiKey: 'nope' },
        { query: 'x', count: 1 },
        { fetch: fetchMock }
      )
    ).rejects.toThrow('HTTP 401 Unauthorized: bad key')
  })

  it('times out slow providers', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    )

    await expect(
      searchWeb(
        { provider: 'tavily', apiKey: 'key' },
        { query: 'x', count: 1 },
        { fetch: fetchMock, timeoutMs: 10 }
      )
    ).rejects.toThrow('timed out')
  })
})

describe('formatSearchResults', () => {
  it('numbers results with titles, URLs and snippets', () => {
    const text = formatSearchResults('ateam', 'tavily', [
      { title: 'First', url: 'https://a.example', snippet: 'Snippet A' },
      { title: 'Second', url: 'https://b.example', snippet: '' }
    ])

    expect(text).toBe(
      [
        'Search results for "ateam" (tavily):',
        '1. First',
        '   https://a.example',
        '   Snippet A',
        '2. Second',
        '   https://b.example'
      ].join('\n')
    )
  })

  it('reports empty result sets', () => {
    expect(formatSearchResults('nothing', 'exa', [])).toBe('No web results for "nothing".')
  })
})
