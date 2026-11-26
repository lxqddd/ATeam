import { spawn as nodeSpawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentConfig } from '@ateam/shared'
import { resolveExecutable } from './executables'

const DEFAULT_TIMEOUT_MS = 10_000

export interface FormatterDefinition {
  id: string
  extensions: readonly string[]
  configFiles: readonly string[]
  command: (file: string) => string[]
  environment?: Record<string, string>
  /** Executables that enable the formatter when no config file matches. */
  binaries?: readonly string[]
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
  options: { cwd: string; env?: NodeJS.ProcessEnv }
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
  },
  {
    id: 'mix',
    extensions: ['.ex', '.exs', '.eex', '.heex', '.leex', '.neex', '.sface'],
    configFiles: [],
    binaries: ['mix'],
    command: (file) => ['mix', 'format', file]
  },
  {
    id: 'oxfmt',
    extensions: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'],
    configFiles: [],
    command: (file) => ['oxfmt', file]
  },
  {
    id: 'zig',
    extensions: ['.zig', '.zon'],
    configFiles: [],
    binaries: ['zig'],
    command: (file) => ['zig', 'fmt', file]
  },
  {
    // Extensions are lowercased because selectFormatter compares lowercased ones.
    id: 'clang-format',
    extensions: ['.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hh', '.hpp', '.hxx', '.h++', '.ino'],
    configFiles: ['.clang-format'],
    binaries: ['clang-format'],
    command: (file) => ['clang-format', '-i', file]
  },
  {
    id: 'ktlint',
    extensions: ['.kt', '.kts'],
    configFiles: [],
    binaries: ['ktlint'],
    command: (file) => ['ktlint', '-F', file]
  },
  {
    id: 'uv',
    extensions: ['.py', '.pyi'],
    configFiles: [],
    binaries: ['uv'],
    command: (file) => ['uv', 'format', '--', file]
  },
  {
    id: 'rubocop',
    extensions: ['.rb', '.rake', '.gemspec', '.ru'],
    configFiles: [],
    binaries: ['rubocop'],
    command: (file) => ['rubocop', '--autocorrect', file]
  },
  {
    id: 'standardrb',
    extensions: ['.rb', '.rake', '.gemspec', '.ru'],
    configFiles: [],
    binaries: ['standardrb'],
    command: (file) => ['standardrb', '--fix', file]
  },
  {
    id: 'air',
    extensions: ['.r'],
    configFiles: [],
    binaries: ['air'],
    command: (file) => ['air', 'format', file]
  },
  {
    id: 'dart',
    extensions: ['.dart'],
    configFiles: [],
    binaries: ['dart'],
    command: (file) => ['dart', 'format', file]
  },
  {
    id: 'ocamlformat',
    extensions: ['.ml', '.mli'],
    configFiles: ['.ocamlformat'],
    binaries: ['ocamlformat'],
    command: (file) => ['ocamlformat', '-i', file]
  },
  {
    id: 'terraform',
    extensions: ['.tf', '.tfvars'],
    configFiles: [],
    binaries: ['terraform'],
    command: (file) => ['terraform', 'fmt', file]
  },
  {
    id: 'latexindent',
    extensions: ['.tex'],
    configFiles: [],
    binaries: ['latexindent'],
    command: (file) => ['latexindent', '-w', '-s', file]
  },
  {
    id: 'gleam',
    extensions: ['.gleam'],
    configFiles: [],
    binaries: ['gleam'],
    command: (file) => ['gleam', 'format', file]
  },
  {
    id: 'shfmt',
    extensions: ['.sh', '.bash'],
    configFiles: [],
    binaries: ['shfmt'],
    command: (file) => ['shfmt', '-w', file]
  },
  {
    id: 'nixfmt',
    extensions: ['.nix'],
    configFiles: [],
    binaries: ['nixfmt'],
    command: (file) => ['nixfmt', file]
  },
  {
    id: 'pint',
    extensions: ['.php'],
    configFiles: [],
    command: (file) => ['./vendor/bin/pint', file]
  },
  {
    id: 'ormolu',
    extensions: ['.hs'],
    configFiles: [],
    binaries: ['ormolu'],
    command: (file) => ['ormolu', '-i', file]
  },
  {
    id: 'cljfmt',
    extensions: ['.clj', '.cljs', '.cljc', '.edn'],
    configFiles: [],
    binaries: ['cljfmt'],
    command: (file) => ['cljfmt', 'fix', '--quiet', file]
  },
  {
    id: 'dfmt',
    extensions: ['.d'],
    configFiles: [],
    binaries: ['dfmt'],
    command: (file) => ['dfmt', '-i', file]
  },
  {
    // `.html.erb` is listed for documentation only; path.extname only sees `.erb`.
    id: 'htmlbeautifier',
    extensions: ['.erb', '.html.erb'],
    configFiles: [],
    binaries: ['htmlbeautifier'],
    command: (file) => ['htmlbeautifier', file]
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

function hasSectionDependency(
  document: Record<string, unknown> | null,
  sections: readonly string[],
  name: string
): boolean {
  if (!document) return false
  for (const key of sections) {
    const section = document[key]
    if (section && typeof section === 'object' && name in section) return true
  }
  return false
}

function commandFromConfig(command: string[]): (file: string) => string[] {
  return (file) => {
    let used = false
    const args = command.map((arg) => {
      if (arg.includes('$FILE')) {
        used = true
        return arg.replace(/\$FILE/g, file)
      }
      return arg
    })
    return used ? args : [...args, file]
  }
}

export async function discoverFormatters(
  workspace: string,
  config?: AgentConfig,
  options: { resolveExecutable?: (bin: string) => Promise<string | null> } = {}
): Promise<FormatterDefinition[]> {
  if (config?.formatters === false) return []
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
  let composerJson: Record<string, unknown> | null = null
  try {
    composerJson = JSON.parse(
      await fs.readFile(path.join(workspace, 'composer.json'), 'utf8')
    ) as Record<string, unknown>
  } catch {
    composerJson = null
  }
  const resolve = options.resolveExecutable ?? ((bin: string) => resolveExecutable(bin, workspace))

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
    if (!enabled && formatter.id === 'oxfmt') {
      enabled = hasDependency(packageJson, 'oxfmt')
    }
    if (!enabled && formatter.id === 'biome') {
      enabled = hasDependency(packageJson, '@biomejs/biome')
    }
    if (!enabled && formatter.id === 'ruff') {
      enabled = pyproject.includes('[tool.ruff')
    }
    if (!enabled && formatter.id === 'pint') {
      enabled = hasSectionDependency(composerJson, ['require', 'require-dev'], 'laravel/pint')
    }
    if (!enabled && formatter.binaries?.length) {
      for (const binary of formatter.binaries) {
        if (await resolve(binary)) {
          enabled = true
          break
        }
      }
    }
    if (enabled) discovered.push(formatter)
  }
  const configured = config?.formatterServers
  if (!configured) return discovered
  const byId = new Map(discovered.map((formatter) => [formatter.id, formatter]))
  const explicit: FormatterDefinition[] = []
  for (const [id, input] of Object.entries(configured)) {
    const existing = byId.get(id)
    if (input.disabled) {
      byId.delete(id)
      continue
    }
    if (!input.command && !existing) continue
    const command = input.command ? commandFromConfig(input.command) : existing?.command
    if (!command) continue
    const definition: FormatterDefinition = {
      id,
      command,
      extensions: input.extensions ?? existing?.extensions ?? [],
      configFiles: input.configFiles ?? existing?.configFiles ?? [],
      ...((input.environment ?? existing?.environment)
        ? { environment: { ...(existing?.environment ?? {}), ...(input.environment ?? {}) } }
        : {})
    }
    explicit.push(definition)
    byId.delete(id)
  }
  return [...explicit, ...byId.values()]
}

export function selectFormatter(
  filePath: string,
  formatters: readonly FormatterDefinition[],
  overrides: Record<string, string> = {}
): FormatterDefinition | undefined {
  const extension = path.extname(filePath).toLowerCase()
  const override = overrides[extension]
  if (override === 'none') return undefined
  if (override) {
    return formatters.find(
      (formatter) => formatter.id === override && formatter.extensions.includes(extension)
    )
  }
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
    overrides?: Record<string, string>
    env?: NodeJS.ProcessEnv
  } = {}
): Promise<FormatResult> {
  const formatter = selectFormatter(filePath, formatters, options.overrides)
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
      const envOverrides = { ...(options.env ?? {}), ...(formatter.environment ?? {}) }
      const child = spawn(
        executable,
        args,
        Object.keys(envOverrides).length > 0
          ? { cwd: workspace, env: { ...process.env, ...envOverrides } }
          : { cwd: workspace }
      )
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
