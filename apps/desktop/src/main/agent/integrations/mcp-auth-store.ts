import fs from 'node:fs/promises'
import path from 'node:path'
import { safeStorage } from 'electron'
import type { McpAuthRecord, McpAuthStatus, McpServerConfig } from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '../atomic-json'

const AUTH_FILE_VERSION = 1

interface StoredEntry {
  serverUrl: string
  payload: string
  updatedAt: string
}

interface StoredAuthFile {
  version: 1
  servers: Record<string, StoredEntry>
}

export interface McpAuthStoreLike {
  list(): McpAuthRecord[]
  get(serverId: string, serverUrl?: string): McpAuthRecord | null
  set(auth: McpAuthRecord): Promise<void>
  remove(serverId: string): Promise<void>
}

function isAuthRecord(value: unknown): value is McpAuthRecord {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw.serverId === 'string' &&
    typeof raw.serverUrl === 'string' &&
    typeof raw.accessToken === 'string' &&
    raw.accessToken.length > 0
  )
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
    const raw = stored as Partial<StoredAuthFile>
    const servers: Record<string, StoredEntry> = {}
    for (const [id, entry] of Object.entries(raw.servers ?? {})) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = entry as Partial<StoredEntry>
      if (
        typeof candidate.serverUrl !== 'string' ||
        typeof candidate.payload !== 'string' ||
        typeof candidate.updatedAt !== 'string'
      ) {
        continue
      }
      servers[id] = {
        serverUrl: candidate.serverUrl,
        payload: candidate.payload,
        updatedAt: candidate.updatedAt
      }
    }
    this.servers = servers
  }

  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  list(): McpAuthRecord[] {
    const records: McpAuthRecord[] = []
    for (const [id, entry] of Object.entries(this.servers)) {
      const record = this.decrypt(id, entry)
      if (record) records.push(record)
    }
    return records
  }

  get(serverId: string, serverUrl?: string): McpAuthRecord | null {
    const entry = this.servers[serverId]
    if (!entry) return null
    if (serverUrl && entry.serverUrl !== serverUrl) return null
    return this.decrypt(serverId, entry)
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
    if (!this.isEncryptionAvailable()) throw new Error('ENCRYPTION_UNAVAILABLE')
    const payload = safeStorage.encryptString(JSON.stringify(auth)).toString('base64')
    this.servers[auth.serverId] = {
      serverUrl: auth.serverUrl,
      payload,
      updatedAt: new Date().toISOString()
    }
    await this.persist()
  }

  async remove(serverId: string): Promise<void> {
    if (!this.servers[serverId]) return
    delete this.servers[serverId]
    await this.persist()
  }

  private decrypt(serverId: string, entry: StoredEntry): McpAuthRecord | null {
    if (!this.isEncryptionAvailable()) return null
    try {
      const plain = safeStorage.decryptString(Buffer.from(entry.payload, 'base64'))
      const parsed = JSON.parse(plain) as unknown
      if (!isAuthRecord(parsed)) return null
      return { ...parsed, serverId, serverUrl: entry.serverUrl }
    } catch {
      return null
    }
  }

  private async persist(): Promise<void> {
    const file: StoredAuthFile = { version: AUTH_FILE_VERSION, servers: this.servers }
    await fs.mkdir(path.dirname(this.file()), { recursive: true })
    await writeJsonAtomic(this.file(), file)
  }
}
