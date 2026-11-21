import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSearchStore } from './websearch'

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn()
}))

vi.mock('electron', () => ({ safeStorage }))

let directory: string
let store: WebSearchStore

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-websearch-')))
  store = new WebSearchStore(directory)
  await store.init()
  safeStorage.isEncryptionAvailable.mockReturnValue(true)
  safeStorage.encryptString.mockImplementation((value: string) => Buffer.from(`enc:${value}`))
  safeStorage.decryptString.mockImplementation((value: Buffer) => {
    const text = value.toString('utf8')
    if (!text.startsWith('enc:')) throw new Error('bad secret')
    return text.slice(4)
  })
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('WebSearchStore', () => {
  it('starts unconfigured', () => {
    expect(store.get()).toEqual({ provider: 'tavily', hasApiKey: false, updatedAt: null })
    expect(store.runtimeConfig()).toBeNull()
  })

  it('stores an encrypted API key', async () => {
    const result = await store.update({ provider: 'brave', apiKey: ' secret ' })

    expect(result).toMatchObject({ provider: 'brave', hasApiKey: true })
    expect(result.updatedAt).toEqual(expect.any(String))
    expect(store.runtimeConfig()).toEqual({ provider: 'brave', apiKey: 'secret' })

    const file = path.join(directory, 'agent', 'websearch.json')
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { apiKey: string }
    expect(JSON.stringify(raw)).not.toContain('secret')
    expect(Buffer.from(raw.apiKey, 'base64').toString('utf8')).toBe('enc:secret')
  })

  it('persists across instances', async () => {
    await store.update({ provider: 'exa', apiKey: 'persisted' })

    const reloaded = new WebSearchStore(directory)
    await reloaded.init()

    expect(reloaded.get()).toMatchObject({ provider: 'exa', hasApiKey: true })
    expect(reloaded.runtimeConfig()).toEqual({ provider: 'exa', apiKey: 'persisted' })
  })

  it('keeps the stored key when only the provider changes', async () => {
    await store.update({ provider: 'tavily', apiKey: 'keep-me' })

    await store.update({ provider: 'brave' })

    expect(store.runtimeConfig()).toEqual({ provider: 'brave', apiKey: 'keep-me' })
  })

  it('requires a key on first save and a valid provider', async () => {
    await expect(store.update({ provider: 'tavily' })).rejects.toThrow('API key is required')
    await expect(store.update({ provider: 'unknown' as never, apiKey: 'key' })).rejects.toThrow(
      'Unsupported web search provider'
    )
  })

  it('rejects saving when encryption is unavailable', async () => {
    safeStorage.isEncryptionAvailable.mockReturnValue(false)

    await expect(store.update({ provider: 'tavily', apiKey: 'key' })).rejects.toThrow(
      'ENCRYPTION_UNAVAILABLE'
    )
  })

  it('recovers from corrupt configuration files', async () => {
    const file = path.join(directory, 'agent', 'websearch.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{not json')

    const reloaded = new WebSearchStore(directory)
    await reloaded.init()

    expect(reloaded.get()).toEqual({ provider: 'tavily', hasApiKey: false, updatedAt: null })
  })
})
