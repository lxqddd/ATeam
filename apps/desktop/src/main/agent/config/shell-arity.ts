const ARITY: Record<string, number> = {
  bun: 2,
  'bun run': 3,
  cargo: 2,
  docker: 2,
  'docker compose': 3,
  git: 2,
  go: 2,
  kubectl: 2,
  make: 2,
  npm: 2,
  'npm run': 3,
  pnpm: 2,
  'pnpm run': 3,
  python: 2,
  pip: 2,
  rg: 1,
  rm: 1,
  yarn: 2,
  'yarn run': 3
}

function tokenize(command: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const match of command.matchAll(pattern)) {
    const token = match[1] ?? match[2] ?? match[3] ?? ''
    if (token) tokens.push(token)
  }
  return tokens
}

/**
 * Returns a reusable command prefix such as "git status" for a single
 * command, or null when the command cannot be safely broadened.
 */
export function shellCommandPrefix(command: string): string | null {
  if (!command.trim()) return null
  if (/[;&|\n]/.test(command)) return null
  const tokens = tokenize(command)
  if (tokens.length === 0) return null
  if (tokens[0].includes('=')) return null

  let arity: number | null = null
  for (let length = Math.min(tokens.length, 3); length >= 1; length -= 1) {
    const prefix = tokens.slice(0, length).join(' ')
    if (ARITY[prefix] !== undefined) {
      arity = ARITY[prefix]
      break
    }
  }
  if (arity === null) return null
  const prefix = tokens.slice(0, Math.min(arity, tokens.length))
  if (prefix.some((token) => token.startsWith('-'))) return null
  return prefix.join(' ')
}
