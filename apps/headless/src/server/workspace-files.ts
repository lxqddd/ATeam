import fs from 'node:fs/promises'
import path from 'node:path'
import {
  WORKSPACE_FILE_LIMITS,
  type WorkspaceFileEntry,
  type WorkspaceFileMatch
} from '@ateam/shared'

/** Directories the listing and search routes never enter. */
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.DS_Store'])
const DEFAULT_LIST_DEPTH = 1
const DEFAULT_LIST_LIMIT = 500
const DEFAULT_SEARCH_LIMIT = 100
const MAX_WALK_DEPTH = 12

interface ResolvedPath {
  /** Real absolute path after symbol link resolution. */
  absolute: string
  /** Real workspace root the path was validated against. */
  root: string
  /** Path relative to the workspace root, using forward slashes (`''` = root). */
  relative: string
}

/**
 * Resolves a client supplied path inside a workspace.
 *
 * Both the lexical path and the real path (after symbol link resolution) must
 * stay inside the workspace, so `..` segments and escaping symbol links are
 * rejected even when the target exists.
 */
export async function resolveWorkspacePath(
  workspace: string,
  input: string
): Promise<ResolvedPath> {
  if (input.includes('\0')) throw new Error('FILE_INVALID_PATH')
  const lexicalRoot = path.resolve(workspace)
  const resolved = path.resolve(lexicalRoot, input)
  if (resolved !== lexicalRoot && !resolved.startsWith(`${lexicalRoot}${path.sep}`)) {
    throw new Error('FILE_PATH_ESCAPES_WORKSPACE')
  }

  const root = await fs.realpath(lexicalRoot).catch(() => null)
  if (!root) throw new Error('FILE_NOT_FOUND')
  const absolute = await fs.realpath(resolved).catch(() => null)
  if (!absolute) throw new Error('FILE_NOT_FOUND')
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error('FILE_PATH_ESCAPES_WORKSPACE')
  }
  return { absolute, root, relative: relativeTo(root, absolute) }
}

export interface ReadWorkspaceFileResult {
  path: string
  content: string
  size: number
  truncated: boolean
}

/**
 * Reads a text file inside the workspace. Binary files are rejected and large
 * files are cut at {@link WORKSPACE_FILE_LIMITS.readBytes}.
 */
export async function readWorkspaceFile(
  workspace: string,
  input: string
): Promise<ReadWorkspaceFileResult> {
  const target = await resolveWorkspacePath(workspace, input)
  const handle = await fs.open(target.absolute, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('FILE_NOT_A_FILE')
    const length = Math.min(stat.size, WORKSPACE_FILE_LIMITS.readBytes)
    const buffer = Buffer.alloc(length)
    if (length > 0) await handle.read(buffer, 0, length, 0)
    if (buffer.subarray(0, 8_192).includes(0)) throw new Error('FILE_BINARY')
    return {
      path: target.relative,
      content: buffer.toString('utf8'),
      size: stat.size,
      truncated: stat.size > length
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export interface ListWorkspaceFilesOptions {
  /** Directory relative to the workspace; defaults to the root. */
  path?: string
  /** Recursion depth, clamped to `1..WORKSPACE_FILE_LIMITS.listDepth`. */
  depth?: number
  /** Entry limit, clamped to `1..WORKSPACE_FILE_LIMITS.listEntries`. */
  limit?: number
}

export interface ListWorkspaceFilesResult {
  path: string
  entries: WorkspaceFileEntry[]
  truncated: boolean
}

/**
 * Lists files and directories under a workspace directory. Symbol links are
 * never reported or followed, so a link cannot widen the reachable tree.
 */
export async function listWorkspaceFiles(
  workspace: string,
  options: ListWorkspaceFilesOptions = {}
): Promise<ListWorkspaceFilesResult> {
  const target = await resolveWorkspacePath(workspace, options.path ?? '')
  const stat = await fs.stat(target.absolute)
  if (!stat.isDirectory()) throw new Error('FILE_NOT_A_DIRECTORY')

  const depth = clampInt(options.depth, DEFAULT_LIST_DEPTH, 1, WORKSPACE_FILE_LIMITS.listDepth)
  const limit = clampInt(options.limit, DEFAULT_LIST_LIMIT, 1, WORKSPACE_FILE_LIMITS.listEntries)
  const entries: WorkspaceFileEntry[] = []
  let truncated = false

  const walk = async (directory: string, level: number): Promise<void> => {
    if (truncated) return
    const dirents = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    dirents.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of dirents) {
      if (IGNORED_DIRS.has(entry.name)) continue
      if (entries.length >= limit) {
        truncated = true
        return
      }
      if (entry.isSymbolicLink()) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        entries.push({
          path: relativeTo(target.root, absolute),
          name: entry.name,
          type: 'directory',
          size: null
        })
        if (level < depth) await walk(absolute, level + 1)
        continue
      }
      if (!entry.isFile()) continue
      const fileStat = await fs.stat(absolute).catch(() => null)
      if (!fileStat) continue
      entries.push({
        path: relativeTo(target.root, absolute),
        name: entry.name,
        type: 'file',
        size: fileStat.size
      })
    }
  }

  await walk(target.absolute, 1)
  return { path: target.relative, entries, truncated }
}

export interface FindWorkspaceFilesOptions {
  /** Directory relative to the workspace; defaults to the root. */
  path?: string
  /** Glob pattern matched against paths relative to `path`. */
  pattern: string
  /** Result limit, clamped to `1..WORKSPACE_FILE_LIMITS.searchResults`. */
  limit?: number
}

export interface FindWorkspaceFilesResult {
  root: string
  pattern: string
  matches: string[]
  truncated: boolean
}

/** Finds files by glob pattern below a workspace directory. */
export async function findWorkspaceFiles(
  workspace: string,
  options: FindWorkspaceFilesOptions
): Promise<FindWorkspaceFilesResult> {
  if (!options.pattern.trim()) throw new Error('FILE_INVALID_PATTERN')
  const target = await resolveWorkspacePath(workspace, options.path ?? '')
  const stat = await fs.stat(target.absolute)
  if (!stat.isDirectory()) throw new Error('FILE_NOT_A_DIRECTORY')

  const limit = clampInt(
    options.limit,
    DEFAULT_SEARCH_LIMIT,
    1,
    WORKSPACE_FILE_LIMITS.searchResults
  )
  const matcher = globExpression(options.pattern)
  const deadline = Date.now() + WORKSPACE_FILE_LIMITS.searchMs
  const matches: string[] = []
  let truncated = false

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (truncated || depth > MAX_WALK_DEPTH) return
    if (Date.now() > deadline) {
      truncated = true
      return
    }
    const dirents = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    dirents.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of dirents) {
      if (truncated) return
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!matcher.test(relativeTo(target.absolute, absolute))) continue
      matches.push(relativeTo(target.root, absolute))
      if (matches.length >= limit) {
        truncated = true
        return
      }
    }
  }

  await walk(target.absolute, 0)
  matches.sort()
  return { root: target.relative, pattern: options.pattern, matches, truncated }
}

export interface GrepWorkspaceFilesOptions {
  /** Directory relative to the workspace; defaults to the root. */
  path?: string
  /** JavaScript regular expression, or literal text when `literal` is set. */
  pattern: string
  /** Optional filename filter such as `*.ts`. */
  include?: string
  literal?: boolean
  caseSensitive?: boolean
  /** Result limit, clamped to `1..WORKSPACE_FILE_LIMITS.searchResults`. */
  limit?: number
}

export interface GrepWorkspaceFilesResult {
  root: string
  pattern: string
  matches: WorkspaceFileMatch[]
  truncated: boolean
}

/** Searches text files below a workspace directory with a regular expression. */
export async function grepWorkspaceFiles(
  workspace: string,
  options: GrepWorkspaceFilesOptions
): Promise<GrepWorkspaceFilesResult> {
  if (!options.pattern.trim()) throw new Error('FILE_INVALID_PATTERN')
  const target = await resolveWorkspacePath(workspace, options.path ?? '')
  const stat = await fs.stat(target.absolute)
  if (!stat.isDirectory()) throw new Error('FILE_NOT_A_DIRECTORY')

  let expression: RegExp
  try {
    expression = new RegExp(
      options.literal ? escapeRegExp(options.pattern) : options.pattern,
      options.caseSensitive ? '' : 'i'
    )
  } catch {
    throw new Error('FILE_INVALID_PATTERN')
  }

  const limit = clampInt(
    options.limit,
    DEFAULT_SEARCH_LIMIT,
    1,
    WORKSPACE_FILE_LIMITS.searchResults
  )
  const deadline = Date.now() + WORKSPACE_FILE_LIMITS.searchMs
  const matches: WorkspaceFileMatch[] = []
  let truncated = false

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (truncated || depth > MAX_WALK_DEPTH) return
    if (Date.now() > deadline) {
      truncated = true
      return
    }
    const dirents = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    dirents.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of dirents) {
      if (truncated) return
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (options.include && !matchesInclude(absolute, options.include)) continue
      if (Date.now() > deadline) {
        truncated = true
        return
      }
      const text = await readTextFile(absolute)
      if (text === null) continue
      const relative = relativeTo(target.root, absolute)
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (!expression.test(line)) continue
        matches.push({ path: relative, line: index + 1, text: line })
        if (matches.length >= limit) {
          truncated = true
          return
        }
      }
    }
  }

  await walk(target.absolute, 0)
  return { root: target.relative, pattern: options.pattern, matches, truncated }
}

function relativeTo(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

async function readTextFile(filePath: string): Promise<string | null> {
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat || !stat.isFile() || stat.size > WORKSPACE_FILE_LIMITS.grepFileBytes) return null
  const buffer = await fs.readFile(filePath).catch(() => null)
  if (!buffer || buffer.subarray(0, 8_192).includes(0)) return null
  return buffer.toString('utf8')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function matchesInclude(filePath: string, include: string): boolean {
  const name = path.basename(filePath)
  const pattern = include.includes('*')
    ? new RegExp(`^${include.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
    : null
  return pattern ? pattern.test(name) : name.includes(include)
}

function globExpression(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/')
  let expression = ''
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        index += 1
        if (normalized[index + 1] === '/') {
          index += 1
          expression += '(?:.*/)?'
        } else {
          expression += '.*'
        }
      } else {
        expression += '[^/]*'
      }
    } else if (character === '?') {
      expression += '[^/]'
    } else {
      expression += escapeRegExp(character)
    }
  }
  return new RegExp(`^${expression}$`)
}
