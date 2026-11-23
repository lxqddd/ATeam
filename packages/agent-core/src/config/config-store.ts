import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentConfig,
  AgentConfigDocument,
  ConfigDiagnostic,
  ConfigSources,
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
    parsed.document.skills = parsed.document.skills.map((entry) =>
      path.isAbsolute(entry) || entry.startsWith('~') ? entry : path.resolve(directory, entry)
    )
  }
  return { document: parsed.document, diagnostics: parsed.diagnostics }
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
      diagnostics
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
  return { config, sources, diagnostics }
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
    if ('lsp' in patch) next.lsp = patch.lsp
    if ('formatters' in patch) next.formatters = patch.formatters
    if ('formatterOverrides' in patch) next.formatterOverrides = patch.formatterOverrides
    if ('references' in patch) next.references = patch.references
    if ('skills' in patch) next.skills = patch.skills
    if ('plugins' in patch) next.plugins = patch.plugins
    if ('providers' in patch) next.providers = patch.providers
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
