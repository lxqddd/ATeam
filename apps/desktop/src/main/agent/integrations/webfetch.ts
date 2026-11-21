import { promises as dns } from 'node:dns'
import TurndownService from 'turndown'
import type { WebFetchFormat } from '@ateam/shared'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5
const CACHE_TTL_MS = 5 * 60_000
const CACHE_LIMIT = 20
const DEFAULT_MAX_CHARS = 5_000_000
const USER_AGENT = 'ATeam/0.1 (+https://github.com/lxqddd/ATeam)'

const BLOCK_TAGS =
  'p|div|section|article|header|footer|main|aside|nav|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|br|hr|figure|figcaption'

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

export interface WebFetchResult {
  url: string
  status: number
  contentType: string
  format: WebFetchFormat
  content: string
}

export interface WebFetchInput {
  url: string
  format?: WebFetchFormat
  timeoutMs?: number
}

export function normalizeWebUrl(input: string): string {
  const trimmed = input.trim()
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(`Not a valid URL: ${input}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are supported: ${input}`)
  }
  url.hash = ''
  return url.toString()
}

export function isPrivateAddress(address: string): boolean {
  const value = address.trim().toLowerCase()
  if (!value) return true
  if (value.includes(':')) {
    if (value === '::1' || value === '::') return true
    if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7))
    return (
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe8') ||
      value.startsWith('fe9') ||
      value.startsWith('fea') ||
      value.startsWith('feb')
    )
  }
  const parts = value.split('.').map((part) => Number(part))
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

type Lookup = (hostname: string) => Promise<string[]>

async function defaultLookup(hostname: string): Promise<string[]> {
  const entries = await dns.lookup(hostname, { all: true })
  return entries.map((entry) => entry.address)
}

async function assertPublicUrl(url: URL, lookup: Lookup | null): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const literal = /^[0-9.]+$/.test(hostname) || hostname.includes(':')
  if (literal) {
    if (isPrivateAddress(hostname)) {
      throw new Error(`Private network addresses are not allowed: ${hostname}`)
    }
    return
  }
  if (!lookup) return
  const addresses = await lookup(hostname)
  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new Error(`Private network addresses are not allowed: ${hostname}`)
  }
}

interface CacheEntry {
  expires: number
  result: WebFetchResult
}

const cache = new Map<string, CacheEntry>()

export function clearWebFetchCache(): void {
  cache.clear()
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code: string) => {
    try {
      if (code.startsWith('#x') || code.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
      }
      if (code.startsWith('#')) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
      }
      return ENTITIES[code.toLowerCase()] ?? match
    } catch {
      return match
    }
  })
}

let turndown: TurndownService | null = null

function converter(): TurndownService {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    })
    turndown.remove(['script', 'style', 'noscript'])
  }
  return turndown
}

export function htmlToMarkdown(html: string): string {
  return converter().turndown(html).trim()
}

export function htmlToText(html: string): string {
  const withoutScripts = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
  const withBreaks = withoutScripts.replace(
    new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'),
    '\n\n'
  )
  const stripped = withBreaks.replace(/<[^>]+>/g, '')
  return decodeEntities(stripped)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    /aborted|timed out/i.test(error instanceof Error ? error.message : String(error))
  )
}

export interface WebFetchOptions {
  fetch?: typeof fetch
  maxBytes?: number
  lookup?: Lookup
  cache?: boolean
}

export async function fetchWebContent(
  input: WebFetchInput,
  options: WebFetchOptions = {}
): Promise<WebFetchResult> {
  const url = normalizeWebUrl(input.url)
  const format = input.format ?? 'markdown'
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxChars = options.maxBytes ?? DEFAULT_MAX_CHARS
  const lookup = options.lookup ?? (options.fetch ? null : defaultLookup)
  const useCache = options.cache ?? options.fetch === undefined
  const cacheKey = `${format}:${url}`
  if (useCache) {
    const cached = cache.get(cacheKey)
    if (cached && cached.expires > Date.now()) return cached.result
    if (cached) cache.delete(cacheKey)
  }

  let current = url
  let response: Response | null = null
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await assertPublicUrl(new URL(current), lookup)
      response = await fetchImpl(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*'
        }
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      if (!location) break
      current = new URL(location, current).toString()
    }
  } catch (error) {
    if (isAbortError(error)) throw new Error(`Request timed out after ${timeoutMs}ms`)
    if (error instanceof Error && /Private network addresses/.test(error.message)) throw error
    throw new Error(`Request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response) throw new Error('Request failed: no response')

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `HTTP ${response.status} ${response.statusText}${body.trim() ? `: ${body.trim().slice(0, 300)}` : ''}`
    )
  }

  const finalUrl = response.url || current
  const contentType = response.headers.get('content-type') ?? ''
  const raw = await response.text()
  let content = raw
  let effectiveFormat: WebFetchFormat = format

  if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
    content = format === 'html' ? raw : format === 'text' ? htmlToText(raw) : htmlToMarkdown(raw)
  } else {
    effectiveFormat = 'text'
  }

  if (content.length > maxChars) {
    content = `${content.slice(0, maxChars)}\n[content truncated at ${maxChars} characters]`
  }

  const result: WebFetchResult = {
    url: finalUrl,
    status: response.status,
    contentType,
    format: effectiveFormat,
    content
  }
  if (useCache) {
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, result })
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }
  return result
}

export function formatWebFetchResult(result: WebFetchResult): string {
  return `URL: ${result.url}\nStatus: ${result.status}\nContent-Type: ${result.contentType}\n\n${result.content}`
}
