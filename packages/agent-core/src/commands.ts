import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  COMMAND_SNIPPET_PATTERN,
  expandCommand,
  splitArguments,
  type CommandDefinition,
  type ModelRef
} from '@ateam/shared'
import { readJsonFile } from './atomic-json'
import { findProjectRoot } from './config/project-root'

export { expandCommand, splitArguments }

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'command'
}

function splitFrontmatter(content: string): { fields: Map<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return { fields: new Map(), body: normalized.trim() }
  }
  const end = normalized.indexOf('\n---', 4)
  if (end === -1) {
    return { fields: new Map(), body: normalized.trim() }
  }
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

function parseModelField(value: string | undefined): ModelRef | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const separator = trimmed.indexOf('/')
  if (separator <= 0 || separator === trimmed.length - 1) return null
  const rest = trimmed.slice(separator + 1)
  const hash = rest.indexOf('#')
  if (hash > 0) {
    const variant = rest.slice(hash + 1).trim()
    const model: ModelRef = {
      providerId: trimmed.slice(0, separator),
      modelId: rest.slice(0, hash)
    }
    if (variant) model.variant = variant
    return model
  }
  return {
    providerId: trimmed.slice(0, separator),
    modelId: rest
  }
}

function parseSubtaskField(value: string | undefined): boolean | undefined {
  const trimmed = value?.trim().toLowerCase()
  if (trimmed === 'true' || trimmed === 'yes' || trimmed === '1') return true
  if (trimmed === 'false' || trimmed === 'no' || trimmed === '0') return false
  return undefined
}

export function parseCommandMarkdown(
  filePath: string,
  content: string,
  source: 'user' | 'project'
): CommandDefinition | null {
  const { fields, body } = splitFrontmatter(content)
  if (!body) return null
  const fallbackName = path.basename(filePath).replace(/\.md$/i, '')
  const name = fields.get('name')?.trim() || fallbackName
  if (!name) return null
  const subtask = parseSubtaskField(fields.get('subtask'))
  return {
    id: slugify(name),
    name,
    description: fields.get('description')?.trim() ?? '',
    template: body,
    agent: fields.get('agent')?.trim() || null,
    model: parseModelField(fields.get('model')),
    source,
    ...(subtask === undefined ? {} : { subtask })
  }
}

export function parseCommandJson(
  value: unknown,
  source: 'user' | 'project'
): CommandDefinition | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as {
    name?: unknown
    description?: unknown
    template?: unknown
    agent?: unknown
    model?: unknown
    subtask?: unknown
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const template = typeof raw.template === 'string' ? raw.template.trim() : ''
  if (!name || !template) return null
  return {
    id: slugify(name),
    name,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    template,
    agent: typeof raw.agent === 'string' && raw.agent.trim() ? raw.agent.trim() : null,
    model: parseModelField(typeof raw.model === 'string' ? raw.model : undefined),
    source,
    ...(typeof raw.subtask === 'boolean' ? { subtask: raw.subtask } : {})
  }
}

async function readMarkdownCommands(
  directory: string,
  source: 'user' | 'project'
): Promise<CommandDefinition[]> {
  const files = await fs.readdir(directory).catch(() => [] as string[])
  const commands: CommandDefinition[] = []
  for (const file of files.sort()) {
    if (!file.endsWith('.md')) continue
    const content = await fs.readFile(path.join(directory, file), 'utf8').catch(() => null)
    if (content === null) continue
    const command = parseCommandMarkdown(path.join(directory, file), content, source)
    if (command) commands.push(command)
  }
  return commands
}

async function readJsonCommands(userDataPath: string): Promise<CommandDefinition[]> {
  const parsed = await readJsonFile<unknown>(path.join(userDataPath, 'agent', 'commands.json'))
  if (!parsed) return []
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { commands?: unknown }).commands)
      ? (parsed as { commands: unknown[] }).commands
      : []
  const commands: CommandDefinition[] = []
  for (const entry of raw) {
    const command = parseCommandJson(entry, 'user')
    if (command) commands.push(command)
  }
  return commands
}

const INIT_TEMPLATE = `Analyze this repository and create or update an \`AGENTS.md\` file at the project root.

1. Inspect the repository structure, build system, package manager, and existing documentation.
2. Identify the commands for building, testing, linting, formatting, type checking, and running the project locally.
3. Capture code style, architectural conventions, and repository-specific rules a contributor must follow.
4. Record required environment setup and how secrets or credentials are handled.

If \`AGENTS.md\` already exists, update it in place and keep unrelated content intact. Prefer concrete commands and facts over generic advice.

Additional instructions: $ARGUMENTS`

const REVIEW_TEMPLATE = `Review the pending changes in this repository and report problems by severity.

Focus on:
- Correctness bugs, edge cases, and error handling gaps.
- Security issues such as injection, secret leakage, and unsafe input handling.
- Regressions in behavior covered by existing tests.
- Consistency with repository conventions.

Inspect the diff (or the commit, branch, or pull request named below), then report findings grouped by severity: important, minor, and nit. Cite file and line for each finding.

Review target: $ARGUMENTS`

/** Builtin commands, loaded first and overridden by same-named user or project commands. */
export const BUILTIN_COMMANDS: readonly CommandDefinition[] = [
  {
    id: 'init',
    name: 'init',
    description: 'Analyze the repository and create or update AGENTS.md.',
    template: INIT_TEMPLATE,
    agent: null,
    model: null,
    source: 'builtin'
  },
  {
    id: 'review',
    name: 'review',
    description: 'Review pending changes by severity in a subtask session.',
    template: REVIEW_TEMPLATE,
    agent: null,
    model: null,
    source: 'builtin',
    subtask: true
  }
]

export async function loadCommands(input: {
  userDataPath: string
  workspacePath: string
  config?: import('@ateam/shared').AgentConfig
}): Promise<CommandDefinition[]> {
  const byName = new Map<string, CommandDefinition>()
  const add = (command: CommandDefinition): void => {
    byName.set(command.name.toLowerCase(), command)
  }

  for (const command of BUILTIN_COMMANDS) add(command)
  for (const command of await readMarkdownCommands(
    path.join(input.userDataPath, 'agent', 'commands'),
    'user'
  )) {
    add(command)
  }
  for (const command of await readJsonCommands(input.userDataPath)) add(command)
  for (const command of input.config?.commands ?? []) {
    if (command.source === 'user') byName.set(command.name.toLowerCase(), command)
  }
  const root = await findProjectRoot(input.workspacePath)
  const directories = new Set<string>()
  for (const base of [root, input.workspacePath]) {
    for (const directory of ['command', 'commands']) {
      directories.add(path.join(base, '.opencode', directory))
      directories.add(path.join(base, '.ateam', directory))
    }
    directories.add(path.join(base, '.claude', 'commands'))
  }
  for (const directory of directories) {
    for (const command of await readMarkdownCommands(directory, 'project')) add(command)
  }
  for (const command of input.config?.commands ?? []) {
    if (command.source === 'project') byName.set(command.name.toLowerCase(), command)
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export interface ShellSnippetResult {
  stdout: string
  error?: string
}

export type ShellSnippetRunner = (command: string) => Promise<ShellSnippetResult>

const MAX_SNIPPET_OUTPUT = 10_000
const MAX_SNIPPETS = 5

/** Expand placeholders, then replace !`command` snippets with their stdout. */
export async function expandCommandTemplate(
  template: string,
  args: string,
  runner: ShellSnippetRunner
): Promise<string> {
  const expanded = expandCommand(template, args)
  if (!expanded.includes('!`')) return expanded

  const parts: string[] = []
  let lastIndex = 0
  let executed = 0
  for (const match of expanded.matchAll(COMMAND_SNIPPET_PATTERN)) {
    const index = match.index ?? 0
    parts.push(expanded.slice(lastIndex, index))
    if (executed >= MAX_SNIPPETS) {
      parts.push('(shell snippet limit reached)')
      lastIndex = index + match[0].length
      continue
    }
    executed += 1
    const result = await runner(match[1].trim())
    parts.push(
      result.error
        ? `(shell command failed: ${result.error})`
        : result.stdout.trim().slice(0, MAX_SNIPPET_OUTPUT)
    )
    lastIndex = index + match[0].length
  }
  parts.push(expanded.slice(lastIndex))
  return parts.join('')
}

export function runWorkspaceShell(command: string, cwd: string): Promise<ShellSnippetResult> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            stdout,
            error: (stderr.trim() || error.message).slice(0, 2_000)
          })
          return
        }
        resolve({ stdout })
      }
    )
  })
}
