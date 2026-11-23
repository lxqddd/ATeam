import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { McpAuthRecord, McpAuthStatus, McpServerConfig } from '@ateam/shared'
import type { McpAuthStoreLike } from '@ateam/agent-core/integrations'
import { readJsonFile, writeJsonAtomic } from '@ateam/agent-core/storage'

const AUTH_FILE_VERSION = 2

interface StoredTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
}

interface StoredClientInfo {
  clientId?: string
  clientSecret?: string
  tokenEndpoint?: string
  resource?: string
}

interface StoredEntry {
  serverUrl: string
  tokens: StoredTokens
  clientInfo?: StoredClientInfo
  updatedAt: string
}

interface StoredAuthFile {
  version: 2
  servers: Record<string, StoredEntry>
}

interface LegacyEntry {
  serverUrl?: string
  payload?: string
  updatedAt?: string
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseEntry(value: unknown): StoredEntry | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const serverUrl = stringValue(raw.serverUrl)
  const tokens = raw.tokens as Record<string, unknown> | undefined
  const accessToken = tokens ? stringValue(tokens.accessToken) : undefined
  if (!serverUrl || !tokens || !accessToken) return null
  const storedTokens: StoredTokens = { accessToken }
  const refreshToken = stringValue(tokens.refreshToken)
  const expiresAt = tokens.expiresAt
  const scope = stringValue(tokens.scope)
  if (refreshToken) storedTokens.refreshToken = refreshToken
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    storedTokens.expiresAt = expiresAt
  }
  if (scope) storedTokens.scope = scope

  const entry: StoredEntry = {
    serverUrl,
    tokens: storedTokens,
    updatedAt: stringValue(raw.updatedAt) ?? new Date().toISOString()
  }
  if (raw.clientInfo && typeof raw.clientInfo === 'object') {
    const info = raw.clientInfo as Record<string, unknown>
    const clientInfo: StoredClientInfo = {}
    const clientId = stringValue(info.clientId)
    const clientSecret = stringValue(info.clientSecret)
    const tokenEndpoint = stringValue(info.tokenEndpoint)
    const resource = stringValue(info.resource)
    if (clientId) clientInfo.clientId = clientId
    if (clientSecret) clientInfo.clientSecret = clientSecret
    if (tokenEndpoint) clientInfo.tokenEndpoint = tokenEndpoint
    if (resource) clientInfo.resource = resource
    if (Object.keys(clientInfo).length > 0) entry.clientInfo = clientInfo
  }
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

function fromRecord(auth: McpAuthRecord): StoredEntry {
  const tokens: StoredTokens = { accessToken: auth.accessToken }
  if (auth.refreshToken) tokens.refreshToken = auth.refreshToken
  if (auth.expiresAt !== null && auth.expiresAt !== undefined) tokens.expiresAt = auth.expiresAt
  if (auth.scope) tokens.scope = auth.scope
  const clientInfo: StoredClientInfo = {}
  if (auth.clientId) clientInfo.clientId = auth.clientId
  if (auth.clientSecret) clientInfo.clientSecret = auth.clientSecret
  if (auth.tokenEndpoint) clientInfo.tokenEndpoint = auth.tokenEndpoint
  if (auth.resource) clientInfo.resource = auth.resource
  return {
    serverUrl: auth.serverUrl,
    tokens,
    ...(Object.keys(clientInfo).length > 0 ? { clientInfo } : {}),
    updatedAt: new Date().toISOString()
  }
}

function toRecord(serverId: string, entry: StoredEntry): McpAuthRecord {
  return {
    serverId,
    serverUrl: entry.serverUrl,
    accessToken: entry.tokens.accessToken,
    refreshToken: entry.tokens.refreshToken ?? null,
    expiresAt: entry.tokens.expiresAt ?? null,
    tokenEndpoint: entry.clientInfo?.tokenEndpoint ?? null,
    clientId: entry.clientInfo?.clientId ?? null,
    clientSecret: entry.clientInfo?.clientSecret ?? null,
    scope: entry.tokens.scope ?? null,
    resource: entry.clientInfo?.resource ?? null
  }
}

export class McpAuthStore implements McpAuthStoreLike {
  private servers: Record<string, StoredEntry> = {}

  constructor(private readonly userDataPath: string) {}

  private file(): string {
    return path.join(this.userDataPath, 'agent', 'mcp-auth.json')
  }

  async init(): Promise<void> {
    const stored = await readJsonFile<unknown>(this.file())
    if (!stored || typeof stored !== 'object') return
    const raw = stored as Record<string, unknown>
    const servers: Record<string, StoredEntry> = {}
    let migrated = false
    for (const [id, value] of Object.entries((raw.servers as Record<string, unknown>) ?? {})) {
      const entry = parseEntry(value)
      if (entry) {
        servers[id] = entry
        continue
      }
      const legacy = value as LegacyEntry | undefined
      if (!legacy || typeof legacy.payload !== 'string') continue
      const plain = legacyDecrypt(legacy.payload)
      if (!plain) continue
      try {
        const record = JSON.parse(plain) as McpAuthRecord
        if (typeof record.accessToken !== 'string' || typeof record.serverUrl !== 'string') {
          continue
        }
        servers[id] = {
          ...fromRecord({
            ...record,
            serverId: id,
            serverUrl: legacy.serverUrl ?? record.serverUrl
          }),
          updatedAt: legacy.updatedAt ?? new Date().toISOString()
        }
        migrated = true
      } catch {
        /* skip corrupt legacy entry */
      }
    }
    this.servers = servers
    if (migrated) await this.persist()
  }

  list(): McpAuthRecord[] {
    return Object.entries(this.servers).map(([id, entry]) => toRecord(id, entry))
  }

  get(serverId: string, serverUrl?: string): McpAuthRecord | null {
    const entry = this.servers[serverId]
    if (!entry) return null
    if (serverUrl && entry.serverUrl !== serverUrl) return null
    return toRecord(serverId, entry)
  }

  statuses(servers: McpServerConfig[]): McpAuthStatus[] {
    return servers.map((server) => {
      const record = this.get(server.id, server.url ?? undefined)
      return {
        serverId: server.id,
        serverName: server.name,
        authorized: Boolean(record),
        expiresAt:
          record?.expiresAt && Number.isFinite(record.expiresAt)
            ? new Date(record.expiresAt).toISOString()
            : null
      }
    })
  }

  async set(auth: McpAuthRecord): Promise<void> {
    this.servers[auth.serverId] = fromRecord(auth)
    await this.persist()
  }

  async remove(serverId: string): Promise<void> {
    if (!this.servers[serverId]) return
    delete this.servers[serverId]
    await this.persist()
  }

  private async persist(): Promise<void> {
    const file: StoredAuthFile = { version: AUTH_FILE_VERSION, servers: this.servers }
    await fs.mkdir(path.dirname(this.file()), { recursive: true })
    await writeJsonAtomic(this.file(), file)
  }
}
