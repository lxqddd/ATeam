import { spawn as nodeSpawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveExecutable } from './executables'

const DEFAULT_TIMEOUT_MS = 10_000

export interface FormatterDefinition {
  id: string
  extensions: readonly string[]
  configFiles: readonly string[]
  command: (file: string) => string[]
}

export interface FormatterSpawnChild {
  stderr?: NodeJS.ReadableStream | null
  on(event: 'exit', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  kill?(signal?: NodeJS.Signals): boolean
}

export type FormatterSpawn = (
  command: string,
  args: string[],
  options: { cwd: string }
) => FormatterSpawnChild

export interface FormatResult {
  formatted: boolean
  formatter?: string
  error?: string
}

const WEB_EXTENSIONS = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.jsonc',
  '.css',
  '.scss',
  '.less',
  '.md',
  '.mdx',
  '.yaml',
  '.yml',
  '.html',
  '.vue',
  '.svelte'
] as const

export const FORMATTERS: readonly FormatterDefinition[] = [
  {
    id: 'prettier',
    extensions: WEB_EXTENSIONS,
    configFiles: [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.json5',
      '.prettierrc.yml',
      '.prettierrc.yaml',
      '.prettierrc.js',
      '.prettierrc.cjs',
      '.prettierrc.mjs',
      '.prettierrc.ts',
      'prettier.config.js',
      'prettier.config.cjs',
      'prettier.config.mjs',
      'prettier.config.ts'
    ],
    command: (file) => ['prettier', '--write', file]
  },
  {
    id: 'biome',
    extensions: WEB_EXTENSIONS,
    configFiles: ['biome.json', 'biome.jsonc'],
    command: (file) => ['biome', 'format', '--write', file]
  },
  {
    id: 'gofmt',
    extensions: ['.go'],
    configFiles: ['go.mod'],
    command: (file) => ['gofmt', '-w', file]
  },
  {
    id: 'rustfmt',
    extensions: ['.rs'],
    configFiles: ['rustfmt.toml', '.rustfmt.toml', 'Cargo.toml'],
    command: (file) => ['rustfmt', file]
  },
  {
    id: 'ruff',
    extensions: ['.py', '.pyi'],
    configFiles: ['ruff.toml', '.ruff.toml'],
    command: (file) => ['ruff', 'format', file]
  }
]

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function hasDependency(packageJson: Record<string, unknown> | null, name: string): boolean {
  if (!packageJson) return false
  for (const key of ['dependencies', 'devDependencies'] as const) {
    const section = packageJson[key]
    if (section && typeof section === 'object' && name in section) return true
  }
  return false
}

export async function discoverFormatters(workspace: string): Promise<FormatterDefinition[]> {
  let packageJson: Record<string, unknown> | null = null
  try {
    packageJson = JSON.parse(
      await fs.readFile(path.join(workspace, 'package.json'), 'utf8')
    ) as Record<string, unknown>
  } catch {
    packageJson = null
  }
  const pyproject = await fs
    .readFile(path.join(workspace, 'pyproject.toml'), 'utf8')
    .catch(() => '')

  const discovered: FormatterDefinition[] = []
  for (const formatter of FORMATTERS) {
    let enabled = false
    for (const configFile of formatter.configFiles) {
      if (await fileExists(path.join(workspace, configFile))) {
        enabled = true
        break
      }
    }
    if (!enabled && formatter.id === 'prettier') {
      enabled =
        hasDependency(packageJson, 'prettier') ||
        (packageJson !== null && 'prettier' in packageJson)
    }
    if (!enabled && formatter.id === 'biome') {
      enabled = hasDependency(packageJson, '@biomejs/biome')
    }
    if (!enabled && formatter.id === 'ruff') {
      enabled = pyproject.includes('[tool.ruff')
    }
    if (enabled) discovered.push(formatter)
  }
  return discovered
}

export function selectFormatter(
  filePath: string,
  formatters: readonly FormatterDefinition[]
): FormatterDefinition | undefined {
  const extension = path.extname(filePath).toLowerCase()
  return formatters.find((formatter) => formatter.extensions.includes(extension))
}

export async function formatFile(
  filePath: string,
  formatters: readonly FormatterDefinition[],
  workspace: string,
  options: {
    spawn?: FormatterSpawn
    resolveExecutable?: (bin: string) => Promise<string | null>
    timeoutMs?: number
  } = {}
): Promise<FormatResult> {
  const formatter = selectFormatter(filePath, formatters)
  if (!formatter) return { formatted: false }

  const [bin, ...args] = formatter.command(filePath)
  const resolve =
    options.resolveExecutable ?? ((name: string) => resolveExecutable(name, workspace))
  const executable = await resolve(bin)
  if (!executable) return { formatted: false }

  const spawn = options.spawn ?? (nodeSpawn as unknown as FormatterSpawn)
  try {
    return await new Promise<FormatResult>((resolveResult) => {
      let settled = false
      let stderr = ''
      const child = spawn(executable, args, { cwd: workspace })
      const finish = (result: FormatResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveResult(result)
      }
      const timer = setTimeout(() => {
        if (settled) return
        finish({ formatted: false, formatter: formatter.id, error: 'Formatter timed out' })
        try {
          child.kill?.()
        } catch {
          /* the process may already be gone */
        }
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr = `${stderr}${String(chunk)}`.slice(-2_000)
      })
      child.on('exit', (code) => {
        if (code === 0) {
          finish({ formatted: true, formatter: formatter.id })
          return
        }
        finish({
          formatted: false,
          formatter: formatter.id,
          error: stderr.trim() || `Formatter exited with code ${code ?? 'unknown'}`
        })
      })
      child.on('error', (error) => {
        finish({ formatted: false, formatter: formatter.id, error: error.message })
      })
    })
  } catch (error) {
    return {
      formatted: false,
      formatter: formatter.id,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
