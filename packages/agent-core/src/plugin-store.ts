import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  PluginCompatibility,
  PluginEntry,
  PluginInstallInput,
  PluginUpdateInput
} from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from './atomic-json'

const STORE_VERSION = 1

interface StoredPluginFile {
  version: 1
  plugins: PluginEntry[]
}

interface PluginPackageJson {
  name?: unknown
  version?: unknown
  engines?: { ateam?: unknown }
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
}

async function inspectPlugin(
  input: PluginInstallInput,
  workspace: string,
  appVersion: string
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
    return {
      spec,
      name: parsed.name,
      version: parsed.version,
      source,
      requiredVersion: null,
      compatibility: 'unknown',
      error: null
    }
  }

  const resolved = resolveLocalSpec(spec, directory)
  try {
    await fs.stat(resolved)
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
    error: null
  }
}

export class PluginStore {
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly userDataPath: string) {}

  private file(): string {
    return path.join(this.userDataPath, 'agent', 'plugins.json')
  }

  private async read(): Promise<StoredPluginFile> {
    const stored = await readJsonFile<unknown>(this.file())
    if (!stored || typeof stored !== 'object') return { version: STORE_VERSION, plugins: [] }
    const raw = stored as Partial<StoredPluginFile>
    const plugins = Array.isArray(raw.plugins)
      ? raw.plugins.filter(
          (entry): entry is PluginEntry =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            typeof (entry as PluginEntry).id === 'string' &&
            typeof (entry as PluginEntry).spec === 'string' &&
            typeof (entry as PluginEntry).name === 'string'
        )
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
    return (await this.read()).plugins.filter((entry) => entry.enabled).map((entry) => entry.spec)
  }

  async install(
    input: PluginInstallInput,
    workspace: string,
    appVersion: string
  ): Promise<PluginEntry[]> {
    const inspected = await inspectPlugin(input, workspace, appVersion)
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
