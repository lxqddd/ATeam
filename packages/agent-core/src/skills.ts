import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AgentConfig, CommandDefinition, SkillDefinition } from '@ateam/shared'
import { findProjectRoot } from './config/project-root'

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'skill'
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

export function parseSkillMarkdown(
  filePath: string,
  content: string,
  source: 'user' | 'project'
): SkillDefinition | null {
  const parsed = parseFrontmatter(content)
  if (!parsed) return null
  const description = parsed.fields.get('description')?.trim() ?? ''
  if (!description || !parsed.body) return null
  const fallbackName = path.basename(path.dirname(filePath))
  const name = parsed.fields.get('name')?.trim() || fallbackName
  if (!name) return null
  return {
    id: slugify(name),
    name,
    description,
    content: parsed.body,
    path: filePath,
    resources: [],
    source
  }
}

const MAX_SKILL_RESOURCES = 50
const MAX_RESOURCE_DEPTH = 3

async function listSkillResources(directory: string, prefix = '', depth = 0): Promise<string[]> {
  if (depth > MAX_RESOURCE_DEPTH) return []
  const entries = await fs
    .readdir(path.join(directory, prefix), { withFileTypes: true })
    .catch(() => [])
  const resources: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!prefix && entry.name === 'SKILL.md') continue
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      resources.push(...(await listSkillResources(directory, relative, depth + 1)))
    } else {
      resources.push(relative)
    }
    if (resources.length >= MAX_SKILL_RESOURCES) {
      return resources.slice(0, MAX_SKILL_RESOURCES)
    }
  }
  return resources
}

async function readSkillDirectory(
  directory: string,
  source: 'user' | 'project'
): Promise<SkillDefinition[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  const skills: SkillDefinition[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const filePath = path.join(directory, entry.name, 'SKILL.md')
    const content = await fs.readFile(filePath, 'utf8').catch(() => null)
    if (content === null) continue
    const skill = parseSkillMarkdown(filePath, content, source)
    if (skill) {
      skill.resources = await listSkillResources(path.dirname(filePath))
      skills.push(skill)
    }
  }
  return skills
}

function skillSource(target: string, userDataPath: string): 'user' | 'project' {
  const relative = path.relative(path.join(userDataPath, 'agent'), path.resolve(target))
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? 'user' : 'project'
}

export async function loadSkills(input: {
  userDataPath: string
  workspacePath: string
  config?: AgentConfig
}): Promise<SkillDefinition[]> {
  const byName = new Map<string, SkillDefinition>()
  const add = (skill: SkillDefinition): void => {
    byName.set(skill.name.toLowerCase(), skill)
  }

  for (const skill of await readSkillDirectory(
    path.join(input.userDataPath, 'agent', 'skills'),
    'user'
  )) {
    add(skill)
  }
  const root = await findProjectRoot(input.workspacePath)
  const directories = new Set<string>()
  for (const base of [root, input.workspacePath]) {
    for (const directory of ['skill', 'skills']) {
      directories.add(path.join(base, '.opencode', directory))
      directories.add(path.join(base, '.ateam', directory))
    }
    directories.add(path.join(base, '.claude', 'skills'))
  }
  for (const directory of directories) {
    for (const skill of await readSkillDirectory(directory, 'project')) add(skill)
  }
  for (const rawTarget of input.config?.skills ?? []) {
    const target =
      rawTarget === '~'
        ? os.homedir()
        : rawTarget.startsWith('~/')
          ? path.join(os.homedir(), rawTarget.slice(2))
          : rawTarget
    const source = skillSource(target, input.userDataPath)
    const stat = await fs.stat(target).catch(() => null)
    if (stat?.isDirectory()) {
      for (const skill of await readSkillDirectory(target, source)) add(skill)
    } else if (stat?.isFile() && path.basename(target).toLowerCase() === 'skill.md') {
      const content = await fs.readFile(target, 'utf8').catch(() => null)
      if (content === null) continue
      const skill = parseSkillMarkdown(target, content, source)
      if (skill) {
        skill.resources = await listSkillResources(path.dirname(target))
        add(skill)
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function skillsPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) return ''
  return [
    'Available skills. When a task matches a skill description, call the skill tool with its name to load the full instructions before proceeding.',
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`)
  ].join('\n')
}

/** Expose a skill as a palette command that inlines the full skill instructions. */
export function skillCommand(skill: SkillDefinition): CommandDefinition {
  const baseDirectory = skill.path ? path.dirname(skill.path) : ''
  return {
    id: `skill:${skill.id}`,
    name: skill.id,
    description: skill.description,
    template: baseDirectory
      ? `${skill.content}\n\nBase directory for this skill: ${baseDirectory}`
      : skill.content,
    agent: null,
    model: null,
    source: 'skill'
  }
}
