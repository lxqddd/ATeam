import path from 'node:path'
import { readJsonFile, writeJsonAtomic } from '../atomic-json'

interface ApiEntry {
  type: 'api'
  key: string
}

interface OAuthEntry {
  type: 'oauth'
  access?: string
  refresh?: string
  expires?: number
  tokenEndpoint?: string
  clientId?: string
  clientSecret?: string
  scope?: string
}

type StoredEntry = ApiEntry | OAuthEntry
type StoredFile = Record<string, StoredEntry>

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseEntry(value: unknown): StoredEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type === 'api') {
    const key = stringValue(raw.key)
    return key ? { type: 'api', key } : null
  }
  if (raw.type !== 'oauth') return null
  const entry: OAuthEntry = { type: 'oauth' }
  const access = stringValue(raw.access)
  const refresh = stringValue(raw.refresh)
  const expires = numberValue(raw.expires)
  const tokenEndpoint = stringValue(raw.tokenEndpoint)
  const clientId = stringValue(raw.clientId)
  const clientSecret = stringValue(raw.clientSecret)
  const scope = stringValue(raw.scope)
  if (access) entry.access = access
  if (refresh) entry.refresh = refresh
  if (expires !== undefined) entry.expires = expires
  if (tokenEndpoint) entry.tokenEndpoint = tokenEndpoint
  if (clientId) entry.clientId = clientId
  if (clientSecret) entry.clientSecret = clientSecret
  if (scope) entry.scope = scope
  if (!access && !clientSecret && !tokenEndpoint && !clientId) return null
  return entry
}

/**
 * Credential operations the model configuration needs from `userData/auth.json`.
 *
 * The desktop app implements this with its Electron-aware store (which also
 * migrates legacy encrypted entries); headless entries use
 * {@link JsonProviderAuthStore}.
 */
export interface ModelCredentialStore {
  init(): Promise<void>
  getApiKey(providerId: string): string | null
  hasApiKey(providerId: string): boolean
  setApiKey(providerId: string, key: string): Promise<void>
  removeApiKey(providerId: string): Promise<void>
  getClientSecret(providerId: string): string | null
  setClientSecret(providerId: string, secret: string): Promise<void>
  removeClientSecret(providerId: string): Promise<void>
  remove(providerId: string): Promise<void>
}

/**
 * Electron-free credential store reading and writing the same
 * `userData/auth.json` document as the desktop app. Writes go through
 * `writeJsonAtomic`, so the file keeps its 0600 mode.
 */
export class JsonProviderAuthStore implements ModelCredentialStore {
  private entries: StoredFile = {}

  constructor(private readonly userDataPath: string) {}

  private file(): string {
    return path.join(this.userDataPath, 'auth.json')
  }

  async init(): Promise<void> {
    const stored = await readJsonFile<unknown>(this.file())
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const entries: StoredFile = {}
      for (const [providerId, value] of Object.entries(stored as Record<string, unknown>)) {
        const entry = parseEntry(value)
        if (entry) entries[providerId] = entry
      }
      this.entries = entries
      return
    }
    this.entries = {}
  }

  getApiKey(providerId: string): string | null {
    const entry = this.entries[providerId]
    return entry?.type === 'api' ? entry.key : null
  }

  hasApiKey(providerId: string): boolean {
    return Boolean(this.getApiKey(providerId))
  }

  async setApiKey(providerId: string, key: string): Promise<void> {
    this.entries[providerId] = { type: 'api', key }
    await this.persist()
  }

  async removeApiKey(providerId: string): Promise<void> {
    if (this.entries[providerId]?.type !== 'api') return
    delete this.entries[providerId]
    await this.persist()
  }

  getClientSecret(providerId: string): string | null {
    const entry = this.entries[providerId]
    return entry?.type === 'oauth' ? (entry.clientSecret ?? null) : null
  }

  async setClientSecret(providerId: string, secret: string): Promise<void> {
    const existing = this.entries[providerId]
    const entry: OAuthEntry = existing?.type === 'oauth' ? { ...existing } : { type: 'oauth' }
    entry.clientSecret = secret
    this.entries[providerId] = entry
    await this.persist()
  }

  async removeClientSecret(providerId: string): Promise<void> {
    const entry = this.entries[providerId]
    if (entry?.type !== 'oauth' || !entry.clientSecret) return
    delete entry.clientSecret
    if (!entry.access && !entry.tokenEndpoint && !entry.clientId) {
      delete this.entries[providerId]
    }
    await this.persist()
  }

  async remove(providerId: string): Promise<void> {
    if (!this.entries[providerId]) return
    delete this.entries[providerId]
    await this.persist()
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.file(), this.entries)
  }
}
