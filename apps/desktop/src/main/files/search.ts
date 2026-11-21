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
