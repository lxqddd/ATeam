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

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN))
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) return null
  return bytes
}

function parseIpv6(value: string): number[] | null {
  let input = value
  const zone = input.indexOf('%')
  if (zone !== -1) input = input.slice(0, zone)
  if (!input.includes(':')) return null

  const lastColon = input.lastIndexOf(':')
  const tail = input.slice(lastColon + 1)
  if (tail.includes('.')) {
    const ipv4 = parseIpv4(tail)
    if (!ipv4) return null
    input = `${input.slice(0, lastColon + 1)}${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`
  }

  const halves = input.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tailGroups = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 2) {
    if (head.length + tailGroups.length > 7) return null
  } else if (head.length !== 8) {
    return null
  }
  const groups = [
    ...head,
    ...Array<string>(8 - head.length - tailGroups.length).fill('0'),
    ...tailGroups
  ]
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null

  const bytes: number[] = []
  for (const group of groups) {
    const number = Number.parseInt(group, 16)
    bytes.push(number >> 8, number & 0xff)
  }
  return bytes
}

function isPrivateIpv4(parts: number[]): boolean {
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

function isPrivateIpv6(bytes: number[]): boolean {
  const zeros = (start: number, end: number): boolean =>
    bytes.slice(start, end).every((byte) => byte === 0)

  if (zeros(0, 16)) return true
  if (zeros(0, 15) && bytes[15] === 1) return true
  if ((bytes[0] & 0xfe) === 0xfc) return true
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true
  if (bytes[0] === 0xff) return true
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return true
  }

  const embedded = (offset: number): boolean => isPrivateIpv4(bytes.slice(offset, offset + 4))

  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return embedded(12)
  if (zeros(0, 12)) return embedded(12)
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    zeros(4, 12)
  ) {
    return embedded(12)
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return embedded(2)
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0 && bytes[3] === 0) {
    return embedded(12)
  }
  return false
}

export function isPrivateAddress(address: string): boolean {
  const value = address.trim().toLowerCase()
  if (!value) return true
  if (value.includes(':')) {
    const bytes = parseIpv6(value)
    return bytes ? isPrivateIpv6(bytes) : true
  }
  const parts = parseIpv4(value)
  return parts ? isPrivateIpv4(parts) : true
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

export async function assertPublicWebUrl(
  input: string | URL,
  lookup: Lookup | null = defaultLookup
): Promise<void> {
  await assertPublicUrl(typeof input === 'string' ? new URL(input) : input, lookup)
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

async function readTextLimited(
  response: Response,
  maxChars: number
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const text = await response.text()
    return { text: text.slice(0, maxChars), truncated: text.length > maxChars }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (text.length >= maxChars) {
        truncated = true
        break
      }
    }
    if (!truncated) text += decoder.decode()
    if (text.length > maxChars) {
      text = text.slice(0, maxChars)
      truncated = true
    }
    return { text, truncated }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
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
      await response.body?.cancel().catch(() => undefined)
      current = new URL(location, current).toString()
    }
  } catch (error) {
    if (isAbortError(error)) throw new Error(`Request timed out after ${timeoutMs}ms`)
    if (error instanceof Error && /Private network addresses/.test(error.message)) throw error
    throw new Error(`Request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response) throw new Error('Request failed: no response')

  if (!response.ok) {
    const body = await readTextLimited(response, 300)
      .then((result) => result.text)
      .catch(() => '')
    throw new Error(
      `HTTP ${response.status} ${response.statusText}${body.trim() ? `: ${body.trim().slice(0, 300)}` : ''}`
    )
  }

  const finalUrl = response.url || current
  const contentType = response.headers.get('content-type') ?? ''
  const rawResult = await readTextLimited(response, maxChars)
  const raw = rawResult.text
  let content = raw
  let effectiveFormat: WebFetchFormat = format

  if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
    content = format === 'html' ? raw : format === 'text' ? htmlToText(raw) : htmlToMarkdown(raw)
  } else {
    effectiveFormat = 'text'
  }

  if (content.length > maxChars) {
    content = `${content.slice(0, maxChars)}\n[content truncated at ${maxChars} characters]`
  } else if (rawResult.truncated) {
    content = `${content}\n[content truncated at ${maxChars} characters]`
  }

  const result: WebFetchResult = {
    url: finalUrl,
    status: response.status,
    contentType,
    format: effectiveFormat,
    content
  }
  if (useCache && result.content.length <= 1_000_000) {
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
