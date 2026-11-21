import fs from 'node:fs/promises'
import path from 'node:path'
import { expandCommand, type CommandDefinition } from '@ateam/shared'
import { readJsonFile } from './atomic-json'

export { expandCommand }

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
  return {
    id: slugify(name),
    name,
    description: fields.get('description')?.trim() ?? '',
    template: body,
    source
  }
}

export function parseCommandJson(
  value: unknown,
  source: 'user' | 'project'
): CommandDefinition | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as { name?: unknown; description?: unknown; template?: unknown }
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const template = typeof raw.template === 'string' ? raw.template.trim() : ''
  if (!name || !template) return null
  return {
    id: slugify(name),
    name,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    template,
    source
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

export async function loadCommands(input: {
  userDataPath: string
  workspacePath: string
}): Promise<CommandDefinition[]> {
  const byName = new Map<string, CommandDefinition>()
  const add = (command: CommandDefinition): void => {
    byName.set(command.name.toLowerCase(), command)
  }

  for (const command of await readMarkdownCommands(
    path.join(input.userDataPath, 'agent', 'commands'),
    'user'
  )) {
    add(command)
  }
  for (const command of await readJsonCommands(input.userDataPath)) add(command)
  for (const directory of [
    path.join(input.workspacePath, '.opencode', 'command'),
    path.join(input.workspacePath, '.opencode', 'commands'),
    path.join(input.workspacePath, '.claude', 'commands')
  ]) {
    for (const command of await readMarkdownCommands(directory, 'project')) add(command)
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
