import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentDefinition,
  AgentMode,
  AgentPermissionRule,
  ModelRef,
  PermissionEffect,
  PermissionRuleAction
} from '@ateam/shared'
import { readJsonFile } from '../atomic-json'
import type { ToolSet } from 'ai'

const MAX_STEPS_LIMIT = 100
const MODES: readonly AgentMode[] = ['primary', 'subagent', 'all']
const READ_TOOLS = ['read', 'list', 'grep', 'glob']
const RULE_ACTIONS: readonly PermissionRuleAction[] = [
  'read',
  'list',
  'glob',
  'grep',
  'write',
  'edit',
  'shell',
  'external_directory',
  'mcp',
  'webfetch',
  'websearch',
  'skill',
  'subagent',
  '*'
]
const RULE_EFFECTS: readonly PermissionEffect[] = ['allow', 'ask', 'deny']

export const BUILTIN_AGENTS: readonly AgentDefinition[] = [
  {
    id: 'build',
    name: 'build',
    description: 'General coding agent with the full toolset.',
    mode: 'primary',
    model: null,
    tools: null,
    permissions: [],
    temperature: null,
    maxSteps: null,
    prompt: '',
    source: 'builtin'
  },
  {
    id: 'plan',
    name: 'plan',
    description: 'Read-only planning agent that inspects the codebase without modifying it.',
    mode: 'primary',
    model: null,
    tools: [...READ_TOOLS, 'todowrite', 'todoread', 'question'],
    permissions: [],
    temperature: null,
    maxSteps: 20,
    prompt:
      'You are the plan agent. Inspect the codebase and produce a clear, actionable plan. Do not modify files or run commands.',
    source: 'builtin'
  },
  {
    id: 'general',
    name: 'general',
    description: 'General-purpose subagent for delegated tasks.',
    mode: 'subagent',
    model: null,
    tools: null,
    permissions: [],
    temperature: null,
    maxSteps: 25,
    prompt: 'You are a subagent. Complete the delegated task and report the result concisely.',
    source: 'builtin'
  },
  {
    id: 'explore',
    name: 'explore',
    description: 'Read-only subagent that searches and reads the codebase.',
    mode: 'subagent',
    model: null,
    tools: [...READ_TOOLS],
    permissions: [],
    temperature: null,
    maxSteps: 15,
    prompt:
      'You are an exploration subagent. Search and read the codebase and report your findings concisely.',
    source: 'builtin'
  }
]

export function agentIdFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'agent'
}

function parseMode(value: unknown): AgentMode | null {
  if (value === undefined || value === null || value === '') return 'subagent'
  const mode = String(value).trim() as AgentMode
  return MODES.includes(mode) ? mode : null
}

function parseTools(value: unknown): string[] | null | undefined {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) {
    const tools = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
    return tools.length > 0 ? tools : null
  }
  const text = String(value).trim()
  if (!text || text === '*') return null
  const tools = text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return tools.length > 0 ? tools : null
}

function parseSteps(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null
  const steps = Number(value)
  if (!Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS_LIMIT) return undefined
  return steps
}

function normalizePermissionRule(value: unknown): AgentPermissionRule | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { action?: unknown; resource?: unknown; effect?: unknown }
  if (
    typeof raw.action !== 'string' ||
    !RULE_ACTIONS.includes(raw.action as PermissionRuleAction)
  ) {
    return null
  }
  if (typeof raw.effect !== 'string' || !RULE_EFFECTS.includes(raw.effect as PermissionEffect)) {
    return null
  }
  if (typeof raw.resource !== 'string' || !raw.resource.trim()) return null
  return {
    action: raw.action as PermissionRuleAction,
    resource: raw.resource.trim(),
    effect: raw.effect as PermissionEffect
  }
}

function parsePermissionField(value: unknown): AgentPermissionRule[] {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) {
    return value
      .map(normalizePermissionRule)
      .filter((rule): rule is AgentPermissionRule => rule !== null)
  }
  const text = String(value).trim()
  if (!text) return []
  return text
    .split(',')
    .map((entry) => {
      const parts = entry.split('|')
      if (parts.length !== 3) return null
      const [action, resource, effect] = parts.map((part) => part.trim())
      return normalizePermissionRule({ action, resource, effect })
    })
    .filter((rule): rule is AgentPermissionRule => rule !== null)
}

function parseTemperature(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null
  const temperature = Number(value)
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) return undefined
  return temperature
}

function parseModel(value: unknown): ModelRef | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'object') {
    const raw = value as { providerId?: unknown; modelId?: unknown; variant?: unknown }
    if (typeof raw.providerId === 'string' && typeof raw.modelId === 'string') {
      const model: ModelRef = { providerId: raw.providerId, modelId: raw.modelId }
      if (typeof raw.variant === 'string' && raw.variant.trim()) model.variant = raw.variant.trim()
      return model
    }
    return undefined
  }
  const text = String(value).trim()
  const separator = text.indexOf('/')
  if (separator <= 0 || separator === text.length - 1) return undefined
  const rest = text.slice(separator + 1)
  const hash = rest.indexOf('#')
  if (hash > 0) {
    const variant = rest.slice(hash + 1).trim()
    const model: ModelRef = { providerId: text.slice(0, separator), modelId: rest.slice(0, hash) }
    if (variant) model.variant = variant
    return model
  }
  return { providerId: text.slice(0, separator), modelId: rest }
}

function parseFrontmatter(content: string): { fields: Map<string, string>; body: string } | null {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return null
  const end = normalized.indexOf('\n---', 4)
  if (end === -1) return null
  const header = normalized.slice(4, end)
  const bodyStart = normalized.indexOf('\n', end + 1)
  const body = bodyStart === -1 ? '' : normalized.slice(bodyStart + 1)
  const fields = new Map<string, string>()
  for (const line of header.split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (key) fields.set(key, value)
  }
  return { fields, body: body.trim() }
}

export function parseAgentMarkdown(
  filePath: string,
  content: string,
  source: 'user' | 'project'
): AgentDefinition | null {
  const parsed = parseFrontmatter(content)
  if (!parsed) return null
  const description = parsed.fields.get('description')?.trim() ?? ''
  if (!description) return null

  const mode = parseMode(parsed.fields.get('mode'))
  if (!mode) return null
  const tools = parseTools(parsed.fields.get('tools'))
  if (tools === undefined) return null
  const maxSteps = parseSteps(parsed.fields.get('steps'))
  if (maxSteps === undefined) return null
  const model = parseModel(parsed.fields.get('model'))
  if (model === undefined) return null
  const temperature = parseTemperature(parsed.fields.get('temperature'))
  if (temperature === undefined) return null

  const permissions = parsePermissionField(parsed.fields.get('permission'))
  const fallbackName = path.basename(filePath).replace(/\.md$/i, '')
  const name = parsed.fields.get('name')?.trim() || fallbackName
  if (!name) return null

  return {
    id: agentIdFor(name),
    name,
    description,
    mode,
    model,
    tools,
    permissions,
    maxSteps,
    temperature,
    prompt: parsed.body,
    source
  }
}

export function parseAgentJson(value: unknown, source: 'user' | 'project'): AgentDefinition | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  if (!name || !description) return null

  const mode = parseMode(raw.mode)
  if (!mode) return null
  const tools = parseTools(raw.tools)
  if (tools === undefined) return null
  const maxSteps = parseSteps(raw.steps)
  if (maxSteps === undefined) return null
  const model = parseModel(raw.model)
  if (model === undefined) return null
  const temperature = parseTemperature(raw.temperature)
  if (temperature === undefined) return null
  const permissions = parsePermissionField(raw.permission)

  return {
    id: agentIdFor(name),
    name,
    description,
    mode,
    model,
    tools,
    permissions,
    maxSteps,
    temperature,
    prompt: typeof raw.prompt === 'string' ? raw.prompt.trim() : '',
    source
  }
}

async function readMarkdownAgents(
  directory: string,
  source: 'user' | 'project'
): Promise<AgentDefinition[]> {
  const files = await fs.readdir(directory).catch(() => [] as string[])
  const agents: AgentDefinition[] = []
  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const content = await fs.readFile(path.join(directory, file), 'utf8').catch(() => null)
    if (content === null) continue
    const agent = parseAgentMarkdown(path.join(directory, file), content, source)
    if (agent) agents.push(agent)
  }
  return agents.sort((a, b) => a.id.localeCompare(b.id))
}

async function readJsonAgents(filePath: string): Promise<AgentDefinition[]> {
  const parsed = await readJsonFile<unknown>(filePath)
  if (!parsed) return []
  const rawAgents = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { agents?: unknown }).agents)
      ? (parsed as { agents: unknown[] }).agents
      : []
  const agents: AgentDefinition[] = []
  for (const entry of rawAgents) {
    const agent = parseAgentJson(entry, 'user')
    if (agent) agents.push(agent)
  }
  return agents
}

export async function loadAgents(input: {
  userDataPath: string
  workspacePath: string
}): Promise<AgentDefinition[]> {
  const byName = new Map<string, AgentDefinition>()
  const add = (agent: AgentDefinition): void => {
    byName.set(agent.name.toLowerCase(), agent)
  }

  for (const agent of BUILTIN_AGENTS) add(agent)
  for (const agent of await readMarkdownAgents(
    path.join(input.userDataPath, 'agent', 'agents'),
    'user'
  )) {
    add(agent)
  }
  for (const agent of await readJsonAgents(path.join(input.userDataPath, 'agent', 'agents.json'))) {
    add(agent)
  }
  for (const directory of ['agent', 'agents']) {
    for (const agent of await readMarkdownAgents(
      path.join(input.workspacePath, '.opencode', directory),
      'project'
    )) {
      add(agent)
    }
  }

  return [...byName.values()]
}

export function filterToolsForAgent(tools: ToolSet, agent: AgentDefinition | null): ToolSet {
  if (!agent) return tools
  const allowed = agent.tools ? new Set(agent.tools) : null
  const filtered: ToolSet = {}
  for (const [name, definition] of Object.entries(tools)) {
    if (agent.mode === 'subagent' && name === 'subagent') continue
    if (allowed && !allowed.has(name)) continue
    filtered[name] = definition
  }
  return filtered
}
