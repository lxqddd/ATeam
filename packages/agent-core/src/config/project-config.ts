import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser'
import type {
  AgentConfig,
  AgentConfigDocument,
  AgentReference,
  CommandDefinition,
  ConfigDiagnostic,
  FormatterConfigInput,
  LspServerConfigInput,
  McpServerInput,
  ProjectConfigFile,
  ProviderConfigInput
} from '@ateam/shared'
import { parseCommandJson } from '../commands'
import { normalizeAgentConfigDocument, type ParsedConfigDocument } from './normalize'
import { findProjectRoot } from './project-root'

export { findProjectRoot } from './project-root'

export type ProjectConfig = AgentConfigDocument

const CONFIG_NAMES = ['ateam.json', 'ateam.jsonc'] as const

export interface ProjectConfigDetails {
  document: AgentConfigDocument
  path: string | null
  directory: string | null
  root: string
  diagnostics: ConfigDiagnostic[]
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

export async function readProjectConfigFile(workspacePath: string): Promise<ProjectConfigFile> {
  const root = await findProjectRoot(workspacePath)
  const existing = await findProjectConfig(workspacePath)
  const file = existing ?? path.join(root, CONFIG_NAMES[0])
  const directory = path.dirname(file)
  if (!existing) {
    return { path: file, directory, root, exists: false, content: '', diagnostics: [] }
  }
  try {
    const content = await fs.readFile(file, 'utf8')
    const parsed = parseProjectConfigDocument(content, file)
    return {
      path: file,
      directory,
      root,
      exists: true,
      content,
      diagnostics: parsed.diagnostics
    }
  } catch (error) {
    return {
      path: file,
      directory,
      root,
      exists: true,
      content: '',
      diagnostics: [
        {
          source: file,
          path: '$',
          severity: 'error',
          message: `unable to read config: ${error instanceof Error ? error.message : 'unknown error'}`
        }
      ]
    }
  }
}

export async function writeProjectConfigFile(
  workspacePath: string,
  content: string
): Promise<ProjectConfigFile> {
  const root = await findProjectRoot(workspacePath)
  const existing = await findProjectConfig(workspacePath)
  const file = existing ?? path.join(root, CONFIG_NAMES[0])
  const parsed = parseProjectConfigDocument(content, file)
  const errors = parsed.diagnostics.filter((entry) => entry.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`INVALID_PROJECT_CONFIG: ${errors[0].message}`)
  }
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o644 })
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  return readProjectConfigFile(workspacePath)
}

export async function findProjectConfig(workspacePath: string): Promise<string | null> {
  const root = await findProjectRoot(workspacePath)
  for (const name of CONFIG_NAMES) {
    const file = path.join(root, name)
    if (await fileExists(file)) return file
  }
  return null
}

export function parseProjectConfigDocument(content: string, source: string): ParsedConfigDocument {
  const errors: ParseError[] = []
  const raw = parseJsonc(content, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    const messages = errors
      .slice(0, 10)
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
    return {
      document: {},
      diagnostics: [
        {
          source,
          path: '$',
          severity: 'error',
          message: `invalid JSONC: ${messages.join('; ')}`
        }
      ]
    }
  }
  return normalizeAgentConfigDocument(raw, source)
}

export function parseProjectConfigContent(content: string): ProjectConfig {
  return parseProjectConfigDocument(content, '<project-config>').document
}

export async function readProjectConfigDetails(
  workspacePath: string
): Promise<ProjectConfigDetails> {
  const root = await findProjectRoot(workspacePath)
  let file: string | null = null
  for (const name of CONFIG_NAMES) {
    const candidate = path.join(root, name)
    if (await fileExists(candidate)) {
      file = candidate
      break
    }
  }
  if (!file) {
    return { document: {}, path: null, directory: null, root, diagnostics: [] }
  }
  try {
    const content = await fs.readFile(file, 'utf8')
    const parsed = parseProjectConfigDocument(content, file)
    return {
      document: parsed.document,
      path: file,
      directory: path.dirname(file),
      root,
      diagnostics: parsed.diagnostics
    }
  } catch (error) {
    return {
      document: {},
      path: file,
      directory: path.dirname(file),
      root,
      diagnostics: [
        {
          source: file,
          path: '$',
          severity: 'error',
          message: `unable to read config: ${error instanceof Error ? error.message : 'unknown error'}`
        }
      ]
    }
  }
}

export async function readProjectConfig(workspacePath: string): Promise<ProjectConfig> {
  return (await readProjectConfigDetails(workspacePath)).document
}

function anchorPath(value: string, directory: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  if (path.isAbsolute(trimmed)) return trimmed
  return path.resolve(directory, trimmed)
}

function anchorPlugin(spec: string, directory: string): string {
  const trimmed = spec.trim()
  if (!trimmed) return trimmed
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2))
  if (path.isAbsolute(trimmed) || trimmed.startsWith('.')) return path.resolve(directory, trimmed)
  return trimmed
}

/** Resolve project-relative paths before merging. Global entries are left untouched. */
export function anchorProjectDocument(
  document: AgentConfigDocument,
  directory: string
): AgentConfigDocument {
  const anchored: AgentConfigDocument = { ...document }
  if (document.instructions) {
    anchored.instructions = document.instructions.map((entry) => anchorPath(entry, directory))
  }
  if (document.references) {
    if (Array.isArray(document.references)) {
      anchored.references = document.references.map((reference) => ({
        ...reference,
        ...(reference.path ? { path: anchorPath(reference.path, directory) } : {})
      }))
    }
  }
  if (document.plugins) {
    anchored.plugins = document.plugins.map((entry) => anchorPlugin(entry, directory))
  }
  if (document.skills) {
    anchored.skills = document.skills.map((entry) => anchorPath(entry, directory))
  }
  return anchored
}

function mergeReferences(
  base: AgentReference[] | undefined,
  project: AgentReference[] | undefined
): AgentReference[] | undefined {
  if (!base && !project) return undefined
  const byAlias = new Map<string, AgentReference>()
  for (const reference of base ?? []) byAlias.set(reference.alias, reference)
  for (const reference of project ?? []) byAlias.set(reference.alias, reference)
  return byAlias.size > 0 ? [...byAlias.values()] : undefined
}

function mergeMcpServers(
  base: McpServerInput[] | undefined,
  project: McpServerInput[] | undefined
): McpServerInput[] | undefined {
  if (!base && !project) return undefined
  const byName = new Map<string, McpServerInput>()
  for (const server of base ?? []) byName.set(server.name, server)
  for (const server of project ?? []) byName.set(server.name, server)
  return byName.size > 0 ? [...byName.values()] : undefined
}

function mergeServerConfigs<T extends { disabled?: boolean }>(
  base: Record<string, T> | undefined,
  project: Record<string, T> | undefined
): Record<string, T> | undefined {
  if (!base && !project) return undefined
  const merged: Record<string, T> = { ...(base ?? {}) }
  for (const [id, value] of Object.entries(project ?? {})) {
    merged[id] = { ...(base?.[id] ?? {}), ...value }
  }
  return merged
}

function mergeProviderConfigs(
  base: Record<string, ProviderConfigInput> | undefined,
  project: Record<string, ProviderConfigInput> | undefined
): Record<string, ProviderConfigInput> | undefined {
  if (!base && !project) return undefined
  const merged: Record<string, ProviderConfigInput> = { ...(base ?? {}) }
  for (const [id, provider] of Object.entries(project ?? {})) {
    const previous = merged[id]
    merged[id] = {
      ...(previous ?? {}),
      ...provider,
      ...(previous?.models || provider.models
        ? {
            models: Object.fromEntries(
              Array.from(
                new Set([
                  ...Object.keys(previous?.models ?? {}),
                  ...Object.keys(provider.models ?? {})
                ])
              ).map((modelId) => [
                modelId,
                {
                  ...(previous?.models?.[modelId] ?? {}),
                  ...(provider.models?.[modelId] ?? {})
                }
              ])
            )
          }
        : {})
    }
  }
  return merged
}

function mergeCommands(
  base: CommandDefinition[] | undefined,
  project: Record<string, import('@ateam/shared').CommandConfigInput> | undefined,
  source: 'user' | 'project'
): CommandDefinition[] | undefined {
  if (!base && !project) return undefined
  const byName = new Map<string, CommandDefinition>()
  for (const command of base ?? []) byName.set(command.name.toLowerCase(), command)
  for (const [name, input] of Object.entries(project ?? {})) {
    const parsed = parseCommandJson({ name, ...input }, source)
    if (parsed) byName.set(parsed.name.toLowerCase(), parsed)
  }
  return byName.size > 0 ? [...byName.values()] : undefined
}

function mergeStrings(
  base: string[] | undefined,
  project: string[] | undefined
): string[] | undefined {
  if (!base && !project) return undefined
  const values = [...new Set([...(base ?? []), ...(project ?? [])])]
  return values.length > 0 ? values : undefined
}

/**
 * Merge a project document over an already-effective global config.
 * Project path anchoring is performed by `anchorProjectDocument` before this call.
 */
export function mergeAgentConfig(
  base: AgentConfig,
  project: ProjectConfig,
  commandSource: 'user' | 'project' = 'project'
): AgentConfig {
  const instructions = mergeStrings(base.instructions, project.instructions) ?? []
  const permissionRules = [...(base.permissionRules ?? []), ...(project.permissions ?? [])]
  let lsp = base.lsp
  let lspServers: Record<string, LspServerConfigInput> | undefined = base.lspServers
  if (project.lsp === false) {
    lsp = false
  } else if (project.lsp === true) {
    lsp = true
    lspServers = undefined
  } else if (project.lsp) {
    lsp = project.lspEnabled ?? true
    lspServers = mergeServerConfigs(base.lspServers, project.lsp)
  } else if (project.lspEnabled !== undefined) {
    lsp = project.lspEnabled
  }
  let formatters = base.formatters
  let formatterServers: Record<string, FormatterConfigInput> | undefined = base.formatterServers
  if (project.formatters === false) {
    formatters = false
  } else if (project.formatters === true) {
    formatters = true
    formatterServers = undefined
  } else if (project.formatters) {
    formatters = project.formattersEnabled ?? true
    formatterServers = mergeServerConfigs(base.formatterServers, project.formatters)
  } else if (project.formattersEnabled !== undefined) {
    formatters = project.formattersEnabled
  }
  const references = mergeReferences(
    base.references,
    Array.isArray(project.references) ? project.references : undefined
  )
  const mcpServers = mergeMcpServers(base.mcpServers, project.mcp)
  const projectProviders =
    project.providers && !Array.isArray(project.providers) ? project.providers : undefined
  const providers = mergeProviderConfigs(base.providers, projectProviders)
  const projectCommands =
    project.commands && !Array.isArray(project.commands) ? project.commands : undefined
  const commands = mergeCommands(base.commands, projectCommands, commandSource)
  const skills = mergeStrings(base.skills, project.skills)
  const plugins = mergeStrings(base.plugins, project.plugins)
  const agents = [...(base.agents ?? []), ...(project.agents ?? [])]
  return {
    snapshots: project.snapshots ?? base.snapshots,
    lsp,
    formatters,
    instructions,
    formatterOverrides: {
      ...base.formatterOverrides,
      ...(project.formatterOverrides ?? {})
    },
    ...(lspServers ? { lspServers } : {}),
    ...(formatterServers ? { formatterServers } : {}),
    ...(references ? { references } : {}),
    ...(permissionRules.length > 0 ? { permissionRules } : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(agents.length > 0 ? { agents } : {}),
    ...(providers ? { providers } : {}),
    ...(plugins ? { plugins } : {}),
    ...(commands ? { commands } : {}),
    ...(skills ? { skills } : {})
  }
}
