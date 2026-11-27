import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentMode,
  McpServerConfig,
  PermissionEffect,
  PermissionRuleAction,
  ProviderAuthMode,
  ProviderPublic,
  ProviderType,
  ResourceMcpServer
} from '@ateam/shared'
import { agentIdFor, parseAgentMarkdown } from '@ateam/agent-core/config'
import { JsonProviderAuthStore, ModelConfigStore } from '@ateam/agent-core'
import { McpStore } from '@ateam/agent-core/integrations'
import { sanitizeMcpServers, sanitizeUrl } from '../server/resources'
import { createCliIo, type CliIo } from './io'

/** Configuration command groups handled before the agent runtime starts. */
export const CONFIG_COMMAND_GROUPS = ['providers', 'mcp', 'agent'] as const

export type ConfigCommandGroup = (typeof CONFIG_COMMAND_GROUPS)[number]

const ACTIONS: Record<ConfigCommandGroup, readonly ConfigAction[]> = {
  providers: ['list', 'add', 'remove'],
  mcp: ['list', 'enable', 'disable'],
  agent: ['create']
}

export type ConfigAction = 'list' | 'add' | 'remove' | 'enable' | 'disable' | 'create'

const PROVIDER_TYPES: readonly ProviderType[] = [
  'anthropic',
  'openai',
  'google',
  'openai-compatible'
]
const AGENT_MODES: readonly AgentMode[] = ['primary', 'subagent', 'all']
const PERMISSION_ACTIONS: readonly PermissionRuleAction[] = [
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
  'lsp',
  'skill',
  'subagent',
  'plugin',
  '*'
]
const PERMISSION_EFFECTS: readonly PermissionEffect[] = ['allow', 'ask', 'deny']

export interface ConfigCommandOptions {
  group: ConfigCommandGroup
  action: ConfigAction
  userData: string
  json: boolean
  help: boolean
  name: string | null
  providerType: ProviderType
  baseURL: string | null
  apiKey: string | null
  ref: string | null
  description: string | null
  mode: AgentMode
  model: string | null
  tools: string[] | null
  permission: string | null
  steps: number | null
  temperature: number | null
  prompt: string | null
  force: boolean
}

/** A failure whose exit code is part of the CLI contract. */
class ConfigCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number
  ) {
    super(message)
  }
}

function commandIndex(argv: string[]): number {
  // pnpm forwards its own separator as the first argument.
  return argv[0] === '--' ? 1 : 0
}

/** Returns the configuration command group at the front of `argv`, if any. */
export function configCommandOf(argv: string[]): ConfigCommandGroup | null {
  const candidate = argv[commandIndex(argv)]
  return (CONFIG_COMMAND_GROUPS as readonly string[]).includes(candidate)
    ? (candidate as ConfigCommandGroup)
    : null
}

/**
 * Default ATeam user data directory shared with the desktop app.
 * `ATEAM_USER_DATA` overrides the platform location.
 */
export function defaultUserDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = os.homedir()
): string {
  const override = env.ATEAM_USER_DATA?.trim()
  if (override) return path.resolve(override)
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'ATeam')
  }
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming')
    return path.join(appData, 'ATeam')
  }
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config')
  return path.join(configHome, 'ATeam')
}

function takeValue(argv: string[], index: number, flag: string): [string, number] {
  const next = argv[index + 1]
  if (next === undefined || next.startsWith('--')) throw new Error(`${flag} requires a value`)
  return [next, index + 1]
}

function parseEnum<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${flag} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

function parseSteps(value: string): number {
  const steps = Number(value)
  if (!Number.isInteger(steps) || steps < 1 || steps > 100) {
    throw new Error('--steps must be an integer between 1 and 100')
  }
  return steps
}

function parseTemperature(value: string): number {
  const temperature = Number(value)
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('--temperature must be a number between 0 and 2')
  }
  return temperature
}

function parseTools(value: string): string[] | null {
  const tools = value
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean)
  if (tools.length === 0 || tools.includes('*')) return null
  return tools
}

function validatePermissionSpec(value: string): string {
  for (const entry of value.split(',')) {
    const parts = entry.split('|')
    if (parts.length !== 3 || parts.some((part) => !part.trim())) {
      throw new Error(`--permission entries must look like action|resource|effect: ${entry.trim()}`)
    }
    const [action, , effect] = parts.map((part) => part.trim())
    if (!PERMISSION_ACTIONS.includes(action as PermissionRuleAction)) {
      throw new Error(`--permission action must be one of: ${PERMISSION_ACTIONS.join(', ')}`)
    }
    if (!PERMISSION_EFFECTS.includes(effect as PermissionEffect)) {
      throw new Error(`--permission effect must be one of: ${PERMISSION_EFFECTS.join(', ')}`)
    }
  }
  return value.trim()
}

function validateModelRef(value: string): string {
  const model = value.trim()
  const separator = model.indexOf('/')
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error('--model must look like provider/model or provider/model#variant')
  }
  return model
}

/**
 * Parses `ateam providers|mcp|agent ...`.
 *
 * Values may be inline (`--type=openai`) or the following argument. Positional
 * arguments name the provider/server to update or the agent to create.
 */
export function parseConfigArgs(
  argv: string[],
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = os.homedir()
): ConfigCommandOptions {
  const group = configCommandOf(argv)
  if (!group) throw new Error('Unknown configuration command')
  const tokens = argv.slice(commandIndex(argv) + 1)

  const options: ConfigCommandOptions = {
    group,
    action: 'list',
    userData: defaultUserDataDir(env, platform, home),
    json: false,
    help: false,
    name: null,
    providerType: 'anthropic',
    baseURL: null,
    apiKey: null,
    ref: null,
    description: null,
    mode: 'subagent',
    model: null,
    tools: null,
    permission: null,
    steps: null,
    temperature: null,
    prompt: null,
    force: false
  }

  const positional: string[] = []
  let optionsEnded = false
  let index = 0
  if (tokens.length > 0 && !tokens[0].startsWith('-')) {
    const candidate = tokens[0]
    if (!(ACTIONS[group] as readonly string[]).includes(candidate)) {
      throw new Error(`Unknown ${group} action: ${candidate}`)
    }
    options.action = candidate as ConfigAction
    index = 1
  } else if (group === 'agent') {
    // `agent` without an action shows the create help.
    options.action = 'create'
    options.help = true
  }

  for (; index < tokens.length; index += 1) {
    const argument = tokens[index]
    if (optionsEnded) {
      positional.push(argument)
      continue
    }
    if (argument === '--') {
      optionsEnded = true
      continue
    }
    if (!argument.startsWith('--') && argument !== '-h') {
      positional.push(argument)
      continue
    }
    const [flag, inline] = argument.includes('=')
      ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)]
      : [argument, null]
    const value = (): string => {
      if (inline !== null) return inline
      const [next, consumed] = takeValue(tokens, index, flag)
      index = consumed
      return next
    }
    switch (flag) {
      case '--user-data':
        options.userData = path.resolve(cwd, value())
        break
      case '--json':
        options.json = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      case '--name':
        if (options.group !== 'providers' || options.action !== 'add') {
          throw new Error(`${flag} is only valid for providers add`)
        }
        options.name = value()
        break
      case '--type':
        if (options.group !== 'providers' || options.action !== 'add') {
          throw new Error(`${flag} is only valid for providers add`)
        }
        options.providerType = parseEnum(value(), PROVIDER_TYPES, flag)
        break
      case '--base-url':
        if (options.group !== 'providers' || options.action !== 'add') {
          throw new Error(`${flag} is only valid for providers add`)
        }
        options.baseURL = value()
        break
      case '--api-key':
        if (options.group !== 'providers' || options.action !== 'add') {
          throw new Error(`${flag} is only valid for providers add`)
        }
        options.apiKey = value()
        break
      case '--description':
        if (options.group !== 'agent' || options.action !== 'create') {
          throw new Error(`${flag} is only valid for agent create`)
        }
        options.description = value()
        break
      case '--mode':
        if (options.group !== 'agent' || options.action !== 'create') {
          throw new Error(`${flag} is only valid for agent create`)
        }
        options.mode = parseEnum(value(), AGENT_MODES, flag)
        break
      case '--model':
        if (options.group !== 'agent' || options.action !== 'create') {
          throw new Error(`${flag} is only valid for agent create`)
        }
        options.model = validateModelRef(value())
        break
      case '--tools':
        if (options.group !== 'agent' || options.action !== 'create') {
          throw new Error(`${flag} is only valid for agent create`)
        }
        options.tools = parseTools(value())
        break
      case '--permission':
        if (options.group !== 'agent' || options.action !== 'create') {
          throw new Error(`${flag} is only valid for agent create`)
        }
        options.permission = validatePermissionSpec(value())
        break
      case '--steps':
        if (options.group !== 'agent' || options.action !== 'create') {
          throw new Error(`${flag} is only valid for agent create`)
        }
        options.steps = parseSteps(value())
        break
      case '--temperature':
        if (options.group !== 'agent' || options.action !== 'create') {
          throw new Error(`${flag} is only valid for agent create`)
        }
        options.temperature = parseTemperature(value())
        break
      case '--prompt':
        if (options.group !== 'agent' || options.action !== 'create') {
          throw new Error(`${flag} is only valid for agent create`)
        }
        options.prompt = value()
        break
      case '--force':
        if (options.group !== 'agent' || options.action !== 'create') {
          throw new Error(`${flag} is only valid for agent create`)
        }
        options.force = true
        break
      default:
        throw new Error(`Unknown flag: ${flag}`)
    }
  }

  if (options.help) return options

  if (options.group === 'providers' && options.action === 'add') {
    if (positional.length > 0) throw new Error(`Unexpected argument: ${positional[0]}`)
    if (!options.name?.trim()) throw new Error('providers add requires --name')
    options.name = options.name.trim()
    return options
  }
  if (options.group === 'agent' && options.action === 'create') {
    if (positional.length === 0) throw new Error('agent create requires a name')
    if (positional.length > 1) throw new Error(`Unexpected argument: ${positional[1]}`)
    options.name = positional[0].trim()
    if (!options.name) throw new Error('agent create requires a name')
    return options
  }
  if (options.action === 'remove' || options.action === 'enable' || options.action === 'disable') {
    if (positional.length === 0) {
      throw new Error(`${options.group} ${options.action} requires an id or name`)
    }
    if (positional.length > 1) throw new Error(`Unexpected argument: ${positional[1]}`)
    options.ref = positional[0]
    return options
  }
  if (positional.length > 0) throw new Error(`Unexpected argument: ${positional[0]}`)
  return options
}

const PROVIDERS_HELP = `Usage: pnpm cli -- providers <list|add|remove> [options]

Manage providers in the shared desktop/CLI model store. Credentials are stored
in auth.json and only their presence is ever printed.

Actions:
  list                     List configured providers (default)
  add                      Add a provider
  remove <id|name>         Remove a provider and its models

Options:
  --user-data <dir>        ATeam user data directory (or ATEAM_USER_DATA)
  --json                   Print JSON
  --help                   Show this help
`

const PROVIDERS_ADD_HELP = `Usage: pnpm cli -- providers add --name <name> [options]

Options:
  --name <name>              Provider display name (required)
  --type <type>              anthropic | openai | google | openai-compatible
  --base-url <url>           Custom endpoint (required for openai-compatible)
  --api-key <key>            API key; stored in auth.json, never echoed
  --user-data <dir>          ATeam user data directory (or ATEAM_USER_DATA)
  --json                     Print JSON
  --help                     Show this help
`

const MCP_HELP = `Usage: pnpm cli -- mcp <list|enable|disable> [options]

Manage MCP servers in the shared desktop/CLI store. Header and environment
values are never printed.

Actions:
  list                     List MCP servers (default)
  enable <id|name>         Enable a server
  disable <id|name>        Disable a server

Options:
  --user-data <dir>        ATeam user data directory (or ATEAM_USER_DATA)
  --json                   Print JSON
  --help                   Show this help
`

const AGENT_HELP = `Usage: pnpm cli -- agent create <name> [options]

Create a user-level Markdown agent in <user-data>/agent/agents.

Options:
  --description <text>       Agent description (default: "Custom agent: <name>")
  --mode <mode>              primary | subagent | all (default: subagent)
  --model <ref>              provider/model or provider/model#variant
  --tools <list>             Comma-separated tool names; "*" or omitted means all
  --permission <rules>       action|resource|effect entries, comma separated
  --steps <n>                Max steps, 1-100
  --temperature <value>      Temperature, 0-2
  --prompt <text>            Agent prompt (default: "You are <name>.")
  --force                    Overwrite an existing agent file
  --user-data <dir>          ATeam user data directory (or ATEAM_USER_DATA)
  --json                     Print JSON
  --help                     Show this help
`

function helpFor(options: ConfigCommandOptions): string {
  if (options.group === 'providers') {
    return options.action === 'add' ? PROVIDERS_ADD_HELP : PROVIDERS_HELP
  }
  if (options.group === 'mcp') return MCP_HELP
  return AGENT_HELP
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length))
  )
  const line = (cells: string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd()
  return `${[line(headers), ...rows.map(line)].join('\n')}\n`
}

interface ProviderView {
  id: string
  name: string
  type: ProviderType
  baseURL: string | null
  authMode: ProviderAuthMode
  hasApiKey: boolean
  hasOAuthClientSecret: boolean
  createdAt: string
  updatedAt: string
}

function providerView(provider: ProviderPublic): ProviderView {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    baseURL: sanitizeUrl(provider.baseURL),
    authMode: provider.authMode ?? 'apiKey',
    hasApiKey: provider.hasApiKey,
    hasOAuthClientSecret: Boolean(provider.hasOAuthClientSecret),
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  }
}

function resolveProvider(providers: readonly ProviderPublic[], ref: string): ProviderPublic {
  const byId = providers.find((provider) => provider.id === ref)
  if (byId) return byId
  const key = ref.toLowerCase()
  const byName = providers.filter((provider) => provider.name.toLowerCase() === key)
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) throw new ConfigCommandError(`AMBIGUOUS_PROVIDER: ${ref}`, 1)
  throw new ConfigCommandError(`PROVIDER_NOT_FOUND: ${ref}`, 1)
}

function resolveMcpServer(servers: readonly McpServerConfig[], ref: string): McpServerConfig {
  const byId = servers.find((server) => server.id === ref)
  if (byId) return byId
  const key = ref.toLowerCase()
  const byName = servers.filter((server) => server.name.toLowerCase() === key)
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) throw new ConfigCommandError(`AMBIGUOUS_MCP_SERVER: ${ref}`, 1)
  throw new ConfigCommandError(`MCP_SERVER_NOT_FOUND: ${ref}`, 1)
}

async function openProviderStore(userData: string): Promise<ModelConfigStore> {
  const store = new ModelConfigStore(userData, new JsonProviderAuthStore(userData))
  await store.init()
  return store
}

async function runProviders(options: ConfigCommandOptions, io: CliIo): Promise<void> {
  if (options.action === 'add') {
    const store = await openProviderStore(options.userData)
    const before = new Set(store.publicConfig().providers.map((provider) => provider.id))
    await store.addProvider({
      name: options.name ?? '',
      type: options.providerType,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.apiKey ? { apiKey: options.apiKey } : {})
    })
    const created = store.publicConfig().providers.find((provider) => !before.has(provider.id))
    if (!created) throw new ConfigCommandError('PROVIDER_NOT_CREATED', 1)
    const view = providerView(created)
    if (options.json) {
      io.stdout(`${JSON.stringify({ provider: view }, null, 2)}\n`)
    } else {
      io.stdout(
        `Added provider ${view.id} (${view.name}). API key: ${view.hasApiKey ? 'stored' : 'not set'}.\n`
      )
    }
    return
  }

  const store = await openProviderStore(options.userData)
  const providers = store.publicConfig().providers

  if (options.action === 'remove') {
    const provider = resolveProvider(providers, options.ref ?? '')
    await store.deleteProvider(provider.id)
    const view = providerView(provider)
    if (options.json) {
      io.stdout(`${JSON.stringify({ removed: true, provider: view }, null, 2)}\n`)
    } else {
      io.stdout(`Removed provider ${view.id} (${view.name}).\n`)
    }
    return
  }

  const views = providers.map(providerView)
  if (options.json) {
    io.stdout(`${JSON.stringify({ userData: options.userData, providers: views }, null, 2)}\n`)
    return
  }
  if (views.length === 0) {
    io.stdout(`No providers configured in ${options.userData}.\n`)
    return
  }
  io.stdout(
    formatTable(
      ['ID', 'NAME', 'TYPE', 'AUTH', 'KEY', 'BASE URL'],
      views.map((view) => [
        view.id,
        view.name,
        view.type,
        view.authMode,
        view.hasApiKey ? 'yes' : 'no',
        view.baseURL ?? ''
      ])
    )
  )
}

async function openMcpStore(userData: string): Promise<McpStore> {
  const store = new McpStore(userData)
  await store.init()
  return store
}

async function runMcp(options: ConfigCommandOptions, io: CliIo): Promise<void> {
  const store = await openMcpStore(options.userData)

  if (options.action === 'enable' || options.action === 'disable') {
    const server = resolveMcpServer(store.list(), options.ref ?? '')
    const updated = await store.update(server.id, { enabled: options.action === 'enable' })
    const view = sanitizeMcpServers([updated])[0]
    if (options.json) {
      io.stdout(`${JSON.stringify({ server: view }, null, 2)}\n`)
    } else {
      io.stdout(
        `${updated.enabled ? 'Enabled' : 'Disabled'} MCP server ${updated.name} (${updated.id}).\n`
      )
    }
    return
  }

  const views = sanitizeMcpServers(store.list())
  if (options.json) {
    io.stdout(`${JSON.stringify({ userData: options.userData, servers: views }, null, 2)}\n`)
    return
  }
  if (views.length === 0) {
    io.stdout(`No MCP servers configured in ${options.userData}.\n`)
    return
  }
  io.stdout(
    formatTable(
      ['ID', 'NAME', 'TYPE', 'ENABLED', 'TARGET'],
      views.map((view: ResourceMcpServer) => [
        view.id,
        view.name,
        view.type,
        view.enabled ? 'yes' : 'no',
        view.command ? [view.command, ...view.args].join(' ') : (view.url ?? '')
      ])
    )
  )
}

function singleLine(value: string): string {
  return value.replace(/\r?\n/g, ' ').trim()
}

function buildAgentMarkdown(options: ConfigCommandOptions, name: string): string {
  const description = singleLine(options.description || `Custom agent: ${name}`)
  const lines = [
    '---',
    `name: ${singleLine(name)}`,
    `description: ${description}`,
    `mode: ${options.mode}`
  ]
  if (options.model) lines.push(`model: ${singleLine(options.model)}`)
  if (options.tools && options.tools.length > 0) lines.push(`tools: ${options.tools.join(', ')}`)
  if (options.permission) lines.push(`permission: ${singleLine(options.permission)}`)
  if (options.steps !== null) lines.push(`steps: ${options.steps}`)
  if (options.temperature !== null) lines.push(`temperature: ${options.temperature}`)
  lines.push('---', '', (options.prompt || `You are ${name}.`).trim(), '')
  return lines.join('\n')
}

async function runAgent(options: ConfigCommandOptions, io: CliIo): Promise<void> {
  const name = options.name?.trim() ?? ''
  if (!name) throw new ConfigCommandError('NAME_REQUIRED', 2)
  const id = agentIdFor(name)
  const directory = path.join(options.userData, 'agent', 'agents')
  const file = path.join(directory, `${id}.md`)

  const exists = await fs.access(file).then(
    () => true,
    () => false
  )
  if (exists && !options.force) {
    throw new ConfigCommandError(`AGENT_EXISTS: ${file} (pass --force to overwrite)`, 1)
  }

  const content = buildAgentMarkdown(options, name)
  const parsed = parseAgentMarkdown(file, content, 'user')
  if (!parsed) {
    throw new ConfigCommandError('INVALID_AGENT: generated agent file failed validation', 2)
  }

  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(file, content, 'utf8')

  const agent = { id: parsed.id, name: parsed.name, mode: parsed.mode, file }
  if (options.json) {
    io.stdout(`${JSON.stringify({ agent }, null, 2)}\n`)
  } else {
    io.stdout(`Created agent ${agent.name} (${agent.id}) at ${agent.file}.\n`)
  }
}

/**
 * Runs a configuration subcommand and returns the process exit code: 0 on
 * success, 2 for usage errors, 1 for store failures (not found, existing file).
 */
export async function runConfigCommand(
  argv: string[],
  overrides: Partial<CliIo> = {}
): Promise<number> {
  const io = createCliIo(overrides)
  let options: ConfigCommandOptions
  try {
    options = parseConfigArgs(argv, io.cwd)
  } catch (error) {
    io.stderr(`${messageOf(error)}\n`)
    return 2
  }
  if (options.help) {
    io.stdout(helpFor(options))
    return 0
  }

  try {
    if (options.group === 'providers') await runProviders(options, io)
    else if (options.group === 'mcp') await runMcp(options, io)
    else await runAgent(options, io)
    return 0
  } catch (error) {
    io.stderr(`${messageOf(error)}\n`)
    return error instanceof ConfigCommandError ? error.exitCode : 1
  }
}
