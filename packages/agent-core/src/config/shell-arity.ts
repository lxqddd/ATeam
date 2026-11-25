import { parseShellCommand } from './shell-parse'

const ARITY: Record<string, number> = {
  apt: 2,
  'apt-get': 2,
  aws: 2,
  'aws s3': 3,
  az: 2,
  'az account': 3,
  'az group': 3,
  black: 1,
  brew: 2,
  bun: 2,
  'bun run': 3,
  bunx: 2,
  cargo: 2,
  composer: 2,
  deno: 2,
  docker: 2,
  'docker buildx': 3,
  'docker compose': 3,
  dotnet: 2,
  eslint: 1,
  firebase: 2,
  gcloud: 2,
  'gcloud auth': 3,
  'gcloud compute': 3,
  'gcloud config': 3,
  gh: 2,
  'gh issue': 3,
  'gh pr': 3,
  'gh repo': 3,
  'gh run': 3,
  git: 2,
  'git remote': 3,
  'git stash': 2,
  glab: 2,
  go: 2,
  'go mod': 3,
  'golangci-lint': 1,
  gradle: 1,
  helm: 2,
  'helm repo': 3,
  jest: 1,
  jq: 1,
  kubectl: 2,
  make: 2,
  mvn: 2,
  mypy: 1,
  netlify: 2,
  npm: 2,
  'npm run': 3,
  npx: 2,
  pip: 2,
  playwright: 2,
  pnpm: 2,
  'pnpm run': 3,
  pnpx: 2,
  poetry: 2,
  prettier: 1,
  prisma: 2,
  psql: 1,
  pytest: 1,
  'redis-cli': 1,
  rg: 1,
  rm: 1,
  ruff: 1,
  rustup: 2,
  shellcheck: 1,
  supabase: 2,
  systemctl: 2,
  terraform: 2,
  'terraform state': 3,
  'terraform workspace': 3,
  tsc: 1,
  uv: 2,
  vercel: 2,
  vitest: 1,
  yarn: 2,
  'yarn run': 3,
  yq: 1
}

const GLOBAL_VALUE_OPTIONS: Record<string, string[]> = {
  cargo: ['--manifest-path', '--config', '--target-dir', '-Z'],
  docker: ['--context', '-H', '--host', '--config', '--log-level'],
  gh: ['--repo', '-R', '--hostname'],
  git: ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env'],
  go: ['-C', '--modfile'],
  kubectl: ['--context', '--namespace', '-n', '--kubeconfig', '--cluster', '--user'],
  npm: ['--prefix', '--registry', '--workspace', '-w', '--userconfig', '--cache'],
  pnpm: ['--dir', '-C', '--filter', '-F', '--config', '--reporter'],
  yarn: ['--cwd', '--mutex', '--cache-folder']
}

const GLOBAL_BOOLEAN_OPTIONS: Record<string, string[]> = {
  docker: ['--debug', '--tls', '--tlsverify'],
  git: ['--no-pager', '--paginate', '--no-replace-objects', '--literal-pathspecs'],
  kubectl: ['--insecure-skip-tls-verify', '--warnings-as-errors'],
  npm: ['--silent', '--quiet', '--json', '--global', '-g'],
  pnpm: ['--silent', '--global', '-g']
}

function stripGlobalOptions(tokens: string[]): string[] | null {
  const command = process.platform === 'win32' ? tokens[0].toLowerCase() : tokens[0]
  const valueOptions = GLOBAL_VALUE_OPTIONS[command] ?? []
  const booleanOptions = GLOBAL_BOOLEAN_OPTIONS[command] ?? []
  if (valueOptions.length === 0 && booleanOptions.length === 0) return tokens
  let index = 0

  while (index + 1 < tokens.length && tokens[index + 1].startsWith('-')) {
    const option = tokens[index + 1]
    if (option.includes('=')) {
      index += 1
      continue
    }
    if (booleanOptions.includes(option)) {
      index += 1
      continue
    }
    if (valueOptions.includes(option)) {
      if (index + 2 >= tokens.length) return null
      index += 2
      continue
    }
    return null
  }

  return [command, ...tokens.slice(index + 1)]
}

function formatToken(token: string): string {
  return /\s/.test(token) ? `"${token.replace(/"/g, '\\"')}"` : token
}

/** Canonical form used when matching shell permission rules. */
export function normalizeShellResource(command: string): string {
  const parsed = parseShellCommand(command)
  if (parsed.segments.length !== 1) return command.trim()
  const tokens = parsed.tokens[0] ?? []
  if (tokens.length === 0 || tokens[0].includes('=')) return command.trim()
  const stripped = stripGlobalOptions(tokens)
  if (!stripped || stripped.length === 0) return command.trim()
  return stripped.map(formatToken).join(' ')
}

/**
 * Returns a reusable command prefix such as "git status" for a single
 * command, or null when the command cannot be safely broadened.
 */
export function shellCommandPrefix(command: string): string | null {
  if (!command.trim()) return null
  const parsed = parseShellCommand(command)
  if (parsed.segments.length !== 1) return null
  const rawTokens = parsed.tokens[0] ?? []
  if (rawTokens.length === 0) return null
  if (rawTokens[0].includes('=')) return null

  const tokens = stripGlobalOptions(rawTokens)
  if (!tokens) return null

  let arity: number | null = null
  for (let length = Math.min(tokens.length, 3); length >= 1; length -= 1) {
    const prefix = tokens.slice(0, length).join(' ')
    const key = process.platform === 'win32' ? prefix.toLowerCase() : prefix
    if (ARITY[key] !== undefined) {
      arity = ARITY[key]
      break
    }
  }
  if (arity === null) return null
  if (tokens.length < arity) return null
  const prefix = tokens.slice(0, Math.min(arity, tokens.length))
  if (prefix.some((token) => token.startsWith('-'))) return null
  return prefix.map(formatToken).join(' ')
}
