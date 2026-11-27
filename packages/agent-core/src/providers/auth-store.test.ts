import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonProviderAuthStore } from './auth-store'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-auth-store-')))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function openStore(userData: string): Promise<JsonProviderAuthStore> {
  const store = new JsonProviderAuthStore(userData)
  await store.init()
  return store
}

describe('JsonProviderAuthStore', () => {
  it('persists API keys and reloads them', async () => {
    const userData = await tempDir()
    const store = await openStore(userData)
    expect(store.hasApiKey('p1')).toBe(false)

    await store.setApiKey('p1', 'sk-secret')
    expect(store.getApiKey('p1')).toBe('sk-secret')

    const reopened = await openStore(userData)
    expect(reopened.hasApiKey('p1')).toBe(true)
    expect(reopened.getApiKey('p1')).toBe('sk-secret')
  })

  it('writes auth.json with owner-only permissions', async () => {
    const userData = await tempDir()
    const store = await openStore(userData)
    await store.setApiKey('p1', 'sk-secret')
    const mode = (await fs.stat(path.join(userData, 'auth.json'))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('clears API keys and entries', async () => {
    const userData = await tempDir()
    const store = await openStore(userData)
    await store.setApiKey('p1', 'sk-one')
    await store.removeApiKey('p1')
    expect(store.hasApiKey('p1')).toBe(false)

    await store.setApiKey('p2', 'sk-two')
    await store.remove('p2')
    expect(store.getApiKey('p2')).toBeNull()
    const reopened = await openStore(userData)
    expect(reopened.getApiKey('p2')).toBeNull()
  })

  it('stores OAuth client secrets without dropping tokens', async () => {
    const userData = await tempDir()
    const store = await openStore(userData)
    await store.setClientSecret('p1', 'client-secret')
    expect(store.getClientSecret('p1')).toBe('client-secret')
    expect(store.hasApiKey('p1')).toBe(false)

    await store.removeClientSecret('p1')
    expect(store.getClientSecret('p1')).toBeNull()

    const reopened = await openStore(userData)
    expect(reopened.getClientSecret('p1')).toBeNull()
    const raw = JSON.parse(await fs.readFile(path.join(userData, 'auth.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(raw.p1).toBeUndefined()
  })

  it('ignores malformed entries instead of failing to load', async () => {
    const userData = await tempDir()
    await fs.mkdir(userData, { recursive: true })
    await fs.writeFile(
      path.join(userData, 'auth.json'),
      JSON.stringify({ good: { type: 'api', key: 'sk-good' }, bad: { type: 'api' }, junk: 1 }),
      'utf8'
    )
    const store = await openStore(userData)
    expect(store.getApiKey('good')).toBe('sk-good')
    expect(store.getApiKey('bad')).toBeNull()
  })
})
