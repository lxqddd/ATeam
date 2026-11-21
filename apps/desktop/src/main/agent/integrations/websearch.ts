import type { RuntimeWebSearchConfig, WebSearchProvider } from '@ateam/shared'

const DEFAULT_TIMEOUT_MS = 20_000

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export interface WebSearchQuery {
  query: string
  count: number
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    /aborted|timed out/i.test(error instanceof Error ? error.message : String(error))
  )
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<unknown> {
  const response = await fetchImpl(url, init)
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `HTTP ${response.status} ${response.statusText}${body.trim() ? `: ${body.trim().slice(0, 300)}` : ''}`
    )
  }
  return response.json()
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function searchTavily(
  fetchImpl: typeof fetch,
  apiKey: string,
  input: WebSearchQuery,
  signal: AbortSignal
): Promise<WebSearchResult[]> {
  const payload = (await requestJson(fetchImpl, 'https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: input.query,
      max_results: input.count
    }),
    signal
  })) as { results?: Array<{ title?: unknown; url?: unknown; content?: unknown }> }
  return (payload.results ?? []).map((result) => ({
    title: text(result.title),
    url: text(result.url),
    snippet: text(result.content)
  }))
}

async function searchExa(
  fetchImpl: typeof fetch,
  apiKey: string,
  input: WebSearchQuery,
  signal: AbortSignal
): Promise<WebSearchResult[]> {
  const payload = (await requestJson(fetchImpl, 'https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      query: input.query,
      numResults: input.count,
      contents: { text: { maxCharacters: 500 } }
    }),
    signal
  })) as { results?: Array<{ title?: unknown; url?: unknown; text?: unknown }> }
  return (payload.results ?? []).map((result) => ({
    title: text(result.title),
    url: text(result.url),
    snippet: text(result.text)
  }))
}

async function searchBrave(
  fetchImpl: typeof fetch,
  apiKey: string,
  input: WebSearchQuery,
  signal: AbortSignal
): Promise<WebSearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', input.query)
  url.searchParams.set('count', String(input.count))
  const payload = (await requestJson(fetchImpl, url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey
    },
    signal
  })) as { web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> } }
  return (payload.web?.results ?? []).map((result) => ({
    title: text(result.title),
    url: text(result.url),
    snippet: text(result.description)
  }))
}

export async function searchWeb(
  config: RuntimeWebSearchConfig,
  input: WebSearchQuery,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<WebSearchResult[]> {
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    switch (config.provider) {
      case 'tavily':
        return await searchTavily(fetchImpl, config.apiKey, input, signal)
      case 'exa':
        return await searchExa(fetchImpl, config.apiKey, input, signal)
      case 'brave':
        return await searchBrave(fetchImpl, config.apiKey, input, signal)
      default:
        throw new Error(`Unsupported web search provider: ${String(config.provider)}`)
    }
  } catch (error) {
    if (isAbortError(error)) throw new Error(`Search timed out after ${timeoutMs}ms`)
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export function formatSearchResults(
  query: string,
  provider: WebSearchProvider,
  results: WebSearchResult[]
): string {
  if (results.length === 0) return `No web results for "${query}".`
  const lines = [`Search results for "${query}" (${provider}):`]
  for (const [index, result] of results.entries()) {
    lines.push(`${index + 1}. ${result.title}`, `   ${result.url}`)
    if (result.snippet) lines.push(`   ${result.snippet}`)
  }
  return lines.join('\n')
}
