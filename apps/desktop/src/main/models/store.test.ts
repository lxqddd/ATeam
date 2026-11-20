import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ProviderType } from '@ateam/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^enc:/, ''))
}))

vi.mock('electron', () => ({ safeStorage }))

import { ModelsStore } from './store'

let directory: string
let store: ModelsStore

async function readStoredJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(directory, 'models', file), 'utf8')) as T
}

async function addAnthropic(): Promise<string> {
  const config = await store.addProvider({
    name: 'Anthropic',
    type: 'anthropic',
    apiKey: 'sk-test-secret'
  })
  return config.providers[0].id
}

beforeEach(async () => {
  safeStorage.isEncryptionAvailable.mockReturnValue(true)
  safeStorage.encryptString.mockClear()
  safeStorage.decryptString.mockClear()
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-test-')))
  store = new ModelsStore(directory)
  await store.init()
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('ModelsStore', () => {
  it('starts empty', () => {
    expect(store.publicConfig()).toMatchObject({
      providers: [],
      models: [],
      defaultModel: null,
      encryptionAvailable: true
    })
  })

  it('requires an API key for built-in providers', async () => {
    await expect(store.addProvider({ name: 'Anthropic', type: 'anthropic' })).rejects.toThrow(
      'API_KEY_REQUIRED'
    )
  })

  it('requires a base URL for openai-compatible providers', async () => {
    await expect(
      store.addProvider({ name: 'Local', type: 'openai-compatible', apiKey: 'sk-test' })
    ).rejects.toThrow('BASE_URL_REQUIRED')
  })

  it('accepts openai-compatible providers without a key', async () => {
    const config = await store.addProvider({
      name: 'Local',
      type: 'openai-compatible',
      baseURL: 'http://localhost:11434/v1/'
    })

    expect(config.providers[0]).toMatchObject({
      name: 'Local',
      type: 'openai-compatible',
      baseURL: 'http://localhost:11434/v1',
      hasApiKey: false
    })
  })

  it('validates provider input', async () => {
    await expect(
      store.addProvider({ name: '  ', type: 'anthropic', apiKey: 'sk-test' })
    ).rejects.toThrow('NAME_REQUIRED')
    await expect(
      store.addProvider({ name: 'A', type: 'unknown' as ProviderType, apiKey: 'sk-test' })
    ).rejects.toThrow('INVALID_PROVIDER_TYPE')
    await expect(
      store.addProvider({
        name: 'A',
        type: 'openai-compatible',
        baseURL: 'ftp://example.com',
        apiKey: 'sk-test'
      })
    ).rejects.toThrow('INVALID_BASE_URL')
  })

  it('stores API keys encrypted and exposes only hasApiKey', async () => {
    const providerId = await addAnthropic()

    expect(store.publicConfig().providers[0]).toMatchObject({ id: providerId, hasApiKey: true })
    expect(JSON.stringify(store.publicConfig())).not.toContain('sk-test-secret')
    expect(store.runtimeConfig().providers[0].apiKey).toBe('sk-test-secret')

    const config = await readStoredJson<unknown>('config.json')
    expect(JSON.stringify(config)).not.toContain('sk-test-secret')

    const secrets = await readStoredJson<{ keys: Record<string, string> }>('secrets.json')
    expect(secrets.keys[providerId]).toBe(Buffer.from('enc:sk-test-secret').toString('base64'))
  })

  it('rejects saving keys when encryption is unavailable', async () => {
    safeStorage.isEncryptionAvailable.mockReturnValue(false)

    await expect(
      store.addProvider({ name: 'Anthropic', type: 'anthropic', apiKey: 'sk-test' })
    ).rejects.toThrow('ENCRYPTION_UNAVAILABLE')
    expect(store.publicConfig()).toMatchObject({ providers: [], encryptionAvailable: false })
  })

  it('updates provider fields', async () => {
    const providerId = await addAnthropic()

    const renamed = await store.updateProvider({
      id: providerId,
      name: 'Renamed',
      baseURL: 'https://api.example.com/'
    })
    expect(renamed.providers[0]).toMatchObject({
      name: 'Renamed',
      baseURL: 'https://api.example.com'
    })

    const retyped = await store.updateProvider({ id: providerId, type: 'openai' })
    expect(retyped.providers[0].type).toBe('openai')
    expect(store.runtimeConfig().providers[0].apiKey).toBe('sk-test-secret')
  })

  it('rejects updates for missing providers', async () => {
    await expect(store.updateProvider({ id: 'missing', name: 'x' })).rejects.toThrow(
      'PROVIDER_NOT_FOUND'
    )
    await expect(store.deleteProvider('missing')).rejects.toThrow('PROVIDER_NOT_FOUND')
  })

  it('refuses to clear the key of a provider that requires one', async () => {
    const providerId = await addAnthropic()

    await expect(store.updateProvider({ id: providerId, clearApiKey: true })).rejects.toThrow(
      'API_KEY_REQUIRED'
    )
    expect(store.runtimeConfig().providers[0].apiKey).toBe('sk-test-secret')
  })

  it('clears keys on openai-compatible providers', async () => {
    const config = await store.addProvider({
      name: 'Local',
      type: 'openai-compatible',
      baseURL: 'http://localhost:1234',
      apiKey: 'sk-local'
    })
    const providerId = config.providers[0].id

    const updated = await store.updateProvider({ id: providerId, clearApiKey: true })
    expect(updated.providers[0].hasApiKey).toBe(false)
    expect(store.runtimeConfig().providers[0].apiKey).toBeUndefined()
  })

  it('deletes a provider with its models, key and default pointer', async () => {
    const providerId = await addAnthropic()
    await store.addModel({ providerId, modelId: 'claude-sonnet-5' })

    const config = await store.deleteProvider(providerId)

    expect(config).toMatchObject({ providers: [], models: [], defaultModel: null })
    const secrets = await readStoredJson<{ keys: Record<string, string> }>('secrets.json')
    expect(secrets.keys).toEqual({})
  })

  it('makes the first model the default', async () => {
    const providerId = await addAnthropic()
    const config = await store.addModel({ providerId, modelId: 'claude-sonnet-5' })

    expect(config.defaultModel).toEqual({ providerId, modelId: 'claude-sonnet-5' })
    expect(config.models[0].name).toBe('claude-sonnet-5')
  })

  it('rejects duplicate models', async () => {
    const providerId = await addAnthropic()
    await store.addModel({ providerId, modelId: 'claude-sonnet-5' })

    await expect(store.addModel({ providerId, modelId: '  claude-sonnet-5  ' })).rejects.toThrow(
      'MODEL_EXISTS'
    )
    await expect(store.addModel({ providerId: 'missing', modelId: 'm' })).rejects.toThrow(
      'PROVIDER_NOT_FOUND'
    )
  })

  it('falls back to the first remaining model when the default is deleted', async () => {
    const providerId = await addAnthropic()
    const first = await store.addModel({ providerId, modelId: 'm1' })
    await store.addModel({ providerId, modelId: 'm2' })

    const afterDelete = await store.deleteModel(first.models[0].id)
    expect(afterDelete.defaultModel).toEqual({ providerId, modelId: 'm2' })

    const lastModel = afterDelete.models.find((model) => model.modelId === 'm2')
    expect(lastModel).toBeDefined()
    const afterLastDelete = await store.deleteModel(lastModel?.id ?? '')
    expect(afterLastDelete.defaultModel).toBeNull()
  })

  it('rejects deleting a missing model', async () => {
    await expect(store.deleteModel('missing')).rejects.toThrow('MODEL_NOT_FOUND')
  })

  it('sets and clears the default model', async () => {
    const providerId = await addAnthropic()
    await store.addModel({ providerId, modelId: 'm1' })
    await store.addModel({ providerId, modelId: 'm2' })

    expect(await store.setDefault({ providerId, modelId: 'm2' })).toMatchObject({
      defaultModel: { providerId, modelId: 'm2' }
    })
    await expect(store.setDefault({ providerId, modelId: 'missing' })).rejects.toThrow(
      'MODEL_NOT_FOUND'
    )
    expect((await store.setDefault(null)).defaultModel).toBeNull()
  })

  it('updates model names', async () => {
    const providerId = await addAnthropic()
    const config = await store.addModel({ providerId, modelId: 'm1' })
    const modelId = config.models[0].id

    const updated = await store.updateModel({ id: modelId, name: 'Model One' })
    expect(updated.models[0].name).toBe('Model One')

    await expect(store.updateModel({ id: modelId, name: '   ' })).rejects.toThrow('NAME_REQUIRED')
    await expect(store.updateModel({ id: 'missing', name: 'x' })).rejects.toThrow('MODEL_NOT_FOUND')
  })

  it('keeps the previous key when re-encryption is unavailable', async () => {
    const providerId = await addAnthropic()
    safeStorage.isEncryptionAvailable.mockReturnValue(false)

    await expect(store.updateProvider({ id: providerId, apiKey: 'sk-new' })).rejects.toThrow(
      'ENCRYPTION_UNAVAILABLE'
    )
    expect(store.runtimeConfig().providers[0].apiKey).toBe('sk-test-secret')
  })

  it('reloads providers and decrypts keys from disk', async () => {
    const providerId = await addAnthropic()

    const reloaded = new ModelsStore(directory)
    await reloaded.init()

    expect(reloaded.publicConfig().providers[0]).toMatchObject({ id: providerId, hasApiKey: true })
    expect(reloaded.runtimeConfig().providers[0].apiKey).toBe('sk-test-secret')
  })

  it('repairs a default model that no longer exists on init', async () => {
    await fs.mkdir(path.join(directory, 'models'), { recursive: true })
    await fs.writeFile(
      path.join(directory, 'models', 'config.json'),
      JSON.stringify({
        version: 1,
        providers: [
          {
            id: 'provider-1',
            name: 'P',
            type: 'anthropic',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        ],
        models: [
          {
            id: 'model-1',
            providerId: 'provider-1',
            modelId: 'm1',
            name: 'M1',
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ],
        defaultModel: { providerId: 'provider-1', modelId: 'gone' }
      })
    )

    const reloaded = new ModelsStore(directory)
    await reloaded.init()

    expect(reloaded.publicConfig().defaultModel).toEqual({
      providerId: 'provider-1',
      modelId: 'm1'
    })
  })
})
