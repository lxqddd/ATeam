import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type {
  PluginCompatibility,
  PluginEntry,
  PluginInstallInput,
  PluginUpdateInput
} from '@ateam/shared'
import { promisify } from 'node:util'
import { readJsonFile, writeJsonAtomic } from './atomic-json'

const execFileAsync = promisify(execFile)

const STORE_VERSION = 1

interface StoredPluginFile {
  version: 1
  plugins: PluginEntry[]
}

interface PluginPackageJson {
  name?: unknown
  version?: unknown
  engines?: { ateam?: unknown }
  exports?: unknown
  module?: unknown
  main?: unknown
}

export type PluginInstallRunner = (spec: string, root: string) => Promise<void>

export interface PluginStoreOptions {
  installPackage?: PluginInstallRunner
  pluginRoot?: string
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

async function defaultInstallPackage(spec: string, root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  const packageFile = path.join(root, 'package.json')
  try {
    await fs.access(packageFile)
  } catch {
    await fs.writeFile(
      packageFile,
      JSON.stringify({ name: 'ateam-installed-plugins', private: true }, null, 2),
      { mode: 0o600 }
    )
  }
  try {
    await execFileAsync(
      npmCommand(),
      [
        'install',
        spec,
        '--no-save',
        '--no-package-lock',
        '--no-audit',
        '--no-fund',
        '--ignore-scripts'
      ],
      { cwd: root, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }
    )
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : error instanceof Error
          ? error.message
          : String(error)
    throw new Error(`PLUGIN_NPM_INSTALL_FAILED: ${message.trim().slice(0, 2_000)}`)
  }
}

function packageEntry(pkg: PluginPackageJson): string {
  const exports = pkg.exports
  if (typeof exports === 'string') return exports
  if (exports && typeof exports === 'object') {
    const root = (exports as Record<string, unknown>)['.']
    if (typeof root === 'string') return root
    if (root && typeof root === 'object') {
      const value = root as Record<string, unknown>
      for (const key of ['import', 'default', 'require']) {
        if (typeof value[key] === 'string') return value[key] as string
      }
    }
  }
  for (const key of ['module', 'main'] as const) {
    if (typeof pkg[key] === 'string') return pkg[key] as string
  }
  return 'index.mjs'
}

async function resolveNpmPackage(
  name: string,
  root: string
): Promise<{ entry: string; pkg: PluginPackageJson }> {
  const require = createRequire(path.join(root, 'package.json'))
  let entry: string
  try {
    entry = require.resolve(name)
  } catch {
    throw new Error(`PLUGIN_PACKAGE_NOT_FOUND: ${name}`)
  }
  let directory = path.dirname(entry)
  for (let depth = 0; depth < 8; depth += 1) {
    const pkg = await readJsonFile<PluginPackageJson>(path.join(directory, 'package.json'))
    if (pkg && typeof pkg.name === 'string' && pkg.name === name) {
      return { entry, pkg }
    }
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  const pkg = await readJsonFile<PluginPackageJson>(path.join(path.dirname(entry), 'package.json'))
  if (!pkg) throw new Error(`PLUGIN_PACKAGE_JSON_MISSING: ${name}`)
  return { entry, pkg }
}

function versionParts(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(left: string, right: string): number | null {
  const a = versionParts(left)
  const b = versionParts(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

function satisfiesRange(range: string, version: string): boolean {
  const parts = range.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0 || parts.includes('*')) return true
  return parts.every((part) => {
    if (part === '*' || part === 'latest') return true
    if (part.startsWith('^') || part.startsWith('~')) {
      const operator = part[0]
      const target = part.slice(1)
      const comparison = compareVersions(version, target)
      if (comparison === null || comparison < 0) return false
      const current = versionParts(version)
      const base = versionParts(target)
      if (!current || !base) return false
      if (operator === '^') {
        return base[0] === 0 ? current[0] === 0 && current[1] === base[1] : current[0] === base[0]
      }
      return current[0] === base[0] && current[1] === base[1]
    }
    const match = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(part)
    if (!match) return true
    const operator = match[1] ?? '='
    const target = match[2]
    const comparison = compareVersions(version, target)
    if (comparison === null) return true
    switch (operator) {
      case '>=':
        return comparison >= 0
      case '<=':
        return comparison <= 0
      case '>':
        return comparison > 0
      case '<':
        return comparison < 0
      default:
        return comparison === 0
    }
  })
}

export function isPluginCompatible(range: string, version: string): boolean {
  return satisfiesRange(range, version)
}

function parseNpmSpec(spec: string): { name: string; version: string | null } {
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    const at = slash === -1 ? -1 : spec.indexOf('@', slash)
    if (at > slash) return { name: spec.slice(0, at), version: spec.slice(at + 1) || null }
    return { name: spec, version: null }
  }
  const at = spec.indexOf('@', 1)
  if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) || null }
  return { name: spec, version: null }
}

function isLocalSpec(spec: string): boolean {
  return (
    spec === '~' ||
    spec.startsWith('~/') ||
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(spec)
  )
}

export function resolveLocalSpec(spec: string, workspace: string): string {
  if (spec === '~') return os.homedir()
  if (spec.startsWith('~/')) return path.resolve(os.homedir(), spec.slice(2))
  if (path.isAbsolute(spec)) return path.resolve(spec)
  return path.resolve(workspace, spec)
}

async function readPackage(root: string): Promise<PluginPackageJson | null> {
  try {
    const stat = await fs.stat(root)
    const directory = stat.isDirectory() ? root : path.dirname(root)
    return await readJsonFile<PluginPackageJson>(path.join(directory, 'package.json'))
  } catch {
    return null
  }
}

function compatibilityOf(requiredVersion: string | null, appVersion: string): PluginCompatibility {
  if (!requiredVersion) return 'unknown'
  return isPluginCompatible(requiredVersion, appVersion) ? 'compatible' : 'incompatible'
}

interface InspectedPlugin {
  spec: string
  name: string
  version: string | null
  source: PluginEntry['source']
  requiredVersion: string | null
  compatibility: PluginCompatibility
  error: string | null
  resolvedPath: string | null
}

async function inspectPlugin(
  input: PluginInstallInput,
  workspace: string,
  appVersion: string,
  pluginRoot: string,
  installPackage: PluginInstallRunner
): Promise<InspectedPlugin> {
  const spec = input.spec.trim()
  if (!spec) throw new Error('PLUGIN_SPEC_REQUIRED')
  const directory = input.directory ?? workspace
  let local = isLocalSpec(spec)
  if (!local) {
    try {
      await fs.stat(resolveLocalSpec(spec, directory))
      local = true
    } catch {
      local = false
    }
  }
  const source: PluginEntry['source'] = local ? 'local' : 'npm'
  if (source === 'npm') {
    const parsed = parseNpmSpec(spec)
    await installPackage(spec, pluginRoot)
    const resolved = await resolveNpmPackage(parsed.name, pluginRoot)
    const requiredVersion =
      typeof resolved.pkg.engines?.ateam === 'string' && resolved.pkg.engines.ateam.trim()
        ? resolved.pkg.engines.ateam.trim()
        : null
    const compatibility = compatibilityOf(requiredVersion, appVersion)
    if (compatibility === 'incompatible') {
      throw new Error(`PLUGIN_INCOMPATIBLE: requires ateam ${requiredVersion}`)
    }
    return {
      spec,
      name:
        typeof resolved.pkg.name === 'string' && resolved.pkg.name.trim()
          ? resolved.pkg.name.trim()
          : parsed.name,
      version: typeof resolved.pkg.version === 'string' ? resolved.pkg.version : parsed.version,
      source,
      requiredVersion,
      compatibility,
      error: null,
      resolvedPath: resolved.entry
    }
  }

  const resolved = resolveLocalSpec(spec, directory)
  let stat
  try {
    stat = await fs.stat(resolved)
  } catch {
    throw new Error(`PLUGIN_SPEC_NOT_FOUND: ${spec}`)
  }
  const pkg = await readPackage(resolved)
  if (!pkg || typeof pkg.name !== 'string' || !pkg.name.trim()) {
    throw new Error(`PLUGIN_PACKAGE_JSON_MISSING: ${spec}`)
  }
  const requiredVersion =
    typeof pkg.engines?.ateam === 'string' && pkg.engines.ateam.trim()
      ? pkg.engines.ateam.trim()
      : null
  const compatibility = compatibilityOf(requiredVersion, appVersion)
  if (compatibility === 'incompatible') {
    throw new Error(`PLUGIN_INCOMPATIBLE: requires ateam ${requiredVersion}`)
  }
  return {
    spec: resolved,
    name: pkg.name.trim(),
    version: typeof pkg.version === 'string' ? pkg.version : null,
    source,
    requiredVersion,
    compatibility,
    error: null,
    resolvedPath: stat.isDirectory() ? path.join(resolved, packageEntry(pkg)) : resolved
  }
}

export class PluginStore {
  private chain: Promise<void> = Promise.resolve()
  private readonly pluginRoot: string
  private readonly installPackage: PluginInstallRunner

  constructor(
    private readonly userDataPath: string,
    options: PluginStoreOptions = {}
  ) {
    this.pluginRoot = options.pluginRoot ?? path.join(userDataPath, 'agent', 'plugins')
    this.installPackage = options.installPackage ?? defaultInstallPackage
  }

  pluginDirectory(): string {
    return this.pluginRoot
  }

  private file(): string {
    return path.join(this.userDataPath, 'agent', 'plugins.json')
  }

  private async read(): Promise<StoredPluginFile> {
    const stored = await readJsonFile<unknown>(this.file())
    if (!stored || typeof stored !== 'object') return { version: STORE_VERSION, plugins: [] }
    const raw = stored as Partial<StoredPluginFile>
    const plugins = Array.isArray(raw.plugins)
      ? raw.plugins
          .filter(
            (entry): entry is PluginEntry =>
              Boolean(entry) &&
              typeof entry === 'object' &&
              typeof (entry as PluginEntry).id === 'string' &&
              typeof (entry as PluginEntry).spec === 'string' &&
              typeof (entry as PluginEntry).name === 'string'
          )
          .map((entry) => ({
            ...entry,
            resolvedPath: typeof entry.resolvedPath === 'string' ? entry.resolvedPath : null
          }))
      : []
    return { version: STORE_VERSION, plugins }
  }

  private async persist(next: StoredPluginFile): Promise<void> {
    await fs.mkdir(path.dirname(this.file()), { recursive: true })
    await writeJsonAtomic(this.file(), next)
  }

  private mutate(action: (file: StoredPluginFile) => StoredPluginFile): Promise<PluginEntry[]> {
    const run = this.chain.then(async () => {
      const current = await this.read()
      await this.persist(action(current))
    })
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run.then(() => this.list())
  }

  async list(): Promise<PluginEntry[]> {
    return (await this.read()).plugins
  }

  async enabledSpecs(): Promise<string[]> {
    return (await this.read()).plugins
      .filter((entry) => entry.enabled)
      .map((entry) => entry.resolvedPath ?? entry.spec)
  }

  async install(
    input: PluginInstallInput,
    workspace: string,
    appVersion: string
  ): Promise<PluginEntry[]> {
    const inspected = await inspectPlugin(
      input,
      workspace,
      appVersion,
      this.pluginRoot,
      this.installPackage
    )
    return this.mutate((file) => {
      const now = new Date().toISOString()
      const existing = file.plugins.find((entry) => entry.spec === inspected.spec)
      const entry: PluginEntry = existing
        ? { ...existing, ...inspected, enabled: true, updatedAt: now }
        : {
            id: randomUUID(),
            ...inspected,
            enabled: true,
            installedAt: now,
            updatedAt: now
          }
      return {
        version: STORE_VERSION,
        plugins: existing
          ? file.plugins.map((item) => (item.id === existing.id ? entry : item))
          : [...file.plugins, entry]
      }
    })
  }

  async setLoadErrors(
    specs: string[],
    errors: Array<{ spec: string; message: string }>
  ): Promise<PluginEntry[]> {
    const tracked = new Set(specs)
    const bySpec = new Map(errors.map((entry) => [entry.spec, entry.message]))
    if (tracked.size === 0) return this.list()
    return this.mutate((file) => ({
      version: STORE_VERSION,
      plugins: file.plugins.map((entry) => {
        if (!tracked.has(entry.resolvedPath ?? entry.spec)) return entry
        const error = bySpec.get(entry.resolvedPath ?? entry.spec) ?? null
        return entry.error === error ? entry : { ...entry, error }
      })
    }))
  }

  async update(id: string, patch: PluginUpdateInput): Promise<PluginEntry[]> {
    return this.mutate((file) => ({
      version: STORE_VERSION,
      plugins: file.plugins.map((entry) =>
        entry.id === id
          ? { ...entry, enabled: patch.enabled, updatedAt: new Date().toISOString() }
          : entry
      )
    }))
  }

  async remove(id: string): Promise<PluginEntry[]> {
    return this.mutate((file) => ({
      version: STORE_VERSION,
      plugins: file.plugins.filter((entry) => entry.id !== id)
    }))
  }
}
