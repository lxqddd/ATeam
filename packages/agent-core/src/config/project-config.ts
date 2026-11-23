import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentConfig,
  AgentReference,
  McpServerInput,
  PermissionEffect,
  PermissionRuleAction,
  PermissionRuleInput
} from '@ateam/shared'

export interface ProjectConfig {
  snapshots?: boolean
  lsp?: boolean
  formatters?: boolean
  instructions?: string[]
  references?: AgentReference[]
  formatterOverrides?: Record<string, string>
  permissions?: PermissionRuleInput[]
  mcp?: McpServerInput[]
  agents?: unknown[]
  providers?: unknown[]
  plugins?: string[]
}

const CONFIG_NAMES = ['ateam.json', 'ateam.jsonc'] as const
const RULE_ACTIONS: readonly PermissionRuleAction[] = [
  'read',
  'list',
  'glob',
  'grep',
  'write',
  'edit',
  'shell',
  'external_directory',
  'mcp',
  'webfetch',
  'websearch',
  'skill',
  'subagent',
  '*'
]
const RULE_EFFECTS: readonly PermissionEffect[] = ['allow', 'ask', 'deny']

function stripJsonComments(input: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    const next = input[index + 1]
    if (inString) {
      result += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      result += character
      continue
    }
    if (character === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') index += 1
      result += '\n'
      continue
    }
    if (character === '/' && next === '*') {
      index += 2
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) index += 1
      index += 1
      continue
    }
    result += character
  }
  return result.replace(/,\s*([}\]])/g, '$1')
}

export function parseProjectConfigContent(content: string): ProjectConfig {
  let raw: unknown
  try {
    raw = JSON.parse(stripJsonComments(content))
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const value = raw as Record<string, unknown>
  const config: ProjectConfig = {}
  if (typeof value.snapshots === 'boolean') config.snapshots = value.snapshots
  if (typeof value.lsp === 'boolean') config.lsp = value.lsp
  if (typeof value.formatters === 'boolean') config.formatters = value.formatters
  if (Array.isArray(value.instructions)) {
    const instructions = [
      ...new Set(
        value.instructions
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    ]
    if (instructions.length > 0) config.instructions = instructions
  }
  if (value.formatterOverrides && typeof value.formatterOverrides === 'object') {
    const overrides: Record<string, string> = {}
    for (const [key, entry] of Object.entries(
      value.formatterOverrides as Record<string, unknown>
    )) {
      if (typeof entry !== 'string') continue
      const extension = key.startsWith('.') ? key.toLowerCase() : `.${key.toLowerCase()}`
      if (!/^\.[a-z0-9+]{1,15}$/.test(extension)) continue
      const formatter = entry.trim().toLowerCase()
      if (formatter !== 'none' && !/^[a-z0-9_-]{1,40}$/.test(formatter)) continue
      overrides[extension] = formatter
    }
    if (Object.keys(overrides).length > 0) config.formatterOverrides = overrides
  }
  if (Array.isArray(value.references)) {
    const references = value.references.filter(
      (entry): entry is AgentReference =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as AgentReference).alias === 'string' &&
        (typeof (entry as AgentReference).path === 'string') !==
          (typeof (entry as AgentReference).repository === 'string')
    )
    if (references.length > 0) config.references = references
  }
  if (Array.isArray(value.permissions)) {
    const permissions: PermissionRuleInput[] = []
    for (const entry of value.permissions) {
      if (!entry || typeof entry !== 'object') continue
      const rule = entry as Record<string, unknown>
      if (
        typeof rule.action !== 'string' ||
        !RULE_ACTIONS.includes(rule.action as PermissionRuleAction) ||
        typeof rule.resource !== 'string' ||
        !rule.resource.trim() ||
        typeof rule.effect !== 'string' ||
        !RULE_EFFECTS.includes(rule.effect as PermissionEffect)
      ) {
        continue
      }
      permissions.push({
        action: rule.action as PermissionRuleAction,
        resource: rule.resource.trim(),
        effect: rule.effect as PermissionEffect,
        sessionId: null
      })
    }
    if (permissions.length > 0) config.permissions = permissions
  }
  if (Array.isArray(value.mcp)) {
    const servers: McpServerInput[] = []
    for (const entry of value.mcp) {
      if (!entry || typeof entry !== 'object') continue
      const server = entry as Record<string, unknown>
      if (typeof server.name !== 'string' || !server.name.trim()) continue
      const type = server.type === 'remote' ? 'remote' : server.type === 'local' ? 'local' : null
      if (!type) continue
      if (type === 'local' && typeof server.command !== 'string') continue
      if (type === 'remote' && typeof server.url !== 'string') continue
      const strings = (input: unknown): string[] =>
        Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []
      const record = (input: unknown): Record<string, string> => {
        if (!input || typeof input !== 'object') return {}
        return Object.fromEntries(
          Object.entries(input as Record<string, unknown>).filter(
            (item): item is [string, string] => typeof item[1] === 'string'
          )
        )
      }
      servers.push({
        name: server.name.trim(),
        type,
        ...(typeof server.command === 'string' ? { command: server.command } : {}),
        ...(strings(server.args).length > 0 ? { args: strings(server.args) } : {}),
        ...(typeof server.url === 'string' ? { url: server.url } : {}),
        ...(Object.keys(record(server.headers)).length > 0
          ? { headers: record(server.headers) }
          : {}),
        ...(Object.keys(record(server.env)).length > 0 ? { env: record(server.env) } : {}),
        ...(typeof server.enabled === 'boolean' ? { enabled: server.enabled } : {})
      })
    }
    if (servers.length > 0) config.mcp = servers
  }
  if (Array.isArray(value.agents)) config.agents = value.agents
  if (Array.isArray(value.providers)) config.providers = value.providers
  if (Array.isArray(value.plugins)) {
    const plugins = value.plugins.filter((entry): entry is string => typeof entry === 'string')
    if (plugins.length > 0) config.plugins = plugins
  }
  return config
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function projectRoot(workspacePath: string): Promise<string> {
  let directory = path.resolve(workspacePath)
  for (;;) {
    try {
      const stat = await fs.stat(path.join(directory, '.git'))
      if (stat.isDirectory() || stat.isFile()) return directory
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(directory)
    if (parent === directory) return path.resolve(workspacePath)
    directory = parent
  }
}

export async function findProjectConfig(workspacePath: string): Promise<string | null> {
  const root = await projectRoot(workspacePath)
  for (const name of CONFIG_NAMES) {
    const file = path.join(root, name)
    if (await fileExists(file)) return file
  }
  return null
}

export async function readProjectConfig(workspacePath: string): Promise<ProjectConfig> {
  const file = await findProjectConfig(workspacePath)
  if (!file) return {}
  try {
    return parseProjectConfigContent(await fs.readFile(file, 'utf8'))
  } catch {
    return {}
  }
}

export function mergeAgentConfig(base: AgentConfig, project: ProjectConfig): AgentConfig {
  const instructions = [...new Set([...base.instructions, ...(project.instructions ?? [])])]
  const references = new Map<string, AgentReference>()
  for (const reference of base.references ?? []) references.set(reference.alias, reference)
  for (const reference of project.references ?? []) references.set(reference.alias, reference)
  const permissionRules = [...(base.permissionRules ?? []), ...(project.permissions ?? [])]
  const mcpServers = [...(base.mcpServers ?? []), ...(project.mcp ?? [])]
  return {
    snapshots: project.snapshots ?? base.snapshots,
    lsp: project.lsp ?? base.lsp,
    formatters: project.formatters ?? base.formatters,
    instructions,
    formatterOverrides: { ...base.formatterOverrides, ...(project.formatterOverrides ?? {}) },
    ...(references.size > 0 ? { references: [...references.values()] } : {}),
    ...(permissionRules.length > 0 ? { permissionRules } : {}),
    ...(mcpServers.length > 0 ? { mcpServers } : {}),
    ...(project.agents ? { agents: project.agents } : base.agents ? { agents: base.agents } : {}),
    ...(project.providers
      ? { providers: project.providers }
      : base.providers
        ? { providers: base.providers }
        : {}),
    ...(project.plugins
      ? { plugins: project.plugins }
      : base.plugins
        ? { plugins: base.plugins }
        : {})
  }
}
