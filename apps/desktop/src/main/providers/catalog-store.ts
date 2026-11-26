import fs from 'node:fs/promises'
import path from 'node:path'
import type { ModelCatalogEntry } from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '@ateam/agent-core'
import { fetchModelCatalog } from './catalog'

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

interface StoredCatalog {
  fetchedAt: number
  entries: ModelCatalogEntry[]
}

export class ModelCatalogStore {
  private readonly file: string
  private readonly ttlMs: number

  constructor(
    private readonly options: {
      userDataPath: string
      fetch?: typeof fetch
      now?: () => number
      ttlMs?: number
    }
  ) {
    this.file = path.join(options.userDataPath, 'agent', 'model-catalog.json')
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  }

  async get(force = false): Promise<ModelCatalogEntry[]> {
    const cached = await this.readCache()
    const now = this.now()
    if (!force && cached && now - cached.fetchedAt < this.ttlMs) {
      return cached.entries
    }

    try {
      const entries = await fetchModelCatalog({ fetch: this.options.fetch })
      await this.writeCache({ fetchedAt: now, entries })
      return entries
    } catch {
      return cached?.entries ?? []
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private async readCache(): Promise<StoredCatalog | null> {
    const stored = await readJsonFile<StoredCatalog>(this.file)
    if (!stored || typeof stored.fetchedAt !== 'number' || !Array.isArray(stored.entries)) {
      return null
    }
    return stored
  }

  private async writeCache(catalog: StoredCatalog): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await writeJsonAtomic(this.file, catalog)
  }
}
