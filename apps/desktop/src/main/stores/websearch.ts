import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import type {
  RuntimeWebSearchConfig,
  WebSearchInput,
  WebSearchProvider,
  WebSearchProviderPublic
} from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '../agent/atomic-json'

const PROVIDERS: readonly WebSearchProvider[] = ['tavily', 'exa', 'brave']

interface StoredWebSearch {
  version: 1
  provider: WebSearchProvider
  apiKey: string | null
  updatedAt: string | null
}

export class WebSearchStore {
  private config: StoredWebSearch = {
    version: 1,
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
    this.config = {
      version: 1,
      provider: PROVIDERS.includes(raw.provider as WebSearchProvider)
        ? (raw.provider as WebSearchProvider)
        : 'tavily',
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : null,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
    }
  }

  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
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
    try {
      return {
        provider: this.config.provider,
        apiKey: safeStorage.decryptString(Buffer.from(this.config.apiKey, 'base64'))
      }
    } catch {
      return null
    }
  }

  async update(input: WebSearchInput): Promise<WebSearchProviderPublic> {
    if (!PROVIDERS.includes(input.provider)) {
      throw new Error(`Unsupported web search provider: ${String(input.provider)}`)
    }
    const apiKey = input.apiKey?.trim()
    let encrypted = this.config.apiKey
    if (apiKey) {
      if (!this.isEncryptionAvailable()) throw new Error('ENCRYPTION_UNAVAILABLE')
      encrypted = safeStorage.encryptString(apiKey).toString('base64')
    }
    if (!encrypted) throw new Error('API key is required')

    this.config = {
      version: 1,
      provider: input.provider,
      apiKey: encrypted,
      updatedAt: new Date().toISOString()
    }
    await fs.mkdir(path.dirname(this.file()), { recursive: true })
    await writeJsonAtomic(this.file(), this.config)
    return this.get()
  }
}
