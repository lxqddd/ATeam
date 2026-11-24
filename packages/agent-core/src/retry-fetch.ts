const RETRYABLE_STATUS = new Set([
  408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529
])
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_MAX_DELAY_MS = 60_000

export interface RetryInfo {
  attempt: number
  maxAttempts: number
  delayMs: number
  reason: string
}

export interface RetryFetchOptions {
  fetch?: typeof fetch
  maxAttempts?: number
  /** Upper bound for one retry wait, in milliseconds. */
  maxDelayMs?: number
  /** Time allowed for one request and its retry waits until response headers arrive; 0 disables. */
  timeoutMs?: number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
  onRetry?: (info: RetryInfo | null) => void
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
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

export function retryDelayMs(
  attempt: number,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  random: () => number = Math.random
): number {
  const base = 2_000 * Math.pow(2, Math.max(0, attempt - 1))
  const jitter = base * 0.25 * random()
  return Math.min(Math.ceil(base + jitter), Math.max(0, maxDelayMs))
}

function retryAfterMs(
  response: Response,
  attempt: number,
  random: () => number,
  maxDelayMs: number
): number {
  const retryAfterMs = response.headers.get('retry-after-ms')
  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs)
    if (Number.isFinite(parsed)) return Math.min(Math.max(0, parsed), maxDelayMs)
  }
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter)
    if (Number.isFinite(seconds)) {
      return Math.min(Math.max(0, Math.ceil(seconds * 1000)), maxDelayMs)
    }
    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) {
      return Math.min(Math.max(0, date - Date.now()), maxDelayMs)
    }
  }
  return retryDelayMs(attempt, maxDelayMs, random)
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

/** Whether a failure after response headers were received may be retried from scratch. */
export function isRetryableStreamError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return false
  const statusCode = (error as { statusCode?: unknown }).statusCode
  if (typeof statusCode === 'number') return RETRYABLE_STATUS.has(statusCode)
  const response = (error as { response?: { status?: unknown } }).response
  if (response && typeof response.status === 'number') return RETRYABLE_STATUS.has(response.status)
  if (error instanceof TypeError) return true
  return /fetch failed|network|connection|socket|timeout|timed out|reset|terminated|premature|other side closed|econn|enotfound|eai_again/i.test(
    error.message
  )
}

function timeoutSignal(timeoutMs: number): {
  signal: AbortSignal
  timedOut: () => boolean
  clear: () => void
} {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  timer.unref?.()
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => clearTimeout(timer)
  }
}

export function createRetryFetch(options: RetryFetchOptions = {}): typeof fetch {
  const baseFetch = options.fetch ?? fetch
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const maxDelayMs = Math.max(0, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS)
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0)
  const sleep = options.sleep ?? abortableSleep
  const random = options.random ?? Math.random

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!reusableBody(init) || input instanceof Request || init?.signal?.aborted) {
      return baseFetch(input, init)
    }

    const timeout = timeoutMs > 0 ? timeoutSignal(timeoutMs) : null
    const signal = timeout
      ? init?.signal
        ? AbortSignal.any([init.signal, timeout.signal])
        : timeout.signal
      : init?.signal
    const requestInit: RequestInit | undefined =
      signal && signal !== init?.signal ? { ...init, signal } : init

    try {
      let attempt = 0
      let announced = false
      for (;;) {
        attempt += 1
        try {
          const response = await baseFetch(input, requestInit)
          if (timeout?.timedOut()) throw timeoutError(timeoutMs)
          if (!RETRYABLE_STATUS.has(response.status)) {
            if (announced) options.onRetry?.(null)
            return response
          }
          if (attempt >= maxAttempts) return response
          const delayMs = retryAfterMs(response, attempt, random, maxDelayMs)
          announced = true
          options.onRetry?.({
            attempt,
            maxAttempts,
            delayMs,
            reason: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
          })
          await response.body?.cancel().catch(() => undefined)
          await sleep(delayMs, signal ?? undefined)
        } catch (error) {
          if (timeout?.timedOut()) throw timeoutError(timeoutMs)
          if (!retryableNetworkError(error) || attempt >= maxAttempts || signal?.aborted)
            throw error
          const delayMs = retryDelayMs(attempt, maxDelayMs, random)
          announced = true
          options.onRetry?.({
            attempt,
            maxAttempts,
            delayMs,
            reason: error instanceof Error ? error.message : String(error)
          })
          await sleep(delayMs, signal ?? undefined)
        }
      }
    } finally {
      timeout?.clear()
    }
  }
}

function timeoutError(timeoutMs: number): Error {
  return Object.assign(new Error(`Request timed out after ${timeoutMs}ms`), {
    name: 'TimeoutError'
  })
}
