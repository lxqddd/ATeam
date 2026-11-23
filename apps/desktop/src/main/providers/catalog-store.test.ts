import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelCatalogStore } from './catalog-store'

const PAYLOAD = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    models: {
      'claude-sonnet-4': {
        id: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        limit: { context: 1000 }
      }
    }
  }
}

let directory: string
let now: number

beforeEach(async () => {
  now = 1_000_000
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-catalog-')))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

function createStore(fetchImpl: typeof fetch): ModelCatalogStore {
  return new ModelCatalogStore({
    userDataPath: directory,
    fetch: fetchImpl,
    now: () => now,
    ttlMs: 24 * 60 * 60 * 1000
  })
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

describe('ModelCatalogStore', () => {
  it('fetches once and serves the cache', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(PAYLOAD))
    const store = createStore(fetchMock)

    const entries = await store.get()
    expect(entries).toMatchObject([{ providerId: 'anthropic', modelId: 'claude-sonnet-4' }])

    now += 60_000
    await expect(store.get()).resolves.toEqual(entries)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes stale caches and on demand', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(PAYLOAD))
    const store = createStore(fetchMock)
    await store.get()

    now += 25 * 60 * 60 * 1000
    await store.get()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await store.get(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('falls back to the cache when refreshing fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(PAYLOAD))
    const store = createStore(fetchMock)
    const cached = await store.get()

    now += 25 * 60 * 60 * 1000
    fetchMock.mockRejectedValueOnce(new Error('offline'))

    await expect(store.get()).resolves.toEqual(cached)
  })

  it('returns an empty catalog without a cache and a failing fetch', async () => {
    const store = createStore(vi.fn<typeof fetch>(async () => Promise.reject(new Error('offline'))))
    await expect(store.get()).resolves.toEqual([])
  })

  it('persists the cache across instances', async () => {
    const first = createStore(vi.fn<typeof fetch>(async () => jsonResponse(PAYLOAD)))
    await first.get()

    const offline = vi.fn<typeof fetch>(async () => Promise.reject(new Error('offline')))
    const second = createStore(offline)

    await expect(second.get()).resolves.toMatchObject([{ modelId: 'claude-sonnet-4' }])
    expect(offline).not.toHaveBeenCalled()
  })
})
