import fs from 'node:fs/promises'
import path from 'node:path'

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.cache'
])
const MAX_DEPTH = 8

export async function searchWorkspaceFiles(
  workspacePath: string,
  query: string,
  limit = 20
): Promise<string[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const root = path.resolve(workspacePath)
  const matches: Array<{ path: string; score: number }> = []

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      const haystack = relative.toLowerCase()
      if (!haystack.includes(needle)) continue
      const basename = entry.name.toLowerCase()
      const score = basename.startsWith(needle) ? 0 : basename.includes(needle) ? 1 : 2
      matches.push({ path: relative, score })
    }
  }

  await walk(root, 0)
  return matches
    .sort(
      (a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path)
    )
    .slice(0, limit)
    .map((match) => match.path)
}

export interface ReferenceRoot {
  alias: string
  root: string
}

async function listFiles(root: string, limit: number): Promise<string[]> {
  const files: string[] = []
  const base = path.resolve(root)
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (files.length >= limit || depth > MAX_DEPTH) return
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= limit) return
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1)
      } else if (entry.isFile()) {
        files.push(path.relative(base, absolute).split(path.sep).join('/'))
      }
    }
  }
  await walk(base, 0)
  return files
}

export async function searchFilesWithReferences(
  workspacePath: string,
  query: string,
  references: ReferenceRoot[],
  limit = 20
): Promise<string[]> {
  const needle = query.trim()
  const separator = needle.indexOf('/')
  if (separator >= 0) {
    const alias = needle.slice(0, separator)
    const rest = needle.slice(separator + 1)
    const reference = references.find(
      (candidate) => candidate.alias.toLowerCase() === alias.toLowerCase()
    )
    if (reference) {
      const files = rest
        ? await searchWorkspaceFiles(reference.root, rest, limit)
        : await listFiles(reference.root, limit)
      return files.map((file) => `${reference.alias}/${file}`)
    }
  }

  const prefix = needle.toLowerCase()
  const aliases = references
    .filter((reference) => !prefix || reference.alias.toLowerCase().includes(prefix))
    .slice(0, limit)
    .map((reference) => `${reference.alias}/`)
  const files = await searchWorkspaceFiles(workspacePath, needle, limit)
  return [...new Set([...aliases, ...files])].slice(0, limit)
}
