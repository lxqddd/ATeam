import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { McpServerConfig, McpServerInput, McpServerType } from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '../atomic-json'

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,100}$/
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_NAME_LENGTH = 50
const MAX_URL_LENGTH = 2_000
const MAX_COMMAND_LENGTH = 500
const MAX_ARGS = 100
const MAX_ARG_LENGTH = 2_000
const MAX_MAP_ENTRIES = 100
const MAX_HEADER_VALUE = 4_000
const MAX_ENV_VALUE = 8_000

function mcpFile(userDataPath: string): string {
  return path.join(userDataPath, 'agent', 'mcp.json')
}

function clone(server: McpServerConfig): McpServerConfig {
  return {
    ...server,
    args: [...server.args],
    headers: { ...server.headers },
    env: { ...server.env }
  }
}

function normalizeArgs(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('MCP arguments must be a list of strings')
  if (value.length > MAX_ARGS) throw new Error('Too many MCP arguments')
  const args: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') throw new Error('MCP arguments must be a list of strings')
    if (entry.length > MAX_ARG_LENGTH) throw new Error('MCP argument is too long')
    if (entry.includes('\u0000')) throw new Error('MCP argument contains a null byte')
    args.push(entry)
  }
  return args
}

function normalizeMap(
  value: unknown,
  kind: 'header' | 'environment variable',
  pattern: RegExp,
  maxValue: number
): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`MCP ${kind}s must be a key/value object`)
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_MAP_ENTRIES) throw new Error(`Too many MCP ${kind}s`)
  const result: Record<string, string> = {}
  for (const [key, raw] of entries) {
    if (typeof raw !== 'string') throw new Error(`Invalid ${kind} value for ${key}`)
    const name = key.trim()
    if (!pattern.test(name)) throw new Error(`Invalid ${kind} name: ${key}`)
    if (raw.length > maxValue) throw new Error(`Invalid ${kind} value for ${key}`)
    if (raw.includes('\u0000') || raw.includes('\r') || raw.includes('\n')) {
      throw new Error(`Invalid ${kind} value for ${key}`)
    }
    result[name] = raw
  }
  return result
}

function normalizeOAuthField(
  value: string | null | undefined,
  existing: string | null | undefined,
  maxLength: number
): string | null {
  const raw = value === undefined ? existing : value
  if (raw === undefined || raw === null) return null
  const text = raw.trim()
  if (!text) return null
  if (text.length > maxLength) throw new Error('MCP OAuth value is too long')
  if (text.includes('\u0000') || text.includes('\r') || text.includes('\n')) {
    throw new Error('MCP OAuth value contains invalid characters')
  }
  return text
}

function normalizeOAuthRedirect(
  value: string | null | undefined,
  existing?: string | null
): string | null {
  const raw = value === undefined ? existing : value
  if (raw === undefined || raw === null) return null
  const text = raw.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('MCP OAuth redirect URI is invalid')
  }
  if (url.protocol !== 'http:') throw new Error('MCP OAuth redirect URI must use http')
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) {
    throw new Error('MCP OAuth redirect URI must point to localhost')
  }
  if (text.length > MAX_URL_LENGTH) throw new Error('MCP OAuth redirect URI is too long')
  return text
}

function isHttpUrl(value: string): boolean {
  if (!value || value.length > MAX_URL_LENGTH) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

type NormalizedServer = Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>

function normalizeInput(
  input: Partial<McpServerInput>,
  existing?: McpServerConfig
): NormalizedServer {
  const name = String(input.name ?? existing?.name ?? '').trim()
  if (!name) throw new Error('MCP server name is required')
  if (name.length > MAX_NAME_LENGTH) throw new Error('MCP server name is too long')
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      'MCP server name may only contain letters, numbers, spaces, dots, dashes and underscores'
    )
  }

  const type = (input.type ?? existing?.type ?? 'local') as McpServerType
  if (type !== 'local' && type !== 'remote') {
    throw new Error(`Unsupported MCP server type: ${String(type)}`)
  }

  const enabled = input.enabled ?? existing?.enabled ?? true
  if (typeof enabled !== 'boolean') throw new Error('MCP enabled flag must be a boolean')

  if (type === 'local') {
    const command = String(input.command ?? existing?.command ?? '').trim()
    if (!command) throw new Error('Local MCP servers require a command')
    if (command.length > MAX_COMMAND_LENGTH) throw new Error('MCP command is too long')
    return {
      name,
      type,
      command,
      args: normalizeArgs(input.args ?? existing?.args),
      url: null,
      headers: {},
      env: normalizeMap(
        input.env ?? existing?.env,
        'environment variable',
        ENV_NAME_PATTERN,
        MAX_ENV_VALUE
      ),
      enabled,
      oauthClientId: null,
      oauthScope: null,
      oauthRedirectUri: null
    }
  }

  const url = String(input.url ?? existing?.url ?? '').trim()
  if (!isHttpUrl(url)) throw new Error('Remote MCP servers require an http(s) URL')
  return {
    name,
    type,
    command: null,
    args: [],
    url,
    headers: normalizeMap(
      input.headers ?? existing?.headers,
      'header',
      HEADER_NAME_PATTERN,
      MAX_HEADER_VALUE
    ),
    env: {},
    enabled,
    oauthClientId: normalizeOAuthField(input.oauthClientId, existing?.oauthClientId, 300),
    oauthScope: normalizeOAuthField(input.oauthScope, existing?.oauthScope, 500),
    oauthRedirectUri: normalizeOAuthRedirect(input.oauthRedirectUri, existing?.oauthRedirectUri)
  }
}

function normalizeStored(value: unknown): McpServerConfig | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<McpServerConfig>
  if (typeof raw.id !== 'string' || !raw.id) return null
  try {
    const normalized = normalizeInput(raw as Partial<McpServerInput>)
    const timestamp = new Date().toISOString()
    return {
      id: raw.id,
      ...normalized,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : timestamp,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : timestamp
    }
  } catch {
    return null
  }
}

export async function readMcpServers(userDataPath: string): Promise<McpServerConfig[]> {
  const parsed = await readJsonFile<unknown>(mcpFile(userDataPath))
  const rawServers =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as { servers?: unknown }).servers)
      ? (parsed as { servers: unknown[] }).servers
      : []
  const servers: McpServerConfig[] = []
  const names = new Set<string>()
  for (const entry of rawServers) {
    const server = normalizeStored(entry)
    if (!server) continue
    const key = server.name.toLowerCase()
    if (names.has(key)) continue
    names.add(key)
    servers.push(server)
  }
  return servers
}

export class McpStore {
  private servers: McpServerConfig[] = []

  constructor(private readonly userDataPath: string) {}

  async init(): Promise<void> {
    this.servers = await readMcpServers(this.userDataPath)
  }

  list(): McpServerConfig[] {
    return this.servers.map(clone)
  }

  async add(input: McpServerInput): Promise<McpServerConfig> {
    const normalized = normalizeInput(input)
    this.assertUniqueName(normalized.name)
    const timestamp = new Date().toISOString()
    const server: McpServerConfig = {
      id: randomUUID(),
      ...normalized,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    this.servers.push(server)
    await this.persist()
    return clone(server)
  }

  async update(id: string, input: Partial<McpServerInput>): Promise<McpServerConfig> {
    const index = this.servers.findIndex((server) => server.id === id)
    if (index === -1) throw new Error(`MCP server not found: ${id}`)
    const existing = this.servers[index]
    const normalized = normalizeInput(
      {
        name: input.name ?? existing.name,
        type: input.type ?? existing.type,
        command: input.command !== undefined ? input.command : existing.command,
        args: input.args ?? existing.args,
        url: input.url !== undefined ? input.url : existing.url,
        headers: input.headers ?? existing.headers,
        env: input.env ?? existing.env,
        enabled: input.enabled ?? existing.enabled
      },
      existing
    )
    this.assertUniqueName(normalized.name, id)
    const updated: McpServerConfig = {
      ...existing,
      ...normalized,
      updatedAt: new Date().toISOString()
    }
    this.servers[index] = updated
    await this.persist()
    return clone(updated)
  }

  async remove(id: string): Promise<boolean> {
    const index = this.servers.findIndex((server) => server.id === id)
    if (index === -1) return false
    this.servers.splice(index, 1)
    await this.persist()
    return true
  }

  private assertUniqueName(name: string, ignoreId?: string): void {
    const key = name.toLowerCase()
    const duplicate = this.servers.some(
      (server) => server.id !== ignoreId && server.name.toLowerCase() === key
    )
    if (duplicate) throw new Error(`MCP server name is already used: ${name}`)
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(mcpFile(this.userDataPath)), { recursive: true })
    await writeJsonAtomic(mcpFile(this.userDataPath), { servers: this.servers })
  }
}
