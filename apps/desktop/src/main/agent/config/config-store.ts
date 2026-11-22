import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentConfig, AgentReference } from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '../atomic-json'

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  snapshots: true,
  instructions: [],
  lsp: true,
  formatters: true,
  formatterOverrides: {}
}

function configFile(userDataPath: string): string {
  return path.join(userDataPath, 'agent', 'config.json')
}

function normalizeFormatterOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const overrides: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(overrides).length >= 50) break
    if (typeof rawValue !== 'string') continue
    const trimmedKey = rawKey.trim().toLowerCase()
    const extension = trimmedKey.startsWith('.') ? trimmedKey : `.${trimmedKey}`
    if (!/^\.[a-z0-9+]{1,15}$/.test(extension)) continue
    const formatter = rawValue.trim().toLowerCase()
    if (formatter !== 'none' && !/^[a-z0-9_-]{1,40}$/.test(formatter)) continue
    overrides[extension] = formatter
  }
  return overrides
}

const REFERENCE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function normalizeReferences(value: unknown): AgentReference[] {
  if (!value) return []
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((entry) => [
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { alias?: unknown }).alias === 'string'
          ? String((entry as { alias: string }).alias)
          : '',
        entry
      ])
    : typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>)
      : []
  const byAlias = new Map<string, AgentReference>()
  for (const [key, raw] of entries) {
    if (byAlias.size >= 50) break
    const entry =
      typeof raw === 'string'
        ? /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw.trim()) && !raw.trim().startsWith('.')
          ? { repository: raw.trim() }
          : { path: raw }
        : raw && typeof raw === 'object'
          ? raw
          : null
    if (!entry) continue
    const rawEntry = entry as Record<string, unknown>
    const alias = String(rawEntry.alias ?? key).trim()
    if (!REFERENCE_ALIAS.test(alias)) continue
    const pathValue =
      typeof rawEntry.path === 'string' && rawEntry.path.trim() ? rawEntry.path.trim() : null
    const repository =
      typeof rawEntry.repository === 'string' && rawEntry.repository.trim()
        ? rawEntry.repository.trim()
        : null
    if (Boolean(pathValue) === Boolean(repository)) continue
    const branch =
      repository && typeof rawEntry.branch === 'string' && rawEntry.branch.trim()
        ? rawEntry.branch.trim().slice(0, 200)
        : null
    const description =
      typeof rawEntry.description === 'string' && rawEntry.description.trim()
        ? rawEntry.description.trim().slice(0, 500)
        : null
    byAlias.set(alias, {
      alias,
      ...(pathValue ? { path: pathValue.slice(0, 1_000) } : {}),
      ...(repository ? { repository: repository.slice(0, 500) } : {}),
      ...(branch ? { branch } : {}),
      ...(description ? { description } : {}),
      ...(rawEntry.hidden === true ? { hidden: true } : {})
    })
  }
  return [...byAlias.values()]
}

function normalizeInstructions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ]
}

function normalizeConfig(value: unknown): AgentConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AGENT_CONFIG }
  const config = value as Partial<AgentConfig>
  return {
    snapshots: typeof config.snapshots === 'boolean' ? config.snapshots : true,
    instructions: normalizeInstructions(config.instructions),
    lsp: typeof config.lsp === 'boolean' ? config.lsp : true,
    formatters: typeof config.formatters === 'boolean' ? config.formatters : true,
    formatterOverrides: normalizeFormatterOverrides(config.formatterOverrides),
    ...(normalizeReferences(config.references).length > 0
      ? { references: normalizeReferences(config.references) }
      : {})
  }
}

export async function readAgentConfig(userDataPath: string): Promise<AgentConfig> {
  return normalizeConfig(await readJsonFile<unknown>(configFile(userDataPath)))
}

export class AgentConfigStore {
  private config: AgentConfig = { ...DEFAULT_AGENT_CONFIG }

  constructor(private readonly userDataPath: string) {}

  async init(): Promise<void> {
    this.config = await readAgentConfig(this.userDataPath)
  }

  get(): AgentConfig {
    return {
      snapshots: this.config.snapshots,
      instructions: [...this.config.instructions],
      lsp: this.config.lsp,
      formatters: this.config.formatters,
      formatterOverrides: { ...this.config.formatterOverrides },
      ...(this.config.references
        ? { references: this.config.references.map((ref) => ({ ...ref })) }
        : {})
    }
  }

  async update(patch: Partial<AgentConfig>): Promise<AgentConfig> {
    this.config = normalizeConfig({ ...this.config, ...patch })
    await fs.mkdir(path.dirname(configFile(this.userDataPath)), { recursive: true })
    await writeJsonAtomic(configFile(this.userDataPath), this.config)
    return this.get()
  }
}
