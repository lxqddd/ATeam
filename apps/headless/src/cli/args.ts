import os from 'node:os'
import path from 'node:path'
import type {
  PermissionMode,
  ProviderType,
  ReasoningEffort,
  RuntimeModelsConfig
} from '@ateam/shared'

export const PROVIDER_TYPES: readonly ProviderType[] = [
  'anthropic',
  'openai',
  'google',
  'openai-compatible'
]
export const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'ask', 'acceptEdits', 'auto']
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']

/** Default location of the CLI session store, shared by chat and data commands. */
export function defaultCliDataDir(): string {
  return path.join(os.homedir(), '.ateam', 'cli')
}

export interface CliOptions {
  workspace: string
  prompt: string | null
  providerType: ProviderType
  baseURL?: string
  apiKey?: string
  model: string
  contextWindow?: number
  maxOutputTokens?: number
  reasoning: ReasoningEffort | null
  permissionMode: PermissionMode
  agent: string | null
  sessionId: string | null
  dataDir: string
  json: boolean
  listSessions: boolean
  restoreSessions: boolean
  help: boolean
}

function takeValue(argv: string[], index: number, flag: string): [string, number] {
  const next = argv[index + 1]
  if (next === undefined || next.startsWith('--')) throw new Error(`${flag} requires a value`)
  return [next, index + 1]
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function parseEnum<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${flag} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

export function parseCliArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): CliOptions {
  const options: CliOptions = {
    workspace: cwd,
    prompt: null,
    providerType: (env.ATEAM_PROVIDER as ProviderType) ?? 'anthropic',
    baseURL: env.ATEAM_BASE_URL || undefined,
    apiKey: env.ATEAM_API_KEY || undefined,
    model: env.ATEAM_MODEL ?? '',
    reasoning: null,
    permissionMode: 'ask',
    agent: null,
    sessionId: null,
    dataDir: defaultCliDataDir(),
    json: false,
    listSessions: false,
    restoreSessions: false,
    help: false
  }
  if (!PROVIDER_TYPES.includes(options.providerType)) {
    throw new Error(`ATEAM_PROVIDER must be one of: ${PROVIDER_TYPES.join(', ')}`)
  }
  const positional: string[] = []
  let optionsEnded = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (optionsEnded) {
      positional.push(argument)
      continue
    }
    if (argument === '--') {
      // pnpm forwards its own separator as the first argument.
      if (index > 0) optionsEnded = true
      continue
    }
    if (!argument.startsWith('--')) {
      positional.push(argument)
      continue
    }
    const [flag, inline] = argument.includes('=')
      ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)]
      : [argument, null]
    const value = (): string => {
      if (inline !== null) return inline
      const [next, consumed] = takeValue(argv, index, flag)
      index = consumed
      return next
    }
    switch (flag) {
      case '--workspace':
        options.workspace = path.resolve(cwd, value())
        break
      case '--prompt':
        options.prompt = value()
        break
      case '--provider':
        options.providerType = parseEnum(value(), PROVIDER_TYPES, flag)
        break
      case '--base-url':
        options.baseURL = value()
        break
      case '--api-key':
        options.apiKey = value()
        break
      case '--model':
        options.model = value()
        break
      case '--context-window':
        options.contextWindow = parseNumber(value(), flag)
        break
      case '--max-output':
        options.maxOutputTokens = parseNumber(value(), flag)
        break
      case '--reasoning':
        options.reasoning = parseEnum(value(), REASONING_EFFORTS, flag)
        break
      case '--permission':
        options.permissionMode = parseEnum(value(), PERMISSION_MODES, flag)
        break
      case '--agent':
        options.agent = value()
        break
      case '--session':
        options.sessionId = value()
        break
      case '--data':
        options.dataDir = path.resolve(cwd, value())
        break
      case '--json':
        options.json = true
        break
      case '--list-sessions':
        options.listSessions = true
        break
      case '--restore-sessions':
        options.restoreSessions = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new Error(`Unknown flag: ${flag}`)
    }
  }
  if (!options.prompt && positional.length > 0) options.prompt = positional.join(' ')
  return options
}

/** Model flags shared by the CLI chat, server, and TUI entry points. */
export interface CliModelOptions {
  providerType: ProviderType
  baseURL?: string
  apiKey?: string
  model: string
  contextWindow?: number
  maxOutputTokens?: number
  reasoning: ReasoningEffort | null
}

export function buildCliModels(options: CliModelOptions): RuntimeModelsConfig {
  if (!options.model.trim()) throw new Error('A model is required (--model or ATEAM_MODEL)')
  const apiKey = options.apiKey?.trim()
  if (options.providerType !== 'openai-compatible' && !apiKey) {
    throw new Error('An API key is required (--api-key or ATEAM_API_KEY)')
  }
  if (options.providerType === 'openai-compatible' && !options.baseURL?.trim()) {
    throw new Error('OpenAI-compatible providers require --base-url')
  }
  const providerId = 'cli'
  const model = {
    id: 'cli-model',
    providerId,
    modelId: options.model.trim(),
    name: options.model.trim(),
    createdAt: new Date().toISOString(),
    ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}),
    ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.reasoning ? { reasoning: true } : {})
  }
  return {
    providers: [
      {
        id: providerId,
        name: 'CLI',
        type: options.providerType,
        baseURL: options.baseURL?.trim() || undefined,
        apiKey
      }
    ],
    models: [model],
    defaultModel: { providerId, modelId: model.modelId }
  }
}

export const CLI_HELP = `Usage: pnpm cli -- [options] [prompt]

Options:
  --workspace <path>       Workspace directory (default: current directory)
  --prompt <text>          Prompt text (or pass it positionally / via stdin)
  --provider <type>        anthropic | openai | google | openai-compatible
  --base-url <url>         Custom OpenAI-compatible endpoint
  --api-key <key>          API key (or ATEAM_API_KEY)
  --model <id>             Model id (or ATEAM_MODEL)
  --context-window <n>     Context window override
  --max-output <n>         Max output tokens
  --reasoning <effort>     minimal | low | medium | high
  --permission <mode>      plan | ask | acceptEdits | auto (default: ask)
  --agent <id>             Agent id (build, plan, or custom)
  --session <id>           Continue an existing CLI session
  --data <dir>             CLI data directory (default: ~/.ateam/cli)
  --list-sessions          List stored CLI sessions and exit
  --restore-sessions       Restore migrated legacy session backups and exit
  --json                   Print agent events as JSON lines
  --help                   Show this help

Data commands (no model or API key required):
  export [options]         Export sessions as JSON, JSON Lines or Markdown
  import [file]            Import a desktop/CLI session export (or stdin)
  stats [options]          Show local usage statistics

Configuration commands (shared with the desktop app):
  providers [list|add|remove]   List, add or remove model providers
  mcp [list|enable|disable]     List, enable or disable MCP servers
  agent create <name>           Create a user-level agent file
  Run "pnpm cli -- <command> --help" for the command's options.
`
