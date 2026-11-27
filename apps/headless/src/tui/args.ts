import path from 'node:path'
import type { PermissionMode, ProviderType, ReasoningEffort } from '@ateam/shared'
import { PERMISSION_MODES, PROVIDER_TYPES, REASONING_EFFORTS, defaultCliDataDir } from '../cli/args'
import { defaultUserDataDir } from '../cli/config'

export interface TuiOptions {
  workspace: string
  /** Session store directory, shared with the headless CLI. */
  dataDir: string
  /** ATeam user data directory holding the shared model configuration. */
  userData: string
  sessionId: string | null
  /** Attach to a running `pnpm serve` instance instead of an in-process runtime. */
  attachUrl: string | null
  token: string | null
  providerType: ProviderType
  baseURL?: string
  apiKey?: string
  model: string
  contextWindow?: number
  maxOutputTokens?: number
  reasoning: ReasoningEffort | null
  permissionMode: PermissionMode
  agent: string | null
  color: boolean
  help: boolean
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

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

function parseAttachUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('--attach must be an http(s) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('--attach must be an http(s) URL')
  }
  return value.replace(/\/+$/, '')
}

/**
 * Parses `pnpm tui -- [options]`.
 *
 * Values may be inline (`--model=...`) or the following argument. Model flags
 * are only used without `--attach`; attach mode talks to an existing server.
 */
export function parseTuiArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  home = process.env.HOME ?? process.env.USERPROFILE ?? ''
): TuiOptions {
  const provider = (env.ATEAM_PROVIDER as ProviderType) ?? 'anthropic'
  if (!PROVIDER_TYPES.includes(provider)) {
    throw new Error(`ATEAM_PROVIDER must be one of: ${PROVIDER_TYPES.join(', ')}`)
  }
  const options: TuiOptions = {
    workspace: cwd,
    dataDir: defaultCliDataDir(),
    userData: defaultUserDataDir(env, process.platform, home),
    sessionId: null,
    attachUrl: null,
    token: env.ATEAM_SERVER_TOKEN || null,
    providerType: provider,
    baseURL: env.ATEAM_BASE_URL || undefined,
    apiKey: env.ATEAM_API_KEY || undefined,
    model: env.ATEAM_MODEL ?? '',
    reasoning: null,
    permissionMode: 'ask',
    agent: null,
    color: !('NO_COLOR' in env),
    help: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (!argument.startsWith('--') && argument !== '-h') {
      throw new Error(`Unexpected argument: ${argument}`)
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
      case '--data':
        options.dataDir = path.resolve(cwd, value())
        break
      case '--user-data':
        options.userData = path.resolve(cwd, value())
        break
      case '--session':
        options.sessionId = value()
        break
      case '--attach':
        options.attachUrl = parseAttachUrl(value())
        break
      case '--token':
        options.token = value()
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
        options.contextWindow = parsePositiveInteger(value(), flag)
        break
      case '--max-output':
        options.maxOutputTokens = parsePositiveInteger(value(), flag)
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
      case '--no-color':
        options.color = false
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        throw new Error(`Unknown flag: ${flag}`)
    }
  }

  return options
}

export const TUI_HELP = `Usage: pnpm tui -- [options]

Full-screen terminal interface for ATeam. Lists, creates and switches sessions,
streams assistant text, reasoning and tool state, and answers permission and
question prompts without leaving the keyboard.

Connection:
  --attach <url>           Attach to a running "pnpm serve" instance
  --token <token>          Bearer token for --attach (or ATEAM_SERVER_TOKEN)
  --session <id>           Open this session first
  --data <dir>             Session store (default: ~/.ateam/cli)
  --user-data <dir>        Shared model config (default: ATeam user data)
  --workspace <path>       Workspace for new sessions (default: current directory)

Models (local mode):
  --provider <type>        anthropic | openai | google | openai-compatible
  --model <id>             Model id (or ATEAM_MODEL)
  --api-key <key>          API key (or ATEAM_API_KEY)
  --base-url <url>         Custom OpenAI-compatible endpoint
  --context-window <n>     Context window override
  --max-output <n>         Max output tokens
  --reasoning <effort>     minimal | low | medium | high
  --permission <mode>      plan | ask | acceptEdits | auto (default: ask)
  --agent <id>             Agent for new sessions
  --no-color               Disable ANSI colors (also honors NO_COLOR)

Keys:
  Enter send · Tab sessions · Ctrl-T new · Ctrl-N/Ctrl-P switch session
  Ctrl-C stop running turn, clear input, then quit · Ctrl-R retry · Ctrl-D quit
  Up/Down/PageUp/PageDown scroll · ? help · Esc close or cancel

Without --model the shared provider store (see "pnpm cli -- providers add") is
used; local mode requires an API key there.
`
