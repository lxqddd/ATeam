import path from 'node:path'
import { safeStorage } from 'electron'
import type {
  PluginAuthCredentials,
  ProviderAuthRecord,
  ProviderOAuthStatus,
  ProviderPublic,
  RuntimeProviderAuth
} from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '@ateam/agent-core/storage'

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

interface LegacySecrets {
  keys?: Record<string, string>
}

interface LegacyTokenEntry {
  payload?: string
}

interface LegacyTokens {
  providers?: Record<string, LegacyTokenEntry>
}

interface LegacyConfig {
  providers?: Array<{ id?: string; authMode?: string }>
}

export interface ProviderAuthStoreLike {
  list(): ProviderAuthRecord[]
  get(providerId: string): ProviderAuthRecord | null
  set(record: ProviderAuthRecord): Promise<void>
  remove(providerId: string): Promise<void>
  runtimeAuth?(): RuntimeProviderAuth[]
}

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

function legacyDecrypt(value: string): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return null
  }
}

export class ProviderAuthStore implements ProviderAuthStoreLike {
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
    await this.migrateLegacy()
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

  async setPluginCredentials(
    providerId: string,
    credentials: PluginAuthCredentials
  ): Promise<void> {
    if (credentials.type === 'api') {
      await this.setApiKey(providerId, credentials.key)
      return
    }
    const entry: OAuthEntry = { type: 'oauth', access: credentials.accessToken }
    const refresh = stringValue(credentials.refreshToken)
    const expires = numberValue(credentials.expiresAt)
    const tokenEndpoint = stringValue(credentials.tokenEndpoint)
    const clientId = stringValue(credentials.clientId)
    const clientSecret = stringValue(credentials.clientSecret)
    const scope = stringValue(credentials.scope)
    if (refresh) entry.refresh = refresh
    if (expires !== undefined) entry.expires = expires
    if (tokenEndpoint) entry.tokenEndpoint = tokenEndpoint
    if (clientId) entry.clientId = clientId
    if (clientSecret) entry.clientSecret = clientSecret
    if (scope) entry.scope = scope
    this.entries[providerId] = entry
    await this.persist()
  }

  runtimeAuth(): RuntimeProviderAuth[] {
    const auths: RuntimeProviderAuth[] = []
    for (const [providerId, entry] of Object.entries(this.entries)) {
      if (entry.type === 'api') {
        auths.push({ providerId, type: 'api', key: entry.key })
        continue
      }
      if (!entry.access) continue
      auths.push({
        providerId,
        type: 'oauth',
        accessToken: entry.access,
        ...(entry.refresh ? { refreshToken: entry.refresh } : {}),
        ...(entry.expires !== undefined ? { expiresAt: entry.expires } : {})
      })
    }
    return auths
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

  list(): ProviderAuthRecord[] {
    const records: ProviderAuthRecord[] = []
    for (const providerId of Object.keys(this.entries)) {
      const record = this.get(providerId)
      if (record) records.push(record)
    }
    return records
  }

  get(providerId: string): ProviderAuthRecord | null {
    const entry = this.entries[providerId]
    if (entry?.type !== 'oauth' || !entry.access || !entry.tokenEndpoint || !entry.clientId) {
      return null
    }
    return {
      providerId,
      accessToken: entry.access,
      refreshToken: entry.refresh ?? null,
      expiresAt: entry.expires ?? null,
      tokenEndpoint: entry.tokenEndpoint,
      clientId: entry.clientId,
      clientSecret: entry.clientSecret ?? null,
      scope: entry.scope ?? null
    }
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
    const existing = this.entries[record.providerId]
    const entry: OAuthEntry = existing?.type === 'oauth' ? { ...existing } : { type: 'oauth' }
    entry.access = record.accessToken
    if (record.refreshToken) entry.refresh = record.refreshToken
    else delete entry.refresh
    if (record.expiresAt !== null && record.expiresAt !== undefined) {
      entry.expires = record.expiresAt
    } else {
      delete entry.expires
    }
    if (record.scope) entry.scope = record.scope
    else delete entry.scope
    entry.tokenEndpoint = record.tokenEndpoint
    entry.clientId = record.clientId
    if (record.clientSecret) entry.clientSecret = record.clientSecret
    this.entries[record.providerId] = entry
    await this.persist()
  }

  async clearTokens(providerId: string): Promise<void> {
    const entry = this.entries[providerId]
    if (entry?.type !== 'oauth') return
    delete entry.access
    delete entry.refresh
    delete entry.expires
    delete entry.scope
    if (!entry.clientSecret && !entry.tokenEndpoint && !entry.clientId) {
      delete this.entries[providerId]
    }
    await this.persist()
  }

  async remove(providerId: string): Promise<void> {
    if (!this.entries[providerId]) return
    delete this.entries[providerId]
    await this.persist()
  }

  private async migrateLegacy(): Promise<void> {
    const secrets = await readJsonFile<LegacySecrets>(
      path.join(this.userDataPath, 'models', 'secrets.json')
    )
    const tokens = await readJsonFile<LegacyTokens>(
      path.join(this.userDataPath, 'models', 'oauth-tokens.json')
    )
    if (!secrets && !tokens) return
    const config = await readJsonFile<LegacyConfig>(
      path.join(this.userDataPath, 'models', 'config.json')
    )
    const modes = new Map(
      (config?.providers ?? [])
        .filter((provider) => typeof provider.id === 'string')
        .map((provider) => [provider.id as string, provider.authMode])
    )

    const entries: StoredFile = {}
    for (const [providerId, stored] of Object.entries(tokens?.providers ?? {})) {
      if (modes.get(providerId) === 'apiKey') continue
      const plain = typeof stored?.payload === 'string' ? legacyDecrypt(stored.payload) : null
      if (!plain) continue
      try {
        const record = JSON.parse(plain) as Partial<ProviderAuthRecord>
        if (
          typeof record.accessToken !== 'string' ||
          typeof record.tokenEndpoint !== 'string' ||
          typeof record.clientId !== 'string'
        ) {
          continue
        }
        entries[providerId] = {
          type: 'oauth',
          access: record.accessToken,
          ...(typeof record.refreshToken === 'string' && record.refreshToken
            ? { refresh: record.refreshToken }
            : {}),
          ...(typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt)
            ? { expires: record.expiresAt }
            : {}),
          tokenEndpoint: record.tokenEndpoint,
          clientId: record.clientId,
          ...(typeof record.scope === 'string' && record.scope ? { scope: record.scope } : {})
        }
      } catch {
        /* skip corrupt legacy token */
      }
    }

    for (const [key, encrypted] of Object.entries(secrets?.keys ?? {})) {
      const plain = legacyDecrypt(encrypted)
      if (!plain) continue
      if (key.startsWith('oauth:')) {
        const providerId = key.slice('oauth:'.length)
        if (!providerId) continue
        if (modes.get(providerId) === 'apiKey') continue
        const entry = entries[providerId]
        if (entry?.type === 'oauth') entry.clientSecret = plain
        else entries[providerId] = { type: 'oauth', clientSecret: plain }
      } else if (!entries[key]) {
        if (modes.get(key) === 'oauth') continue
        entries[key] = { type: 'api', key: plain }
      }
    }

    if (Object.keys(entries).length === 0) return
    this.entries = entries
    await this.persist()
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.file(), this.entries)
  }
}
