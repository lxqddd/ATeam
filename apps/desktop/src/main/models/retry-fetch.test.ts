import { describe, expect, it, vi } from 'vitest'
import { createRetryFetch } from './retry-fetch'

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : '{}', { status, headers })
}

function setup(
  fetchImpl: typeof fetch,
  overrides: Parameters<typeof createRetryFetch>[0] = {}
): { retryFetch: typeof fetch; sleeps: number[]; retries: unknown[] } {
  const sleeps: number[] = []
  const retries: unknown[] = []
  const retryFetch = createRetryFetch({
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    random: () => 0,
    onRetry: (info) => retries.push(info),
    ...overrides
  })
  return { retryFetch, sleeps, retries }
}

describe('createRetryFetch', () => {
  it('retries a retryable status after the Retry-After delay', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce(response(200))
    const { retryFetch, sleeps, retries } = setup(fetchImpl)

    const result = await retryFetch('https://api.example.com', { method: 'POST', body: '{}' })

    expect(result.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([2_000])
    expect(retries[0]).toMatchObject({ attempt: 1, maxAttempts: 5, delayMs: 2_000 })
    expect(retries.at(-1)).toBeNull()
  })

  it('supports retry-after-ms and HTTP-date headers', async () => {
    const future = new Date(Date.now() + 5_000).toUTCString()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(503, { 'retry-after': future }))
      .mockResolvedValueOnce(response(200))
    const { retryFetch, sleeps } = setup(fetchImpl)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now())

    await retryFetch('https://api.example.com')

    expect(sleeps[0]).toBeGreaterThan(0)
    expect(sleeps[0]).toBeLessThanOrEqual(5_000)
    vi.restoreAllMocks()
  })

  it('returns the last response after the attempt limit', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(503))
    const { retryFetch, retries } = setup(fetchImpl, { maxAttempts: 2 })

    const result = await retryFetch('https://api.example.com')

    expect(result.status).toBe(503)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(retries).toHaveLength(1)
  })

  it('does not retry non-retryable responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(401))
    const { retryFetch, retries } = setup(fetchImpl)

    const result = await retryFetch('https://api.example.com')

    expect(result.status).toBe(401)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(retries).toEqual([])
  })

  it('retries network failures and reports the reason', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response(200))
    const { retryFetch, retries } = setup(fetchImpl)

    const result = await retryFetch('https://api.example.com')

    expect(result.status).toBe(200)
    expect(retries[0]).toMatchObject({
      attempt: 1,
      reason: expect.stringContaining('fetch failed')
    })
  })

  it('rethrows after exhausting network retries', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('connection reset'))
    const { retryFetch } = setup(fetchImpl, { maxAttempts: 2 })

    await expect(retryFetch('https://api.example.com')).rejects.toThrow('connection reset')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops waiting when the request is aborted', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(429, { 'retry-after': '30' }))
    const controller = new AbortController()
    const retryFetch = createRetryFetch({
      fetch: fetchImpl,
      onRetry: () => controller.abort(),
      sleep: (_ms, signal) =>
        new Promise((_resolve, reject) => {
          const fail = (): void =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          if (signal?.aborted) fail()
          else signal?.addEventListener('abort', fail, { once: true })
        })
    })

    await expect(
      retryFetch('https://api.example.com', { signal: controller.signal })
    ).rejects.toThrow('aborted')
  })

  it('does not retry non-reusable streaming bodies', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(503))
    const { retryFetch } = setup(fetchImpl)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      }
    })

    await retryFetch('https://api.example.com', { method: 'POST', body })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
