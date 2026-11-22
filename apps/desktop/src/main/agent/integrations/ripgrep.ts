import { spawn } from 'node:child_process'

export interface RipgrepMatch {
  path: string
  line: number
  text: string
}

export interface RipgrepOptions {
  cwd: string
  pattern: string
  literal?: boolean
  caseSensitive?: boolean
  include?: string
  maxResults: number
  signal?: AbortSignal
  binary?: string
}

export function parseRipgrepJson(lines: string[]): RipgrepMatch[] {
  const matches: RipgrepMatch[] = []
  for (const line of lines) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!record || typeof record !== 'object') continue
    const value = record as {
      type?: unknown
      data?: { path?: { text?: unknown }; line_number?: unknown; lines?: { text?: unknown } }
    }
    if (value.type !== 'match' || !value.data) continue
    const path = value.data.path?.text
    const number = value.data.line_number
    const text = value.data.lines?.text
    if (typeof path !== 'string' || typeof number !== 'number' || typeof text !== 'string') continue
    matches.push({ path, line: number, text: text.replace(/\r?\n$/, '') })
  }
  return matches
}

/**
 * Search with ripgrep when it is installed. Resolves null when the binary is
 * missing or unusable so callers can fall back to the JavaScript walker.
 */
let bundledBinary: Promise<string | null> | null = null

function resolveBundledBinary(): Promise<string | null> {
  bundledBinary ??= import('@vscode/ripgrep')
    .then((module) =>
      module.rgPath ? module.rgPath.replace('app.asar', 'app.asar.unpacked') : null
    )
    .catch(() => null)
  return bundledBinary
}

export async function ripgrepSearch(options: RipgrepOptions): Promise<RipgrepMatch[] | null> {
  const binary = options.binary ?? (await resolveBundledBinary()) ?? 'rg'
  return new Promise((resolve) => {
    const args = ['--json', '--line-number', '--no-heading', '--color', 'never', '--no-config']
    args.push('--hidden', '--no-ignore')
    args.push('--glob', '!node_modules/**', '--glob', '!.git/**', '--glob', '!.DS_Store')
    if (options.literal) args.push('--fixed-strings')
    if (!options.caseSensitive) args.push('--ignore-case')
    if (options.include) args.push('--glob', options.include)
    args.push('-e', options.pattern, '.')

    let settled = false
    const finish = (value: RipgrepMatch[] | null): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(binary, args, { cwd: options.cwd })
    } catch {
      finish(null)
      return
    }

    let buffer = ''
    let stderr = ''
    const matches: RipgrepMatch[] = []
    let stopped = false

    function onAbort(): void {
      stopped = true
      child.kill()
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (stopped) return
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      matches.push(...parseRipgrepJson(lines))
      if (matches.length >= options.maxResults) {
        stopped = true
        child.kill()
      }
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (stopped) {
        finish(matches.slice(0, options.maxResults))
        return
      }
      if (buffer.trim()) matches.push(...parseRipgrepJson([buffer]))
      if (code === 0 || code === 1) {
        finish(matches.slice(0, options.maxResults))
        return
      }
      if (stderr.includes('unrecognized')) {
        finish(null)
        return
      }
      finish(null)
    })
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}
