import { execFile } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { AgentReference } from '@ateam/shared'
import { normalizeReferences } from './config/config-store'

const execFileAsync = promisify(execFile)
const MENTION_FILE = path.join('.opencode', 'references.json')

export interface ResolvedReference {
  alias: string
  root: string
  description?: string | null
  source: 'path' | 'repository'
}

export type ReferenceExec = (
  file: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>

export interface ResolveReferencesOptions {
  references: AgentReference[]
  workspacePath: string
  globalDirectory: string
  cacheDirectory: string
  exec?: ReferenceExec
  allowClone?: boolean
}

function expandPath(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

function repositoryUrl(value: string): string {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    return `https://github.com/${value}.git`
  }
  return value
}

function branchSlug(branch: string | null | undefined): string {
  return (branch ?? 'default').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40) || 'default'
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

function isDirectorySync(target: string): boolean {
  try {
    return fsSync.statSync(target).isDirectory()
  } catch {
    return false
  }
}

function resolveLocalReference(
  reference: AgentReference,
  baseDirectory: string
): ResolvedReference | null {
  const target = path.resolve(baseDirectory, expandPath(reference.path ?? ''))
  if (!isDirectorySync(target)) return null
  let root = target
  try {
    root = fsSync.realpathSync(target)
  } catch {
    root = target
  }
  return {
    alias: reference.alias,
    root,
    description: reference.description ?? null,
    source: 'path'
  }
}

async function resolveRepositoryReference(
  reference: AgentReference,
  options: ResolveReferencesOptions
): Promise<ResolvedReference | null> {
  const repository = reference.repository?.trim()
  if (!repository) return null
  const directory = path.join(
    options.cacheDirectory,
    `${reference.alias}-${branchSlug(reference.branch)}`
  )
  const gitDirectory = path.join(directory, '.git')
  if (!(await isDirectory(gitDirectory))) {
    if (options.allowClone === false) return null
    await fs.mkdir(path.dirname(directory), { recursive: true })
    const exec = options.exec ?? ((file, args) => execFileAsync(file, args, { timeout: 120_000 }))
    try {
      await exec('git', [
        'clone',
        '--depth',
        '1',
        ...(reference.branch ? ['--branch', reference.branch] : []),
        repositoryUrl(repository),
        directory
      ])
    } catch (error) {
      console.error(
        `[references] failed to clone ${reference.alias}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      return null
    }
  }
  if (!(await isDirectory(directory))) return null
  const root = await fs.realpath(directory).catch(() => directory)
  return {
    alias: reference.alias,
    root,
    description: reference.description ?? null,
    source: 'repository'
  }
}

function projectReferences(workspacePath: string): AgentReference[] {
  try {
    const raw = fsSync.readFileSync(path.join(workspacePath, MENTION_FILE), 'utf8')
    return normalizeReferences(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

export function hasProjectReferences(workspacePath: string): boolean {
  try {
    return fsSync.statSync(path.join(workspacePath, MENTION_FILE)).isFile()
  } catch {
    return false
  }
}

export async function resolveReferences(
  options: ResolveReferencesOptions
): Promise<ResolvedReference[]> {
  const entries: Array<{ reference: AgentReference; base: string }> = options.references.map(
    (reference) => ({ reference, base: options.globalDirectory })
  )
  for (const reference of projectReferences(options.workspacePath)) {
    entries.push({ reference, base: options.workspacePath })
  }
  const byAlias = new Map<string, ResolvedReference>()
  for (const { reference, base } of entries) {
    const resolved = reference.repository
      ? await resolveRepositoryReference(reference, options)
      : resolveLocalReference(reference, base)
    if (resolved) byAlias.set(resolved.alias, resolved)
  }
  return [...byAlias.values()].sort((a, b) => a.alias.localeCompare(b.alias))
}

export function referencesPrompt(references: ResolvedReference[]): string {
  if (references.length === 0) return ''
  return [
    'Available references (directories outside the workspace; use absolute paths with normal tools):',
    ...references.map(
      (reference) =>
        `- ${reference.alias}: ${reference.root}${reference.description ? ` — ${reference.description}` : ''}`
    ),
    'The @alias/<relative path> notation maps to <root>/<relative path> for the matching reference.'
  ].join('\n')
}

export function isInsideReferences(
  resource: string,
  references: ResolvedReference[],
  workspacePath: string
): boolean {
  if (references.length === 0) return false
  const target = path.isAbsolute(resource)
    ? path.resolve(resource)
    : path.resolve(workspacePath, resource)
  const normalized = process.platform === 'win32' ? target.toLowerCase() : target
  return references.some((reference) => {
    const root = process.platform === 'win32' ? reference.root.toLowerCase() : reference.root
    return normalized === root || normalized.startsWith(`${root}${path.sep}`)
  })
}
