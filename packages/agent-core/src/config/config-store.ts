import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentConfig,
  AgentConfigDocument,
  ConfigDiagnostic,
  ConfigSources,
  ConfigFieldSource,
  ConfigProvenance,
  EffectiveAgentConfig,
  GlobalConfigFile,
  ProjectConfigEdit,
  RetryConfigInput,
  ToolOutputConfig
} from '@ateam/shared'
import { DEFAULT_RETRY_CONFIG, DEFAULT_TOOL_OUTPUT_LIMITS } from '@ateam/shared'
import { writeTextAtomic } from '../atomic-json'
import { normalizeAgentConfigDocument } from './normalize'
import { anchorProjectDocument, mergeAgentConfig, readProjectConfigDetails } from './project-config'
import { applyGlobalConfigEdits } from './project-config-edit'

export {
  normalizeFormatterOverrides,
  normalizeInstructions,
  normalizeReferences
} from './normalize'

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  snapshots: true,
  instructions: [],
  lsp: true,
  lspInstall: false,
  formatters: true,
  formatterOverrides: {},
  retry: { ...DEFAULT_RETRY_CONFIG },
  toolOutput: { ...DEFAULT_TOOL_OUTPUT_LIMITS },
  subagentDepth: 1
}

function cloneToolOutputConfig(config: ToolOutputConfig | undefined): ToolOutputConfig {
  const current: ToolOutputConfig = config ?? { ...DEFAULT_TOOL_OUTPUT_LIMITS }
  return {
    maxLines: current.maxLines,
    maxBytes: current.maxBytes,
    mode: current.mode,
    ...(current.tools
      ? {
          tools: Object.fromEntries(
            Object.entries(current.tools).map(([name, limits]) => [name, { ...limits }])
          )
        }
      : {})
  }
}

/** Absolute path of the global agent configuration document. */
export function globalAgentConfigPath(userDataPath: string): string {
  return path.join(userDataPath, 'agent', 'config.json')
}

const configFile = globalAgentConfigPath

function cloneConfig(config: AgentConfig): AgentConfig {
  return {
    snapshots: config.snapshots,
    instructions: [...config.instructions],
    lsp: config.lsp,
    lspInstall: config.lspInstall,
    formatters: config.formatters,
    formatterOverrides: { ...config.formatterOverrides },
    ...(config.retry ? { retry: { ...config.retry } } : {}),
    toolOutput: cloneToolOutputConfig(config.toolOutput),
    subagentDepth: config.subagentDepth ?? 1,
    ...(config.environment ? { environment: { ...config.environment } } : {}),
    ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
    ...(config.references ? { references: config.references.map((ref) => ({ ...ref })) } : {}),
    ...(config.permissionRules
      ? { permissionRules: config.permissionRules.map((rule) => ({ ...rule })) }
      : {}),
    ...(config.mcpServers
      ? { mcpServers: config.mcpServers.map((server) => ({ ...server })) }
      : {}),
    ...(config.agents ? { agents: config.agents } : {}),
    ...(config.providers
      ? {
          providers: Object.fromEntries(
            Object.entries(config.providers).map(([id, provider]) => [
              id,
              { ...provider, ...(provider.models ? { models: { ...provider.models } } : {}) }
            ])
          )
        }
      : {}),
    ...(config.plugins ? { plugins: [...config.plugins] } : {}),
    ...(config.lspServers ? { lspServers: { ...config.lspServers } } : {}),
    ...(config.formatterServers ? { formatterServers: { ...config.formatterServers } } : {}),
    ...(config.commands ? { commands: config.commands.map((command) => ({ ...command })) } : {}),
    ...(config.skills ? { skills: [...config.skills] } : {})
  }
}

const BOM = String.fromCharCode(0xfeff)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type ParsedGlobalContent =
  { ok: true; value: unknown; hasBom: boolean } | { ok: false; error: string; hasBom: boolean }

/** Strict JSON: strips and records a leading BOM; comments and trailing commas fail. */
function parseGlobalContent(content: string): ParsedGlobalContent {
  const hasBom = content.startsWith(BOM)
  const body = hasBom ? content.slice(BOM.length) : content
  try {
    return { ok: true, value: JSON.parse(body) as unknown, hasBom }
  } catch (error) {
    return { ok: false, error: errorMessage(error), hasBom }
  }
}

interface GlobalState {
  /** Unanchored raw document; relative skills keep their written form. */
  raw: Record<string, unknown>
  document: AgentConfigDocument
  diagnostics: ConfigDiagnostic[]
  hasBom: boolean
}

function emptyGlobalState(hasBom = false): GlobalState {
  return { raw: {}, document: {}, diagnostics: [], hasBom }
}

function globalStateFromContent(content: string, file: string): GlobalState {
  const parsed = parseGlobalContent(content)
  if (!parsed.ok) return emptyGlobalState(parsed.hasBom)
  const normalized = normalizeGlobalRaw(parsed.value, file)
  return {
    raw: isPlainObject(parsed.value) ? parsed.value : {},
    document: normalized.document,
    diagnostics: normalized.diagnostics,
    hasBom: parsed.hasBom
  }
}

async function readGlobalDocument(userDataPath: string): Promise<GlobalState> {
  const file = configFile(userDataPath)
  let content: string
  try {
    content = await fs.readFile(file, 'utf8')
  } catch {
    return emptyGlobalState()
  }
  return globalStateFromContent(content, file)
}

/**
 * Reads the global document for a hot reload. Returns `null` when the file is
 * temporarily unreadable or not valid JSON (for example mid-save in an external
 * editor): the caller must keep its previous state instead of resetting it.
 */
async function readGlobalDocumentStrict(userDataPath: string): Promise<GlobalState | null> {
  const file = configFile(userDataPath)
  let content: string
  try {
    content = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyGlobalState()
    return null
  }
  const parsed = parseGlobalContent(content)
  if (!parsed.ok) return null
  const normalized = normalizeGlobalRaw(parsed.value, file)
  return {
    raw: isPlainObject(parsed.value) ? parsed.value : {},
    document: normalized.document,
    diagnostics: normalized.diagnostics,
    hasBom: parsed.hasBom
  }
}

function normalizeGlobalRaw(
  raw: unknown,
  file: string
): { document: AgentConfigDocument; diagnostics: ConfigDiagnostic[] } {
  const parsed = normalizeAgentConfigDocument(raw, file)
  const directory = path.dirname(file)
  if (parsed.document.skills) {
    parsed.document.skills = parsed.document.skills.map((entry) => {
      if (entry === '~') return os.homedir()
      if (entry.startsWith('~/')) return path.join(os.homedir(), entry.slice(2))
      return path.isAbsolute(entry) ? entry : path.resolve(directory, entry)
    })
  }
  return { document: parsed.document, diagnostics: parsed.diagnostics }
}

/**
 * Known top-level document keys, including legacy aliases. Anything else is
 * preserved verbatim by `mergeKnownIntoRaw`.
 */
const KNOWN_DOCUMENT_KEYS = new Set<string>([
  'snapshots',
  'instructions',
  'lspEnabled',
  'lspInstall',
  'lsp',
  'formattersEnabled',
  'formatters',
  'formatterOverrides',
  'references',
  'permissions',
  'permissionRules',
  'mcp',
  'mcpServers',
  'agents',
  'providers',
  'plugins',
  'commands',
  'skills',
  'retry',
  'toolOutput',
  'subagentDepth',
  'environment',
  'systemPrompt'
])

/**
 * Rewrites known top-level fields of `raw` from `normalized` while keeping
 * unknown fields in their original order. Built with `Object.fromEntries` so a
 * literal `__proto__` key stays an own data property.
 */
function mergeKnownIntoRaw(
  raw: Record<string, unknown>,
  normalized: AgentConfigDocument
): Record<string, unknown> {
  const normalizedRecord = normalized as unknown as Record<string, unknown>
  const entries: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN_DOCUMENT_KEYS.has(key)) {
      if (Object.prototype.hasOwnProperty.call(normalizedRecord, key)) {
        entries.push([key, normalizedRecord[key]])
      }
      continue
    }
    entries.push([key, value])
  }
  const present = new Set(entries.map(([key]) => key))
  for (const [key, value] of Object.entries(normalizedRecord)) {
    if (present.has(key) || value === undefined) continue
    entries.push([key, value])
  }
  return Object.fromEntries(entries)
}

/**
 * Snapshot for the global config editors. `content` keeps a leading BOM and
 * `raw` stays unanchored, so relative skills round-trip unchanged.
 */
export async function readGlobalConfigFile(userDataPath: string): Promise<GlobalConfigFile> {
  const file = configFile(userDataPath)
  let content: string
  try {
    content = await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path: file, exists: false, content: '', diagnostics: [], document: {} }
    }
    return {
      path: file,
      exists: true,
      content: '',
      diagnostics: [
        {
          source: file,
          path: '$',
          severity: 'error',
          message: `unable to read config: ${errorMessage(error)}`
        }
      ],
      document: {}
    }
  }
  const parsed = parseGlobalContent(content)
  if (!parsed.ok) {
    return {
      path: file,
      exists: true,
      content,
      diagnostics: [
        {
          source: file,
          path: '$',
          severity: 'error',
          message: `invalid JSON: ${parsed.error}`
        }
      ],
      document: {}
    }
  }
  if (!isPlainObject(parsed.value)) {
    return {
      path: file,
      exists: true,
      content,
      diagnostics: [
        {
          source: file,
          path: '$',
          severity: 'error',
          message: 'the config root must be a JSON object'
        }
      ],
      document: {}
    }
  }
  const normalized = normalizeGlobalRaw(parsed.value, file)
  return {
    path: file,
    exists: true,
    content,
    diagnostics: normalized.diagnostics,
    document: normalized.document,
    raw: parsed.value
  }
}

export async function writeGlobalConfigFile(
  userDataPath: string,
  content: string
): Promise<GlobalConfigFile> {
  const file = configFile(userDataPath)
  const parsed = parseGlobalContent(content)
  if (!parsed.ok) throw new Error(`INVALID_GLOBAL_CONFIG: ${parsed.error}`)
  if (!isPlainObject(parsed.value)) {
    throw new Error('INVALID_GLOBAL_CONFIG: the config root must be a JSON object')
  }
  await writeTextAtomic(file, content, 0o600)
  return readGlobalConfigFile(userDataPath)
}

function fieldSource(
  globalPresent: boolean,
  projectPresent: boolean,
  merged = false
): ConfigFieldSource {
  if (projectPresent) return merged && globalPresent ? 'merged' : 'project'
  return globalPresent ? 'global' : 'default'
}

function computeProvenance(
  globalDocument: AgentConfigDocument,
  projectDocument: AgentConfigDocument | null
): ConfigProvenance {
  const project = projectDocument ?? {}
  const hasProviders = (value: AgentConfigDocument['providers']): boolean =>
    Array.isArray(value) ? value.length > 0 : Boolean(value && Object.keys(value).length > 0)
  const hasCommands = (value: AgentConfigDocument['commands']): boolean =>
    Array.isArray(value) ? value.length > 0 : Boolean(value && Object.keys(value).length > 0)
  return {
    snapshots: fieldSource(globalDocument.snapshots !== undefined, project.snapshots !== undefined),
    instructions: fieldSource(
      (globalDocument.instructions?.length ?? 0) > 0,
      (project.instructions?.length ?? 0) > 0,
      true
    ),
    lsp: fieldSource(
      globalDocument.lsp !== undefined || globalDocument.lspEnabled !== undefined,
      project.lsp !== undefined || project.lspEnabled !== undefined
    ),
    formatters: fieldSource(
      globalDocument.formatters !== undefined || globalDocument.formattersEnabled !== undefined,
      project.formatters !== undefined || project.formattersEnabled !== undefined
    ),
    references: fieldSource(
      Array.isArray(globalDocument.references) && globalDocument.references.length > 0,
      Array.isArray(project.references) && project.references.length > 0,
      true
    ),
    permissions: fieldSource(
      (globalDocument.permissions?.length ?? 0) > 0,
      (project.permissions?.length ?? 0) > 0,
      true
    ),
    mcp: fieldSource((globalDocument.mcp?.length ?? 0) > 0, (project.mcp?.length ?? 0) > 0, true),
    agents: fieldSource(
      (globalDocument.agents?.length ?? 0) > 0,
      (project.agents?.length ?? 0) > 0,
      true
    ),
    providers: fieldSource(
      hasProviders(globalDocument.providers),
      hasProviders(project.providers),
      true
    ),
    plugins: fieldSource(
      (globalDocument.plugins?.length ?? 0) > 0,
      (project.plugins?.length ?? 0) > 0,
      true
    ),
    commands: fieldSource(
      hasCommands(globalDocument.commands),
      hasCommands(project.commands),
      true
    ),
    skills: fieldSource(
      (globalDocument.skills?.length ?? 0) > 0,
      (project.skills?.length ?? 0) > 0,
      true
    ),
    retry: fieldSource(
      Boolean(globalDocument.retry && Object.keys(globalDocument.retry).length > 0),
      Boolean(project.retry && Object.keys(project.retry).length > 0),
      true
    ),
    environment: fieldSource(
      Boolean(globalDocument.environment && Object.keys(globalDocument.environment).length > 0),
      Boolean(project.environment && Object.keys(project.environment).length > 0),
      true
    ),
    toolOutput: fieldSource(
      Boolean(globalDocument.toolOutput && Object.keys(globalDocument.toolOutput).length > 0),
      Boolean(project.toolOutput && Object.keys(project.toolOutput).length > 0),
      true
    ),
    systemPrompt: fieldSource(
      globalDocument.systemPrompt !== undefined,
      project.systemPrompt !== undefined
    )
  }
}

export async function readEffectiveAgentConfig(
  userDataPath: string,
  workspacePath?: string
): Promise<EffectiveAgentConfig> {
  const globalFile = configFile(userDataPath)
  const global = await readGlobalDocument(userDataPath)
  const base = mergeAgentConfig({ ...DEFAULT_AGENT_CONFIG }, global.document, 'user')
  const diagnostics = [...global.diagnostics]
  const globalPermissionRules = global.document.permissions ?? global.document.permissionRules ?? []

  if (!workspacePath) {
    return {
      config: base,
      sources: {
        globalConfigPath: globalFile,
        projectConfigPath: null,
        projectConfigDir: null,
        projectRoot: userDataPath
      },
      diagnostics,
      provenance: computeProvenance(global.document, null),
      ...(globalPermissionRules.length > 0 ? { globalPermissionRules } : {})
    }
  }

  const project = await readProjectConfigDetails(workspacePath)
  diagnostics.push(...project.diagnostics)
  const projectDocument = project.directory
    ? anchorProjectDocument(project.document, project.directory)
    : project.document
  const config = mergeAgentConfig(base, projectDocument, 'project')
  const sources: ConfigSources = {
    globalConfigPath: globalFile,
    projectConfigPath: project.path,
    projectConfigDir: project.directory,
    projectRoot: project.root
  }
  const projectProviders =
    project.document.providers && !Array.isArray(project.document.providers)
      ? project.document.providers
      : undefined
  const projectPermissionRules =
    project.document.permissions ?? project.document.permissionRules ?? []
  return {
    config,
    sources,
    diagnostics,
    provenance: computeProvenance(global.document, project.document),
    projectMcpServers: project.document.mcp ?? [],
    ...(projectProviders ? { projectProviders } : {}),
    ...(globalPermissionRules.length > 0 ? { globalPermissionRules } : {}),
    ...(projectPermissionRules.length > 0 ? { projectPermissionRules } : {})
  }
}

export async function readAgentConfig(
  userDataPath: string,
  workspacePath?: string
): Promise<AgentConfig> {
  return (await readEffectiveAgentConfig(userDataPath, workspacePath)).config
}

export class AgentConfigStore {
  private config: AgentConfig = { ...DEFAULT_AGENT_CONFIG }
  /** Unanchored raw document; the write baseline that keeps unknown fields. */
  private rawDocument: Record<string, unknown> = {}
  private hasBom = false
  /** Serializes init/reload/update so a hot reload never interleaves with a save. */
  private operation: Promise<unknown> = Promise.resolve()

  constructor(private readonly userDataPath: string) {}

  async init(): Promise<void> {
    await this.serialize(async () => {
      this.setState(await readGlobalDocument(this.userDataPath))
    })
  }

  get(): AgentConfig {
    return cloneConfig(this.config)
  }

  /**
   * Re-reads the global document from disk after an external edit.
   * A temporarily unreadable or invalid file keeps the current in-memory state.
   */
  async reload(): Promise<void> {
    await this.serialize(async () => {
      const state = await readGlobalDocumentStrict(this.userDataPath)
      if (state) this.setState(state)
    })
  }

  /**
   * Applies path-level edits to the strict-JSON global file. Unknown top-level
   * fields and untouched siblings are kept; memory refreshes only after the
   * write succeeds. A missing file is seeded from `{}` and created on first
   * effective edit.
   */
  async edit(edits: ProjectConfigEdit[]): Promise<GlobalConfigFile> {
    return this.serialize(async () => {
      const file = configFile(this.userDataPath)
      let content: string | null = null
      try {
        content = await fs.readFile(file, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (content !== null) {
        const parsed = parseGlobalContent(content)
        if (!parsed.ok) throw new Error(`INVALID_GLOBAL_CONFIG: ${parsed.error}`)
        if (!isPlainObject(parsed.value)) {
          throw new Error('INVALID_GLOBAL_CONFIG: the config root must be a JSON object')
        }
      }
      const source = content ?? '{}'
      const next = applyGlobalConfigEdits(source, edits)
      if (next !== source) {
        await writeTextAtomic(file, next, 0o600)
      }
      const snapshot = await readGlobalConfigFile(this.userDataPath)
      this.setState(this.stateFromSnapshot(snapshot))
      return snapshot
    })
  }

  /** Replaces the whole global file (Raw editor); validates before writing. */
  async writeContent(content: string): Promise<GlobalConfigFile> {
    return this.serialize(async () => {
      const file = configFile(this.userDataPath)
      const parsed = parseGlobalContent(content)
      if (!parsed.ok) throw new Error(`INVALID_GLOBAL_CONFIG: ${parsed.error}`)
      if (!isPlainObject(parsed.value)) {
        throw new Error('INVALID_GLOBAL_CONFIG: the config root must be a JSON object')
      }
      await writeTextAtomic(file, content, 0o600)
      const snapshot = await readGlobalConfigFile(this.userDataPath)
      this.setState(this.stateFromSnapshot(snapshot))
      return snapshot
    })
  }

  async update(
    patch: Omit<Partial<AgentConfig>, 'retry'> & { retry?: RetryConfigInput }
  ): Promise<AgentConfig> {
    return this.serialize(() => this.applyUpdate(patch))
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.operation.then(task, task)
    this.operation = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private setState(state: GlobalState): void {
    this.rawDocument = state.raw
    this.hasBom = state.hasBom
    this.config = mergeAgentConfig({ ...DEFAULT_AGENT_CONFIG }, state.document, 'user')
  }

  private stateFromSnapshot(snapshot: GlobalConfigFile): GlobalState {
    return {
      raw: isPlainObject(snapshot.raw) ? snapshot.raw : {},
      document: snapshot.document,
      diagnostics: snapshot.diagnostics,
      hasBom: snapshot.content.startsWith(BOM)
    }
  }

  private async applyUpdate(
    patch: Omit<Partial<AgentConfig>, 'retry'> & { retry?: RetryConfigInput }
  ): Promise<AgentConfig> {
    const file = configFile(this.userDataPath)
    // Build from the unanchored raw document so relative skills stay relative.
    const base = normalizeAgentConfigDocument(this.rawDocument, file).document
    const next: AgentConfigDocument = { ...base }
    if ('snapshots' in patch) next.snapshots = patch.snapshots
    if ('instructions' in patch) next.instructions = patch.instructions
    if ('lsp' in patch) {
      if (next.lsp && typeof next.lsp === 'object') next.lspEnabled = patch.lsp
      else next.lsp = patch.lsp
    }
    if ('formatters' in patch) {
      if (next.formatters && typeof next.formatters === 'object') {
        next.formattersEnabled = patch.formatters
      } else next.formatters = patch.formatters
    }
    if ('formatterOverrides' in patch) next.formatterOverrides = patch.formatterOverrides
    if ('retry' in patch && patch.retry) next.retry = patch.retry
    if ('toolOutput' in patch && patch.toolOutput) next.toolOutput = patch.toolOutput
    if ('subagentDepth' in patch) next.subagentDepth = patch.subagentDepth
    if ('environment' in patch) next.environment = patch.environment
    if ('systemPrompt' in patch) next.systemPrompt = patch.systemPrompt
    if ('references' in patch) next.references = patch.references
    if ('skills' in patch) next.skills = patch.skills
    if ('plugins' in patch) next.plugins = patch.plugins
    if ('providers' in patch) next.providers = patch.providers
    if ('permissionRules' in patch) next.permissions = patch.permissionRules
    if ('mcpServers' in patch) next.mcp = patch.mcpServers
    if ('agents' in patch) next.agents = patch.agents
    if ('lspServers' in patch) {
      if (patch.lspServers) {
        next.lsp = patch.lspServers
        if ('lsp' in patch) next.lspEnabled = patch.lsp
      } else if (!('lsp' in patch)) {
        delete next.lsp
      }
    }
    if ('formatterServers' in patch) {
      if (patch.formatterServers) {
        next.formatters = patch.formatterServers
        if ('formatters' in patch) next.formattersEnabled = patch.formatters
      } else if (!('formatters' in patch)) {
        delete next.formatters
      }
    }
    if ('commands' in patch && patch.commands) {
      next.commands = Object.fromEntries(
        patch.commands.map((command) => [
          command.name,
          {
            template: command.template,
            description: command.description,
            ...(command.agent ? { agent: command.agent } : {}),
            ...(command.model
              ? { model: `${command.model.providerId}/${command.model.modelId}` }
              : {}),
            ...(command.subtask !== undefined ? { subtask: command.subtask } : {})
          }
        ])
      )
    }
    const normalized = normalizeAgentConfigDocument(next, file).document
    const merged = mergeKnownIntoRaw(this.rawDocument, normalized)
    const body = JSON.stringify(merged, null, 2)
    await writeTextAtomic(file, this.hasBom ? `${BOM}${body}` : body, 0o600)
    const runtime = normalizeGlobalRaw(merged, file)
    this.rawDocument = merged
    this.config = mergeAgentConfig({ ...DEFAULT_AGENT_CONFIG }, runtime.document, 'user')
    return this.get()
  }
}
