import path from 'node:path'
import type {
  AgentConfig,
  McpAuthRecord,
  McpServerConfig,
  McpServerInput,
  McpServerStatus,
  RuntimeWebSearchConfig,
  EffectiveAgentConfig,
  SkillDefinition,
  WebFetchFormat
} from '@ateam/shared'
import {
  discoverFormatters,
  formatFile,
  type FormatterDefinition
} from '../integrations/formatters'
import { formatDiagnosticReport, LspManager, resolveLspServers } from '../integrations/lsp'
import type { McpManagerLike } from '../integrations/mcp'
import { formatWebFetchResult } from '../integrations/webfetch'
import { formatSearchResults } from '../integrations/websearch'
import { loadPlugins, PluginRegistry } from '../plugins'
import { PluginStore } from '../plugin-store'
import { loadSkills } from '../skills'
import { errorMessage } from './messages'
import type { AgentRuntimeDependencies } from './types'

export interface WorkspaceServicesHost {
  readonly userDataPath: string
  readonly defaultWorkspacePath: string
  readonly appVersion: string
  readonly createMcpManager: AgentRuntimeDependencies['createMcpManager']
  readonly fetchWeb: AgentRuntimeDependencies['fetchWeb']
  readonly searchWeb: AgentRuntimeDependencies['searchWeb']
  readonly onMcpAuth?: (auth: McpAuthRecord) => void
  workspaceInUse(workspace: string): boolean
}

export interface WorkspaceServicesState {
  mcpAuth?: McpAuthRecord[]
  webSearch?: RuntimeWebSearchConfig | null
}

export class WorkspaceServices {
  private readonly lspManagers = new Map<string, LspManager>()
  private readonly formatterCaches = new Map<string, Promise<FormatterDefinition[]>>()
  private readonly skillCaches = new Map<string, Promise<SkillDefinition[]>>()
  private readonly pluginCaches = new Map<string, Promise<PluginRegistry>>()
  private readonly pluginStore: PluginStore
  private readonly mcpManagers = new Map<string, McpManagerLike>()
  private readonly configs = new Map<string, EffectiveAgentConfig>()
  private readonly fingerprints = new Map<string, string>()
  private mcpAuth: McpAuthRecord[]
  private webSearchConfig: RuntimeWebSearchConfig | null

  constructor(
    private readonly host: WorkspaceServicesHost,
    state: WorkspaceServicesState = {}
  ) {
    this.mcpAuth = state.mcpAuth ?? []
    this.webSearchConfig = state.webSearch ?? null
    this.pluginStore = new PluginStore(host.userDataPath)
  }

  async applyConfig(workspace: string, effective: EffectiveAgentConfig): Promise<void> {
    const fingerprint = JSON.stringify(effective.config)
    const previous = this.fingerprints.get(workspace)
    this.configs.set(workspace, effective)
    this.fingerprints.set(workspace, fingerprint)
    if (previous === fingerprint) {
      const manager = this.mcpManagers.get(workspace)
      await manager?.setProjectServers?.(effective.projectMcpServers ?? [])
      return
    }
    this.skillCaches.delete(workspace)
    this.formatterCaches.delete(workspace)
    for (const key of this.pluginCaches.keys()) {
      if (!key.startsWith(`${workspace}\u0000`)) continue
      const registry = this.pluginCaches.get(key)
      this.pluginCaches.delete(key)
      void registry?.then((value) => value.dispose()).catch(() => undefined)
    }
    const lsp = this.lspManagers.get(workspace)
    this.lspManagers.delete(workspace)
    await lsp?.dispose().catch(() => undefined)
    const servers = effective.projectMcpServers ?? []
    const manager = this.mcpManagers.get(workspace)
    if (manager) await manager.setProjectServers?.(servers)
    else if (servers.length > 0) await this.mcp(workspace).setProjectServers?.(servers)
  }

  async dispose(): Promise<void> {
    const lspManagers = [...this.lspManagers.values()]
    this.lspManagers.clear()
    for (const manager of lspManagers) {
      await manager.dispose()
    }
    const mcpManagers = [...new Set(this.mcpManagers.values())]
    this.mcpManagers.clear()
    this.configs.clear()
    this.fingerprints.clear()
    for (const manager of mcpManagers) {
      await manager.dispose()
    }
    const pluginRegistries = [...new Set(this.pluginCaches.values())]
    this.pluginCaches.clear()
    for (const registry of pluginRegistries) {
      await registry.then((value) => value.dispose()).catch(() => undefined)
    }
  }

  skillsFor(workspace: string): Promise<SkillDefinition[]> {
    let cached = this.skillCaches.get(workspace)
    if (!cached) {
      cached = loadSkills({
        userDataPath: this.host.userDataPath,
        workspacePath: workspace,
        config: this.configs.get(workspace)?.config
      }).catch(() => [])
      this.skillCaches.set(workspace, cached)
    }
    return cached
  }

  async plugins(config: AgentConfig, workspace: string): Promise<PluginRegistry> {
    const installed = await this.pluginStore.enabledSpecs()
    const specs = [...new Set([...(config.plugins ?? []), ...installed])]
    if (specs.length === 0) return new PluginRegistry()
    const key = `${workspace}\u0000${specs.join('\u0000')}`
    let cached = this.pluginCaches.get(key)
    if (!cached) {
      cached = loadPlugins(specs, { workspace, config })
      this.pluginCaches.set(key, cached)
    }
    return cached
  }

  mcp(workspace?: string): McpManagerLike {
    const target = workspace ?? this.host.defaultWorkspacePath
    let manager = this.mcpManagers.get(target)
    if (!manager) {
      manager = this.host.createMcpManager({
        userDataPath: this.host.userDataPath,
        workspacePath: target,
        mcpAuth: this.mcpAuth,
        onMcpAuth: (auth) => this.host.onMcpAuth?.(auth),
        projectServers: this.configs.get(target)?.projectMcpServers ?? []
      })
      this.mcpManagers.set(target, manager)
    }
    return manager
  }

  async setTransientMcpServers(
    servers: import('@ateam/shared').McpServerInput[],
    workspace?: string
  ): Promise<void> {
    await this.mcp(workspace).setTransientServers(servers)
  }

  async setMcpAuth(auths: McpAuthRecord[]): Promise<void> {
    this.mcpAuth = auths
    await Promise.all(
      [...new Set(this.mcpManagers.values())].map((manager) => manager.setMcpAuth(auths))
    )
  }

  listMcpServers(workspace?: string): Promise<McpServerConfig[]> {
    return this.mcp(workspace).servers()
  }

  mcpStatuses(options?: { probe?: boolean }, workspace?: string): Promise<McpServerStatus[]> {
    return this.mcp(workspace).statuses(options)
  }

  async addMcpServer(input: McpServerInput): Promise<McpServerConfig> {
    const server = await this.mcp().addServer(input)
    await this.resetWorkspaceMcpManagers()
    return server
  }

  async updateMcpServer(id: string, input: Partial<McpServerInput>): Promise<McpServerConfig> {
    const server = await this.mcp().updateServer(id, input)
    await this.resetWorkspaceMcpManagers()
    return server
  }

  async removeMcpServer(id: string): Promise<boolean> {
    const removed = await this.mcp().removeServer(id)
    await this.resetWorkspaceMcpManagers()
    return removed
  }

  setWebSearch(config: RuntimeWebSearchConfig | null): void {
    this.webSearchConfig = config
  }

  async releaseWorkspace(workspace: string): Promise<void> {
    if (path.resolve(workspace) === path.resolve(this.host.defaultWorkspacePath)) return
    if (this.host.workspaceInUse(workspace)) return
    const manager = this.lspManagers.get(workspace)
    this.lspManagers.delete(workspace)
    this.formatterCaches.delete(workspace)
    this.skillCaches.delete(workspace)
    await manager?.dispose().catch(() => undefined)
    const mcp = this.mcpManagers.get(workspace)
    this.mcpManagers.delete(workspace)
    this.configs.delete(workspace)
    this.fingerprints.delete(workspace)
    await mcp?.dispose().catch(() => undefined)
  }

  async formatFiles(
    workspace: string,
    files: string[],
    overrides: Record<string, string> = {}
  ): Promise<string> {
    const formatters = await this.formatters(workspace)
    const notes: string[] = []
    for (const file of files) {
      const result = await formatFile(file, formatters, workspace, { overrides })
      const relative = path.relative(workspace, file).split(path.sep).join('/')
      if (result.formatted) {
        notes.push(`Formatted ${relative} with ${result.formatter}`)
      } else if (result.error) {
        notes.push(`Formatter failed for ${relative}: ${result.error}`)
      }
    }
    return notes.join('\n')
  }

  async lspHover(
    workspace: string,
    file: string,
    line: number,
    character: number
  ): Promise<string> {
    return this.lsp(workspace).hover(file, line, character)
  }

  async lspDefinition(
    workspace: string,
    file: string,
    line: number,
    character: number
  ): Promise<string> {
    return this.lsp(workspace).definition(file, line, character)
  }

  async diagnoseFiles(workspace: string, files: string[]): Promise<string> {
    try {
      return formatDiagnosticReport(await this.lsp(workspace).diagnostics(files), workspace)
    } catch {
      return ''
    }
  }

  async fetchWebPage(input: {
    url: string
    format: WebFetchFormat
    timeoutMs?: number
  }): Promise<string> {
    try {
      return formatWebFetchResult(await this.host.fetchWeb(input))
    } catch (error) {
      return `Error: ${errorMessage(error)}`
    }
  }

  async searchTheWeb(input: { query: string; count: number }): Promise<string> {
    if (!this.webSearchConfig) {
      return 'Error: web search is not configured. Add a provider in Settings → Web search.'
    }
    try {
      const results = await this.host.searchWeb(this.webSearchConfig, input)
      return formatSearchResults(input.query, this.webSearchConfig.provider, results)
    } catch (error) {
      return `Error: ${errorMessage(error)}`
    }
  }

  async listMcpPrompts(server?: string, workspace?: string): Promise<string> {
    try {
      const prompts = await this.mcp(workspace).prompts()
      const filtered = server
        ? prompts.filter((prompt) => prompt.server.toLowerCase() === server.toLowerCase())
        : prompts
      if (filtered.length === 0) return 'No MCP prompts available.'
      return [
        'MCP prompts:',
        ...filtered.map(
          (prompt) =>
            `- ${prompt.server}/${prompt.name}${prompt.description ? `: ${prompt.description}` : ''}`
        )
      ].join('\n')
    } catch (error) {
      return `Error: ${errorMessage(error)}`
    }
  }

  async getMcpPrompt(
    server: string,
    prompt: string,
    args?: Record<string, string>,
    workspace?: string
  ): Promise<string> {
    try {
      return await this.mcp(workspace).getPrompt(server, prompt, args)
    } catch (error) {
      return this.mcpError(error, server)
    }
  }

  async listMcpResources(server?: string, workspace?: string): Promise<string> {
    try {
      const resources = await this.mcp(workspace).resources()
      const filtered = server
        ? resources.filter((resource) => resource.server.toLowerCase() === server.toLowerCase())
        : resources
      if (filtered.length === 0) return 'No MCP resources available.'
      return [
        'MCP resources:',
        ...filtered.map((resource) => {
          const details = [resource.name, resource.mimeType].filter(Boolean).join(', ')
          return `- ${resource.server}: ${resource.uri}${details ? ` (${details})` : ''}`
        })
      ].join('\n')
    } catch (error) {
      return `Error: ${errorMessage(error)}`
    }
  }

  async readMcpResource(server: string, uri: string, workspace?: string): Promise<string> {
    try {
      return await this.mcp(workspace).readResource(server, uri)
    } catch (error) {
      return this.mcpError(error, server)
    }
  }

  private lsp(workspace: string): LspManager {
    let manager = this.lspManagers.get(workspace)
    if (!manager) {
      manager = new LspManager({
        workspace,
        servers: resolveLspServers(this.configs.get(workspace)?.config)
      })
      this.lspManagers.set(workspace, manager)
    }
    return manager
  }

  private formatters(workspace: string): Promise<FormatterDefinition[]> {
    let cached = this.formatterCaches.get(workspace)
    if (!cached) {
      cached = discoverFormatters(workspace, this.configs.get(workspace)?.config).catch(() => [])
      this.formatterCaches.set(workspace, cached)
    }
    return cached
  }

  private async resetWorkspaceMcpManagers(): Promise<void> {
    for (const [workspace, manager] of this.mcpManagers) {
      if (path.resolve(workspace) === path.resolve(this.host.defaultWorkspacePath)) continue
      this.mcpManagers.delete(workspace)
      await manager.dispose().catch(() => undefined)
    }
  }

  private mcpError(error: unknown, server: string): string {
    const message = errorMessage(error)
    return message.includes('UNKNOWN_MCP_SERVER')
      ? `Error: unknown MCP server: ${server}`
      : `Error: ${message}`
  }
}
