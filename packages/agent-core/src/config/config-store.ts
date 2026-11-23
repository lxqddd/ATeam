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
  EffectiveAgentConfig
} from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '../atomic-json'
import { normalizeAgentConfigDocument } from './normalize'
import { anchorProjectDocument, mergeAgentConfig, readProjectConfigDetails } from './project-config'

export {
  normalizeFormatterOverrides,
  normalizeInstructions,
  normalizeReferences
} from './normalize'

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

function cloneConfig(config: AgentConfig): AgentConfig {
  return {
    snapshots: config.snapshots,
    instructions: [...config.instructions],
    lsp: config.lsp,
    formatters: config.formatters,
    formatterOverrides: { ...config.formatterOverrides },
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

async function readGlobalDocument(userDataPath: string): Promise<{
  document: AgentConfigDocument
  diagnostics: ConfigDiagnostic[]
}> {
  const file = configFile(userDataPath)
  const raw = await readJsonFile<unknown>(file)
  if (!raw) return { document: {}, diagnostics: [] }
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
      provenance: computeProvenance(global.document, null)
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
  return {
    config,
    sources,
    diagnostics,
    provenance: computeProvenance(global.document, project.document),
    projectMcpServers: project.document.mcp ?? []
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
  private document: AgentConfigDocument = {}

  constructor(private readonly userDataPath: string) {}

  async init(): Promise<void> {
    const global = await readGlobalDocument(this.userDataPath)
    this.document = global.document
    this.config = mergeAgentConfig({ ...DEFAULT_AGENT_CONFIG }, global.document, 'user')
  }

  get(): AgentConfig {
    return cloneConfig(this.config)
  }

  async update(patch: Partial<AgentConfig>): Promise<AgentConfig> {
    const next: AgentConfigDocument = { ...this.document }
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
              : {})
          }
        ])
      )
    }
    const normalized = normalizeAgentConfigDocument(next, configFile(this.userDataPath)).document
    this.document = normalized
    this.config = mergeAgentConfig({ ...DEFAULT_AGENT_CONFIG }, normalized, 'user')
    await fs.mkdir(path.dirname(configFile(this.userDataPath)), { recursive: true })
    await writeJsonAtomic(configFile(this.userDataPath), normalized)
    return this.get()
  }
}
