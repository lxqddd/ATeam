import { createHash } from 'node:crypto'
import { jsonSchema, tool, type JSONSchema7, type ToolSet } from 'ai'
import type {
  McpAuthRecord,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  PermissionAction
} from '@ateam/shared'
import {
  McpClient,
  createHttpTransport,
  createStdioTransport,
  type McpClientLike,
  type McpToolDefinition
} from './mcp-client'
import { McpStore } from './mcp-store'
import { refreshMcpAuthRecord } from './mcp-oauth'

const MAX_OUTPUT = 200_000
const MAX_TOOL_NAME = 64

export interface McpToolContext {
  askPermission: (
    action: PermissionAction,
    resource: string,
    toolName: string,
    toolCallId: string
  ) => Promise<boolean>
  storeOutput?: (toolCallId: string, output: string) => Promise<{ output: string; path?: string }>
}

export interface McpManagerLike {
  tools(context: McpToolContext): Promise<ToolSet>
  servers(): Promise<McpServerConfig[]>
  statuses(options?: { probe?: boolean }): Promise<McpServerStatus[]>
  prompts(): Promise<McpPromptSummary[]>
  resources(): Promise<McpResourceSummary[]>
  getPrompt(server: string, name: string, args?: Record<string, string>): Promise<string>
  readResource(server: string, uri: string): Promise<string>
  addServer(input: McpServerInput): Promise<McpServerConfig>
  updateServer(id: string, input: Partial<McpServerInput>): Promise<McpServerConfig>
  removeServer(id: string): Promise<boolean>
  setMcpAuth(auths: import('@ateam/shared').McpAuthRecord[]): Promise<void>
  setTransientServers(servers: McpServerInput[]): Promise<void>
  dispose(): Promise<void>
}

export interface McpPromptSummary {
  server: string
  name: string
  description?: string
  arguments?: Array<{ name: string; required?: boolean }>
}

export interface McpResourceSummary {
  server: string
  uri: string
  name?: string
  mimeType?: string
}

interface McpManagerOptions {
  userDataPath: string
  workspace: string
  createClient?: (config: McpServerConfig, headers: Record<string, string>) => McpClientLike
  auth?: McpAuthRecord[]
  onAuthUpdated?: (auth: McpAuthRecord) => void
  fetch?: typeof fetch
}

interface Connection {
  client: McpClientLike
  tools: McpToolDefinition[] | null
}

function idleStatus(config: McpServerConfig): McpServerStatus {
  return {
    id: config.id,
    name: config.name,
    state: 'idle',
    toolCount: 0,
    promptCount: 0,
    resourceCount: 0,
    error: null,
    updatedAt: null
  }
}

function sanitizeSegment(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'tool'
}

function uniqueToolName(base: string, used: Set<string>): string {
  const name =
    base.length > MAX_TOOL_NAME
      ? `${base.slice(0, MAX_TOOL_NAME - 9)}_${createHash('sha1').update(base).digest('hex').slice(0, 8)}`
      : base
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  let index = 2
  for (;;) {
    const suffix = `_${index}`
    const candidate = `${name.slice(0, MAX_TOOL_NAME - suffix.length)}${suffix}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
    index += 1
  }
}

function truncateOutput(value: string): string {
  if (value.length <= MAX_OUTPUT) return value
  return `${value.slice(0, MAX_OUTPUT)}\n[output truncated at ${MAX_OUTPUT} characters]`
}

export class McpManager implements McpManagerLike {
  private readonly store: McpStore
  private readonly ready: Promise<void>
  private readonly connections = new Map<string, Connection>()
  private readonly connecting = new Map<string, Promise<Connection | null>>()
  private readonly statusesById = new Map<string, McpServerStatus>()
  private authByServer = new Map<string, McpAuthRecord>()
  private transient: McpServerConfig[] = []
  private transientEpoch = 0
  private disposed = false

  constructor(private readonly options: McpManagerOptions) {
    this.store = new McpStore(options.userDataPath)
    this.authByServer = new Map((options.auth ?? []).map((auth) => [auth.serverId, auth]))
    this.ready = this.store.init()
  }

  private configs(): McpServerConfig[] {
    return [...this.store.list(), ...this.transient]
  }

  async setTransientServers(inputs: McpServerInput[]): Promise<void> {
    await this.ready
    this.transientEpoch += 1
    for (const config of this.transient) {
      const entry = this.connections.get(config.id)
      this.connections.delete(config.id)
      this.connecting.delete(config.id)
      this.statusesById.delete(config.id)
      await entry?.client.close().catch(() => undefined)
    }
    const now = new Date().toISOString()
    this.transient = inputs.map((input) => ({
      id: `transient-${createHash('sha1').update(input.name).digest('hex').slice(0, 8)}`,
      name: input.name,
      type: input.type,
      command: input.command ?? null,
      args: input.args ?? [],
      url: input.url ?? null,
      headers: input.headers ?? {},
      env: input.env ?? {},
      enabled: true,
      createdAt: now,
      updatedAt: now
    }))
  }

  async servers(): Promise<McpServerConfig[]> {
    await this.ready
    return this.configs()
  }

  async statuses(options: { probe?: boolean } = {}): Promise<McpServerStatus[]> {
    await this.ready
    const configs = this.configs()
    if (options.probe) {
      for (const config of configs) {
        if (config.enabled && !this.connections.has(config.id)) {
          await this.connectionFor(config)
        }
      }
    }
    return configs.map((config) => this.statusesById.get(config.id) ?? idleStatus(config))
  }

  async tools(context: McpToolContext): Promise<ToolSet> {
    await this.ready
    if (this.disposed) return {}
    const used = new Set<string>()
    const result: Record<string, unknown> = {}

    for (const config of this.configs()) {
      if (!config.enabled) continue
      const entry = await this.connectionFor(config)
      if (!entry) continue

      if (!entry.tools) {
        try {
          entry.tools = await entry.client.listTools()
          this.setStatus(config, {
            state: 'connected',
            toolCount: entry.tools.length,
            error: null
          })
        } catch (error) {
          this.setStatus(config, { state: 'failed', error: errorMessage(error) })
          this.connections.delete(config.id)
          await entry.client.close().catch(() => undefined)
          continue
        }
      }

      for (const definition of entry.tools) {
        const name = uniqueToolName(
          `mcp_${sanitizeSegment(config.name)}_${sanitizeSegment(definition.name)}`,
          used
        )
        result[name] = this.buildTool(config, entry, definition, name, context)
      }
    }

    return result as ToolSet
  }

  async addServer(input: McpServerInput): Promise<McpServerConfig> {
    await this.ready
    return this.store.add(input)
  }

  async prompts(): Promise<McpPromptSummary[]> {
    await this.ready
    if (this.disposed) return []
    const summaries: McpPromptSummary[] = []
    for (const config of this.configs()) {
      if (!config.enabled) continue
      const entry = await this.connectionFor(config)
      if (!entry) continue
      const prompts = await entry.client.listPrompts().catch(() => [])
      for (const prompt of prompts) {
        summaries.push({
          server: config.name,
          name: prompt.name,
          description: prompt.description,
          ...(prompt.arguments
            ? {
                arguments: prompt.arguments.map((arg) => ({
                  name: arg.name,
                  required: arg.required
                }))
              }
            : {})
        })
      }
    }
    return summaries
  }

  async resources(): Promise<McpResourceSummary[]> {
    await this.ready
    if (this.disposed) return []
    const summaries: McpResourceSummary[] = []
    for (const config of this.configs()) {
      if (!config.enabled) continue
      const entry = await this.connectionFor(config)
      if (!entry) continue
      const resources = await entry.client.listResources().catch(() => [])
      for (const resource of resources) {
        summaries.push({
          server: config.name,
          uri: resource.uri,
          name: resource.name,
          mimeType: resource.mimeType
        })
      }
    }
    return summaries
  }

  async getPrompt(server: string, name: string, args?: Record<string, string>): Promise<string> {
    const { entry } = await this.serverEntry(server)
    return entry.client.getPrompt(name, args)
  }

  async readResource(server: string, uri: string): Promise<string> {
    const { entry } = await this.serverEntry(server)
    const contents = await entry.client.readResource(uri)
    const text = contents
      .map((content) => content.text ?? JSON.stringify(content))
      .filter(Boolean)
      .join('\n\n')
    return text || '(empty resource)'
  }

  private async serverEntry(
    server: string
  ): Promise<{ config: McpServerConfig; entry: Connection }> {
    await this.ready
    const config = this.configs().find(
      (candidate) =>
        candidate.enabled &&
        (candidate.name.toLowerCase() === server.toLowerCase() || candidate.id === server)
    )
    if (!config) throw new Error(`UNKNOWN_MCP_SERVER: ${server}`)
    const entry = await this.connectionFor(config)
    if (!entry) throw new Error(`MCP_SERVER_UNAVAILABLE: ${config.name}`)
    return { config, entry }
  }

  async updateServer(id: string, input: Partial<McpServerInput>): Promise<McpServerConfig> {
    await this.ready
    const updated = await this.store.update(id, input)
    await this.closeConnection(id)
    this.statusesById.delete(id)
    return updated
  }

  async removeServer(id: string): Promise<boolean> {
    await this.ready
    await this.closeConnection(id)
    this.statusesById.delete(id)
    return this.store.remove(id)
  }

  async setMcpAuth(auths: McpAuthRecord[]): Promise<void> {
    await this.ready
    this.authByServer = new Map(auths.map((auth) => [auth.serverId, auth]))
    const affected = new Set([...this.connections.keys(), ...this.connecting.keys()])
    for (const id of affected) {
      await this.closeConnection(id)
      this.statusesById.delete(id)
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all(
      [...this.connections.values()].map((entry) => entry.client.close().catch(() => undefined))
    )
    this.connections.clear()
  }

  private connectionFor(config: McpServerConfig): Promise<Connection | null> {
    const existing = this.connections.get(config.id)
    if (existing) return Promise.resolve(existing)
    const inFlight = this.connecting.get(config.id)
    if (inFlight) return inFlight
    const promise = this.connect(config).finally(() => {
      this.connecting.delete(config.id)
    })
    this.connecting.set(config.id, promise)
    return promise
  }

  private async connect(config: McpServerConfig): Promise<Connection | null> {
    if (this.disposed) return null
    const epoch = config.id.startsWith('transient-') ? this.transientEpoch : null
    const stale = async (entry: Connection | null): Promise<Connection | null> => {
      if (epoch === null || epoch === this.transientEpoch) return entry
      await entry?.client.close().catch(() => undefined)
      this.connections.delete(config.id)
      this.statusesById.delete(config.id)
      return null
    }
    await this.refreshAuthIfNeeded(config.id)
    this.setStatus(config, { state: 'connecting', error: null })
    const client = this.createClient(config)
    try {
      return await stale(await this.establish(config, client))
    } catch (error) {
      await client.close().catch(() => undefined)
      const authFailure = config.type === 'remote' && isAuthFailure(error)
      if (authFailure && (await this.refreshAuth(config.id))) {
        const retry = this.createClient(config)
        try {
          return await stale(await this.establish(config, retry))
        } catch (retryError) {
          await retry.close().catch(() => undefined)
          this.setStatus(config, {
            state: isAuthFailure(retryError) ? 'auth-required' : 'failed',
            toolCount: 0,
            promptCount: 0,
            resourceCount: 0,
            error: errorMessage(retryError)
          })
          return null
        }
      }
      this.setStatus(config, {
        state: authFailure ? 'auth-required' : 'failed',
        toolCount: 0,
        promptCount: 0,
        resourceCount: 0,
        error: errorMessage(error)
      })
      return null
    }
  }

  private async establish(config: McpServerConfig, client: McpClientLike): Promise<Connection> {
    await client.connect()
    const tools = await client.listTools()
    const prompts = await client.listPrompts().catch(() => [])
    const resources = await client.listResources().catch(() => [])
    const entry: Connection = { client, tools }
    this.connections.set(config.id, entry)
    client.onToolsChanged(() => {
      entry.tools = null
    })
    this.setStatus(config, {
      state: 'connected',
      toolCount: tools.length,
      promptCount: prompts.length,
      resourceCount: resources.length,
      error: null
    })
    return entry
  }

  private async refreshAuthIfNeeded(serverId: string): Promise<void> {
    const auth = this.authByServer.get(serverId)
    if (!auth?.expiresAt) return
    if (auth.expiresAt - Date.now() > 60_000) return
    await this.refreshAuth(serverId)
  }

  private async refreshAuth(serverId: string): Promise<boolean> {
    const auth = this.authByServer.get(serverId)
    if (!auth) return false
    try {
      const refreshed = await refreshMcpAuthRecord(auth, this.options.fetch)
      if (!refreshed) return false
      this.authByServer.set(serverId, refreshed)
      this.options.onAuthUpdated?.(refreshed)
      return true
    } catch {
      return false
    }
  }

  private createClient(config: McpServerConfig): McpClientLike {
    const headers = this.authHeaders(config)
    if (this.options.createClient) return this.options.createClient(config, headers)
    const transport =
      config.type === 'local'
        ? createStdioTransport({
            command: config.command ?? '',
            args: config.args,
            cwd: this.options.workspace,
            env: config.env
          })
        : createHttpTransport({ url: config.url ?? '', headers, fetch: this.options.fetch })
    return new McpClient({ name: config.name, transport })
  }

  private authHeaders(config: McpServerConfig): Record<string, string> {
    const auth = this.authByServer.get(config.id)
    if (!auth || auth.serverUrl !== config.url) return config.headers
    return { ...config.headers, Authorization: `Bearer ${auth.accessToken}` }
  }

  private buildTool(
    config: McpServerConfig,
    entry: Connection,
    definition: McpToolDefinition,
    name: string,
    context: McpToolContext
  ): unknown {
    return tool({
      description: definition.description ?? `${config.name} MCP tool: ${definition.name}`,
      inputSchema: jsonSchema(
        (definition.inputSchema ?? { type: 'object', properties: {} }) as JSONSchema7
      ),
      execute: async (input: unknown, options) => {
        const allowed = await context.askPermission(
          'mcp',
          `${config.name}/${definition.name}`,
          name,
          options.toolCallId
        )
        if (!allowed) return 'Permission denied; the MCP tool was not called.'
        try {
          const result = await entry.client.callTool(
            definition.name,
            (input ?? {}) as Record<string, unknown>
          )
          const text = result.content
            .map((part) => (part.type === 'text' ? (part.text ?? '') : JSON.stringify(part)))
            .join('\n')
          const output = result.isError ? `Error: ${text}` : text || '(no output)'
          const stored = await context.storeOutput?.(options.toolCallId, output)
          return stored?.output ?? truncateOutput(output)
        } catch (error) {
          return `Error: ${errorMessage(error)}`
        }
      }
    })
  }

  private setStatus(config: McpServerConfig, patch: Partial<McpServerStatus>): void {
    const base = this.statusesById.get(config.id) ?? idleStatus(config)
    this.statusesById.set(config.id, {
      ...base,
      ...patch,
      id: config.id,
      name: config.name,
      updatedAt: new Date().toISOString()
    })
  }

  private async closeConnection(id: string): Promise<void> {
    const entry = this.connections.get(id)
    if (!entry) return
    this.connections.delete(id)
    await entry.client.close().catch(() => undefined)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAuthFailure(error: unknown): boolean {
  return /^HTTP 401\b|unauthorized|invalid_token|authentication required/i.test(errorMessage(error))
}

export type {
  McpClientLike,
  McpContentBlock,
  McpPromptDefinition,
  McpResourceContent,
  McpResourceDefinition,
  McpToolCallResult,
  McpToolDefinition
} from './mcp-client'
