import { createHash } from 'node:crypto'
import { jsonSchema, tool, type JSONSchema7, type ToolSet } from 'ai'
import type {
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
  addServer(input: McpServerInput): Promise<McpServerConfig>
  updateServer(id: string, input: Partial<McpServerInput>): Promise<McpServerConfig>
  removeServer(id: string): Promise<boolean>
  dispose(): Promise<void>
}

interface McpManagerOptions {
  userDataPath: string
  workspace: string
  createClient?: (config: McpServerConfig) => McpClientLike
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
  private disposed = false

  constructor(private readonly options: McpManagerOptions) {
    this.store = new McpStore(options.userDataPath)
    this.ready = this.store.init()
  }

  async servers(): Promise<McpServerConfig[]> {
    await this.ready
    return this.store.list()
  }

  async statuses(options: { probe?: boolean } = {}): Promise<McpServerStatus[]> {
    await this.ready
    const configs = this.store.list()
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

    for (const config of this.store.list()) {
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
    this.setStatus(config, { state: 'connecting', error: null })
    const client = this.createClient(config)
    try {
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
    } catch (error) {
      this.setStatus(config, {
        state: 'failed',
        toolCount: 0,
        promptCount: 0,
        resourceCount: 0,
        error: errorMessage(error)
      })
      await client.close().catch(() => undefined)
      return null
    }
  }

  private createClient(config: McpServerConfig): McpClientLike {
    if (this.options.createClient) return this.options.createClient(config)
    const transport =
      config.type === 'local'
        ? createStdioTransport({
            command: config.command ?? '',
            args: config.args,
            cwd: this.options.workspace,
            env: config.env
          })
        : createHttpTransport({ url: config.url ?? '', headers: config.headers })
    return new McpClient({ name: config.name, transport })
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

export type {
  McpClientLike,
  McpContentBlock,
  McpPromptDefinition,
  McpResourceContent,
  McpResourceDefinition,
  McpToolCallResult,
  McpToolDefinition
} from './mcp-client'
