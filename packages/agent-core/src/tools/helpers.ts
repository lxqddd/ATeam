import fs from 'node:fs/promises'
import path from 'node:path'
import { IGNORED_DIRS, MAX_LIST_ENTRIES, MAX_TOOL_OUTPUT } from './types'
import type { ToolContext } from './types'

export async function afterWrite(context: ToolContext, files: string[]): Promise<string> {
  if (files.length === 0) return ''
  const formatted = (await context.formatFiles?.(files)) ?? ''
  const diagnostics = (await context.diagnoseFiles?.(files)) ?? ''
  return [formatted, diagnostics].filter(Boolean).join('\n\n')
}

export function withNotes(result: string, notes: string): string {
  return notes ? `${result}\n\n${notes}` : result
}

export function truncate(value: string): string {
  if (value.length <= MAX_TOOL_OUTPUT) return value
  return `${value.slice(0, MAX_TOOL_OUTPUT)}\n[output truncated at ${MAX_TOOL_OUTPUT} characters]`
}

export function escapesWorkspace(workspace: string, input: string): boolean {
  const resolved = path.resolve(workspace, input)
  const root = path.resolve(workspace)
  return resolved !== root && !resolved.startsWith(`${root}${path.sep}`)
}

export async function resolvePath(
  workspace: string,
  input: string,
  allowMissing = false,
  allowOutside = false
): Promise<string> {
  const resolved = path.resolve(workspace, input)
  const root = path.resolve(workspace)
  if (!allowOutside && resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes workspace: ${input}`)
  }

  if (!allowMissing) {
    const real = await fs.realpath(resolved)
    const realRoot = await fs.realpath(root)
    if (!allowOutside && real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`Path escapes workspace: ${input}`)
    }
    return real
  }

  const existing = await fs.lstat(resolved).catch(() => null)
  if (existing?.isSymbolicLink()) {
    throw new Error(`Path is a symbolic link: ${input}`)
  }

  const parent = path.dirname(resolved)
  const realRoot = await fs.realpath(root)
  const realParent = await nearestExistingRealPath(parent)
  if (
    !allowOutside &&
    realParent !== realRoot &&
    !realParent.startsWith(`${realRoot}${path.sep}`)
  ) {
    throw new Error(`Path escapes workspace: ${input}`)
  }
  await fs.mkdir(parent, { recursive: true })
  return resolved
}

export async function ensureExternalAccess(
  context: ToolContext,
  input: string,
  toolName: string,
  toolCallId: string
): Promise<boolean> {
  if (!escapesWorkspace(context.workspace, input)) return true
  return context.askPermission('external_directory', input, toolName, toolCallId)
}

export async function nearestExistingRealPath(target: string): Promise<string> {
  let candidate = target
  for (;;) {
    try {
      return await fs.realpath(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const next = path.dirname(candidate)
      if (next === candidate) throw error
      candidate = next
    }
  }
}

export function safeError(error: unknown): string {
  return `Error: ${error instanceof Error ? error.message : String(error)}`
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

export function globExpression(pattern: string): RegExp {
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

export async function readFileText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  if (buffer.subarray(0, 8_192).includes(0)) {
    throw new Error('Binary files are not supported')
  }
  return buffer.toString('utf8')
}

export async function walk(
  directory: string,
  onFile: (filePath: string) => Promise<boolean | void>,
  depth: number,
  maxDepth: number
): Promise<void> {
  if (depth > maxDepth) return
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await walk(entryPath, onFile, depth + 1, maxDepth)
    } else if (entry.isFile()) {
      const stop = await onFile(entryPath)
      if (stop) return
    }
  }
}

export function matchesInclude(filePath: string, include?: string): boolean {
  if (!include) return true
  const pattern = include.includes('*')
    ? new RegExp(`^${include.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
    : null
  return pattern ? pattern.test(path.basename(filePath)) : path.basename(filePath).includes(include)
}

export async function listDirectory(
  directory: string,
  base: string,
  depth: number,
  maxDepth: number,
  output: string[]
): Promise<void> {
  if (depth > maxDepth || output.length >= MAX_LIST_ENTRIES) return
  const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue
    if (output.length >= MAX_LIST_ENTRIES) return
    const entryPath = path.join(directory, entry.name)
    const relative = path.relative(base, entryPath)
    if (entry.isDirectory()) {
      output.push(`${relative}/`)
      await listDirectory(entryPath, base, depth + 1, maxDepth, output)
    } else if (entry.isFile()) {
      output.push(relative)
    }
  }
}
