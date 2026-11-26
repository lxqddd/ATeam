import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import { WEB_SEARCH_PROVIDERS } from '@ateam/shared'
import type {
  RuntimeWebSearchConfig,
  WebSearchInput,
  WebSearchProvider,
  WebSearchProviderPublic
} from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '@ateam/agent-core'

const PROVIDERS: readonly WebSearchProvider[] = WEB_SEARCH_PROVIDERS
const STORAGE_VERSION = 2

interface StoredWebSearch {
  version: 2
  provider: WebSearchProvider
  apiKey: string | null
  updatedAt: string | null
}

export class WebSearchConfigStore {
  private config: StoredWebSearch = {
    version: STORAGE_VERSION,
    provider: 'tavily',
    apiKey: null,
    updatedAt: null
  }

  constructor(private readonly userDataPath: string) {}

  private file(): string {
    return path.join(this.userDataPath, 'agent', 'websearch.json')
  }

  async init(): Promise<void> {
    const stored = await readJsonFile<unknown>(this.file())
    if (!stored || typeof stored !== 'object') return
    const raw = stored as Partial<StoredWebSearch>
    let apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : null
    let migrated = false
    if (apiKey && raw.version !== STORAGE_VERSION) {
      const plain = decryptLegacyKey(apiKey)
      if (plain) {
        apiKey = plain
        migrated = true
      }
    }
    this.config = {
      version: STORAGE_VERSION,
      provider: PROVIDERS.includes(raw.provider as WebSearchProvider)
        ? (raw.provider as WebSearchProvider)
        : 'tavily',
      apiKey,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
    }
    if (migrated) await this.persist()
  }

  get(): WebSearchProviderPublic {
    return {
      provider: this.config.provider,
      hasApiKey: Boolean(this.config.apiKey),
      updatedAt: this.config.updatedAt
    }
  }

  runtimeConfig(): RuntimeWebSearchConfig | null {
    if (!this.config.apiKey) return null
    return {
      provider: this.config.provider,
      apiKey: this.config.apiKey
    }
  }

  async update(input: WebSearchInput): Promise<WebSearchProviderPublic> {
    if (!PROVIDERS.includes(input.provider)) {
      throw new Error(`Unsupported web search provider: ${String(input.provider)}`)
    }
    const apiKey = input.apiKey?.trim()
    const nextApiKey = apiKey || this.config.apiKey
    if (!nextApiKey) throw new Error('API key is required')

    this.config = {
      version: STORAGE_VERSION,
      provider: input.provider,
      apiKey: nextApiKey,
      updatedAt: new Date().toISOString()
    }
    await this.persist()
    return this.get()
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.file()), { recursive: true })
    await writeJsonAtomic(this.file(), this.config)
  }
}

function decryptLegacyKey(value: string): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const plain = safeStorage.decryptString(Buffer.from(value, 'base64'))
    if (!plain || !/^[\x20-\x7e]+$/.test(plain)) return null
    return plain
  } catch {
    return null
  }
}
