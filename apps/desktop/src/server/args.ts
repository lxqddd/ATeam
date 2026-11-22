import type { CliOptions } from '../cli/args'
import { parseCliArgs } from '../cli/args'

export interface ServerOptions {
  cli: CliOptions
  host: string
  port: number
  token: string | null
  help: boolean
}

export const SERVER_HELP = `Usage: pnpm serve -- [server options] [model options]

Server options:
  --host <host>            Bind host (default: 127.0.0.1)
  --port <port>            Bind port (default: 4096)
  --token <token>          Require Authorization: Bearer <token> (or ATEAM_SERVER_TOKEN)
  --help                   Show this help

Model options are the same as the headless CLI:
  --workspace, --provider, --base-url, --api-key, --model,
  --context-window, --max-output, --reasoning, --permission, --agent, --data

Examples:
  pnpm serve -- --provider openai --api-key "$KEY" --model gpt-5
  curl http://127.0.0.1:4096/health
`

function takeValue(argv: string[], index: number, flag: string): [string, number] {
  const next = argv[index + 1]
  if (next === undefined || next.startsWith('--')) throw new Error(`${flag} requires a value`)
  return [next, index + 1]
}

export function parseServerArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): ServerOptions {
  let host = '127.0.0.1'
  let port = 4096
  let token: string | null = env.ATEAM_SERVER_TOKEN || null
  let help = false
  const remaining: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const [flag, inline] =
      argument.startsWith('--') && argument.includes('=')
        ? [argument.slice(0, argument.indexOf('=')), argument.slice(argument.indexOf('=') + 1)]
        : [argument, null]
    const value = (): string => {
      if (inline !== null) return inline
      const [next, consumed] = takeValue(argv, index, flag)
      index = consumed
      return next
    }
    if (flag === '--host') {
      host = value().trim() || '127.0.0.1'
    } else if (flag === '--port') {
      const parsed = Number(value())
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
        throw new Error('--port must be between 0 and 65535')
      }
      port = parsed
    } else if (flag === '--token') {
      token = value().trim() || null
    } else if (flag === '--help' || flag === '-h') {
      help = true
    } else {
      remaining.push(argument)
    }
  }

  return { cli: parseCliArgs(remaining, env, cwd), host, port, token, help }
}
