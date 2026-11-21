import TurndownService from 'turndown'
import type { WebFetchFormat } from '@ateam/shared'

const DEFAULT_TIMEOUT_MS = 30_000
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

export async function fetchWebContent(
  input: WebFetchInput,
  options: { fetch?: typeof fetch; maxBytes?: number } = {}
): Promise<WebFetchResult> {
  const url = normalizeWebUrl(input.url)
  const format = input.format ?? 'markdown'
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxChars = options.maxBytes ?? DEFAULT_MAX_CHARS

  let response: Response
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*'
      }
    })
  } catch (error) {
    if (isAbortError(error)) throw new Error(`Request timed out after ${timeoutMs}ms`)
    throw new Error(`Request failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `HTTP ${response.status} ${response.statusText}${body.trim() ? `: ${body.trim().slice(0, 300)}` : ''}`
    )
  }

  const finalUrl = response.url || url
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

  return {
    url: finalUrl,
    status: response.status,
    contentType,
    format: effectiveFormat,
    content
  }
}

export function formatWebFetchResult(result: WebFetchResult): string {
  return `URL: ${result.url}\nStatus: ${result.status}\nContent-Type: ${result.contentType}\n\n${result.content}`
}
