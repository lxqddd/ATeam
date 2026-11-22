import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { ProviderAuthRecord, ProviderOAuthStatus, ProviderPublic } from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '../agent/atomic-json'

interface StoredEntry {
  payload: string
  updatedAt: string
}

interface StoredFile {
  version: 1
  providers: Record<string, StoredEntry>
}

export interface ProviderAuthStoreLike {
  list(): ProviderAuthRecord[]
  get(providerId: string): ProviderAuthRecord | null
  set(record: ProviderAuthRecord): Promise<void>
  remove(providerId: string): Promise<void>
}

function isRecord(value: unknown): value is ProviderAuthRecord {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw.providerId === 'string' &&
    typeof raw.accessToken === 'string' &&
    raw.accessToken.length > 0 &&
    typeof raw.tokenEndpoint === 'string' &&
    typeof raw.clientId === 'string'
  )
}

export class ProviderAuthStore implements ProviderAuthStoreLike {
  private providers: Record<string, StoredEntry> = {}

  constructor(private readonly userDataPath: string) {}

  private file(): string {
    return path.join(this.userDataPath, 'models', 'oauth-tokens.json')
  }

  async init(): Promise<void> {
    const stored = await readJsonFile<unknown>(this.file())
    if (!stored || typeof stored !== 'object') return
    const raw = stored as Partial<StoredFile>
    const providers: Record<string, StoredEntry> = {}
    for (const [id, entry] of Object.entries(raw.providers ?? {})) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = entry as Partial<StoredEntry>
      if (typeof candidate.payload !== 'string' || typeof candidate.updatedAt !== 'string') {
        continue
      }
      providers[id] = { payload: candidate.payload, updatedAt: candidate.updatedAt }
    }
    this.providers = providers
  }

  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  list(): ProviderAuthRecord[] {
    const records: ProviderAuthRecord[] = []
    for (const [id, entry] of Object.entries(this.providers)) {
      const record = this.decrypt(id, entry)
      if (record) records.push(record)
    }
    return records
  }

  get(providerId: string): ProviderAuthRecord | null {
    const entry = this.providers[providerId]
    return entry ? this.decrypt(providerId, entry) : null
  }

  statuses(providers: ProviderPublic[]): ProviderOAuthStatus[] {
    return providers.map((provider) => {
      const record = this.get(provider.id)
      return {
        providerId: provider.id,
        providerName: provider.name,
        authorized: Boolean(record),
        expiresAt:
          record?.expiresAt && Number.isFinite(record.expiresAt)
            ? new Date(record.expiresAt).toISOString()
            : null
      }
    })
  }

  async set(record: ProviderAuthRecord): Promise<void> {
    if (!this.isEncryptionAvailable()) throw new Error('ENCRYPTION_UNAVAILABLE')
    this.providers[record.providerId] = {
      payload: safeStorage.encryptString(JSON.stringify(record)).toString('base64'),
      updatedAt: new Date().toISOString()
    }
    await this.persist()
  }

  async remove(providerId: string): Promise<void> {
    if (!this.providers[providerId]) return
    delete this.providers[providerId]
    await this.persist()
  }

  private decrypt(providerId: string, entry: StoredEntry): ProviderAuthRecord | null {
    if (!this.isEncryptionAvailable()) return null
    try {
      const parsed = JSON.parse(
        safeStorage.decryptString(Buffer.from(entry.payload, 'base64'))
      ) as unknown
      if (!isRecord(parsed)) return null
      return { ...parsed, providerId }
    } catch {
      return null
    }
  }

  private async persist(): Promise<void> {
    const file: StoredFile = { version: 1, providers: this.providers }
    await fs.mkdir(path.dirname(this.file()), { recursive: true })
    await writeJsonAtomic(this.file(), file)
  }
}
