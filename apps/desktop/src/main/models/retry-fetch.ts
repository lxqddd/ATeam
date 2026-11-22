const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 524])
const DEFAULT_MAX_ATTEMPTS = 5
const MAX_DELAY_MS = 30_000
const MAX_HEADER_DELAY_MS = 60_000

export interface RetryInfo {
  attempt: number
  maxAttempts: number
  delayMs: number
  reason: string
}

export interface RetryFetchOptions {
  fetch?: typeof fetch
  maxAttempts?: number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
  onRetry?: (info: RetryInfo | null) => void
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function backoffMs(attempt: number, random: () => number): number {
  const base = 2_000 * Math.pow(2, Math.max(0, attempt - 1))
  const jitter = base * 0.25 * random()
  return Math.min(Math.ceil(base + jitter), MAX_DELAY_MS)
}

function retryAfterMs(response: Response, attempt: number, random: () => number): number {
  const retryAfterMs = response.headers.get('retry-after-ms')
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs)
    if (Number.isFinite(parsed)) return Math.min(Math.max(0, parsed), MAX_HEADER_DELAY_MS)
  }
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter)
    if (Number.isFinite(seconds)) {
      return Math.min(Math.max(0, Math.ceil(seconds * 1000)), MAX_HEADER_DELAY_MS)
    }
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) {
      return Math.min(Math.max(0, date - Date.now()), MAX_HEADER_DELAY_MS)
    }
  }
  return backoffMs(attempt, random)
}

function reusableBody(init: RequestInit | undefined): boolean {
  const body = init?.body
  if (body === undefined || body === null) return true
  if (typeof body === 'string') return true
  if (body instanceof URLSearchParams) return true
  if (body instanceof ArrayBuffer) return true
  if (ArrayBuffer.isView(body)) return true
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true
  return false
}

function retryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return false
  if (error instanceof TypeError) return true
  return /fetch failed|network|connection|socket|timeout|timed out|reset|econn|enotfound|eai_again/i.test(
    error.message
  )
}

export function createRetryFetch(options: RetryFetchOptions = {}): typeof fetch {
  const baseFetch = options.fetch ?? fetch
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!reusableBody(init) || input instanceof Request || init?.signal?.aborted) {
      return baseFetch(input, init)
    }

    let attempt = 0
    let announced = false
    for (;;) {
      attempt += 1
      try {
        const response = await baseFetch(input, init)
        if (!RETRYABLE_STATUS.has(response.status)) {
          if (announced) options.onRetry?.(null)
          return response
        }
        if (attempt >= maxAttempts) return response
        const delayMs = retryAfterMs(response, attempt, random)
        announced = true
        options.onRetry?.({
          attempt,
          maxAttempts,
          delayMs,
          reason: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
        })
        await response.body?.cancel().catch(() => undefined)
        await sleep(delayMs, init?.signal ?? undefined)
      } catch (error) {
        if (!retryableNetworkError(error) || attempt >= maxAttempts || init?.signal?.aborted)
          throw error
        const delayMs = backoffMs(attempt, random)
        announced = true
        options.onRetry?.({
          attempt,
          maxAttempts,
          delayMs,
          reason: error instanceof Error ? error.message : String(error)
        })
        await sleep(delayMs, init?.signal ?? undefined)
      }
    }
  }
}
