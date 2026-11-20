import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { PermissionAction } from '@ateam/shared'

const MAX_TOOL_OUTPUT = 200_000
const MAX_READ_LINES = 2_000
const MAX_LIST_ENTRIES = 500
const MAX_GREP_MATCHES = 100
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.DS_Store'])

export interface ToolContext {
  workspace: string
  signal: AbortSignal
  askPermission: (
    action: PermissionAction,
    resource: string,
    toolName: string,
    toolCallId: string
  ) => Promise<boolean>
}

function truncate(value: string): string {
  if (value.length <= MAX_TOOL_OUTPUT) return value
  return `${value.slice(0, MAX_TOOL_OUTPUT)}\n[output truncated at ${MAX_TOOL_OUTPUT} characters]`
}

async function resolvePath(
  workspace: string,
  input: string,
  allowMissing = false
): Promise<string> {
  const resolved = path.resolve(workspace, input)
  const root = path.resolve(workspace)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path escapes workspace: ${input}`)
  }

  if (!allowMissing) {
    const real = await fs.realpath(resolved)
    const realRoot = await fs.realpath(root)
    if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`Path escapes workspace: ${input}`)
    }
    return real
  }

  const parent = path.dirname(resolved)
  const realRoot = await fs.realpath(root)
  const realParent = await nearestExistingRealPath(parent)
  if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`Path escapes workspace: ${input}`)
  }
  await fs.mkdir(parent, { recursive: true })
  return resolved
}

async function nearestExistingRealPath(target: string): Promise<string> {
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

function safeError(error: unknown): string {
  return `Error: ${error instanceof Error ? error.message : String(error)}`
}

async function readFileText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  if (buffer.subarray(0, 8_192).includes(0)) {
    throw new Error('Binary files are not supported')
  }
  return buffer.toString('utf8')
}

async function walk(
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

function matchesInclude(filePath: string, include?: string): boolean {
  if (!include) return true
  const pattern = include.includes('*')
    ? new RegExp(`^${include.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
    : null
  return pattern ? pattern.test(path.basename(filePath)) : path.basename(filePath).includes(include)
}

async function listDirectory(
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

export function createTools(context: ToolContext): ToolSet {
  const read = tool({
    description:
      'Read a text file inside the workspace. Returns numbered lines. Use offset/limit for large files.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to the workspace'),
      offset: z.number().int().min(1).optional().describe('First line (1-based)'),
      limit: z.number().int().min(1).max(MAX_READ_LINES).optional().describe('Maximum lines')
    }),
    execute: async ({ path: inputPath, offset = 1, limit = MAX_READ_LINES }) => {
      try {
        const filePath = await resolvePath(context.workspace, inputPath)
        const text = await readFileText(filePath)
        const lines = text.split(/\r?\n/)
        const start = Math.max(0, offset - 1)
        const slice = lines.slice(start, start + limit)
        const numbered = slice
          .map((line, index) => `${String(start + index + 1).padStart(5)}  ${line}`)
          .join('\n')
        const suffix =
          start + limit < lines.length
            ? `\n[showing lines ${offset}-${start + slice.length} of ${lines.length}]`
            : ''
        return truncate(numbered + suffix)
      } catch (error) {
        return safeError(error)
      }
    }
  })

  const list = tool({
    description: 'List files and directories inside the workspace.',
    inputSchema: z.object({
      path: z.string().optional().describe('Directory relative to the workspace'),
      depth: z.number().int().min(1).max(4).optional().describe('Recursion depth')
    }),
    execute: async ({ path: inputPath = '.', depth = 1 }) => {
      try {
        const root = await resolvePath(context.workspace, inputPath)
        const base = path.resolve(context.workspace)
        const entries: string[] = []
        await listDirectory(root, base, 1, depth, entries)
        return truncate(entries.join('\n') || '(empty directory)')
      } catch (error) {
        return safeError(error)
      }
    }
  })

  const grep = tool({
    description: 'Search text files in the workspace with a JavaScript regular expression.',
    inputSchema: z.object({
      pattern: z.string().describe('JavaScript regular expression'),
      path: z.string().optional().describe('Directory relative to the workspace'),
      include: z.string().optional().describe('Optional filename filter, e.g. *.ts'),
      maxResults: z.number().int().min(1).max(500).optional()
    }),
    execute: async ({
      pattern,
      path: inputPath = '.',
      include = '',
      maxResults = MAX_GREP_MATCHES
    }) => {
      try {
        const expression = new RegExp(pattern, 'i')
        const root = await resolvePath(context.workspace, inputPath)
        const base = path.resolve(context.workspace)
        const matches: string[] = []
        let stop = false
        await walk(
          root,
          async (filePath) => {
            if (!matchesInclude(filePath, include)) return false
            let text: string
            try {
              text = await readFileText(filePath)
            } catch {
              return false
            }
            for (const [index, line] of text.split(/\r?\n/).entries()) {
              if (!expression.test(line)) continue
              matches.push(`${path.relative(base, filePath)}:${index + 1}: ${line}`)
              if (matches.length >= maxResults) {
                stop = true
                return true
              }
            }
            return false
          },
          0,
          8
        )
        const header = stop ? `[stopped at ${maxResults} matches]\n` : ''
        return truncate(header + (matches.join('\n') || 'No matches'))
      } catch (error) {
        return safeError(error)
      }
    }
  })

  const write = tool({
    description: 'Create or overwrite a text file inside the workspace. Requires approval.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to the workspace'),
      content: z.string().describe('File content')
    }),
    execute: async ({ path: inputPath, content }, options) => {
      try {
        if (Buffer.byteLength(content, 'utf8') > 1_000_000) {
          return 'Error: file content exceeds 1 MB'
        }
        const allowed = await context.askPermission('write', inputPath, 'write', options.toolCallId)
        if (!allowed) return 'Permission denied by user; the file was not written.'
        const filePath = await resolvePath(context.workspace, inputPath, true)
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, content, 'utf8')
        return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${inputPath}`
      } catch (error) {
        return safeError(error)
      }
    }
  })

  const edit = tool({
    description:
      'Edit a text file by replacing an exact string. Requires approval. Fails if the old text is not unique unless replaceAll is true.',
    inputSchema: z.object({
      path: z.string().describe('Path relative to the workspace'),
      oldText: z.string().min(1).describe('Exact text to replace'),
      newText: z.string().describe('Replacement text'),
      replaceAll: z.boolean().optional()
    }),
    execute: async ({ path: inputPath, oldText, newText, replaceAll = false }, options) => {
      try {
        if (oldText.length > 200_000) return 'Error: oldText is too large'
        const allowed = await context.askPermission('edit', inputPath, 'edit', options.toolCallId)
        if (!allowed) return 'Permission denied by user; the file was not edited.'
        const filePath = await resolvePath(context.workspace, inputPath)
        const text = await readFileText(filePath)
        const occurrences = text.split(oldText).length - 1
        if (occurrences === 0) return 'Error: oldText was not found'
        if (occurrences > 1 && !replaceAll) {
          return `Error: oldText occurs ${occurrences} times; pass replaceAll or use a unique match`
        }
        const next = replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, newText)
        await fs.writeFile(filePath, next, 'utf8')
        return `Replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${inputPath}`
      } catch (error) {
        return safeError(error)
      }
    }
  })

  const shell = tool({
    description:
      'Run a shell command inside the workspace. Requires approval. Use for commands, tests, and git; avoid interactive commands.',
    inputSchema: z.object({
      command: z.string().describe('Shell command'),
      cwd: z.string().optional().describe('Working directory relative to the workspace'),
      timeoutMs: z.number().int().min(1_000).max(600_000).optional()
    }),
    execute: async ({ command, cwd = '.', timeoutMs = 120_000 }, options) => {
      try {
        const allowed = await context.askPermission('shell', command, 'shell', options.toolCallId)
        if (!allowed) return 'Permission denied by user; the command was not run.'
        const workdir = await resolvePath(context.workspace, cwd)
        return await new Promise<string>((resolve) => {
          const child = spawn(command, {
            cwd: workdir,
            shell: true,
            detached: process.platform !== 'win32',
            env: process.env
          })
          let output = ''
          let settled = false
          const finish = (result: string): void => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            options.abortSignal?.removeEventListener('abort', onAbort)
            resolve(truncate(result))
          }
          const kill = (): void => {
            try {
              if (process.platform !== 'win32' && child.pid) {
                process.kill(-child.pid, 'SIGKILL')
              } else {
                child.kill('SIGKILL')
              }
            } catch {
              /* already gone */
            }
          }
          const onAbort = (): void => {
            kill()
            finish(`${output}\n[command interrupted]`)
          }
          const append = (chunk: Buffer): void => {
            if (output.length >= MAX_TOOL_OUTPUT) return
            output += chunk.toString('utf8')
          }
          const timer = setTimeout(() => {
            kill()
            finish(`${output}\n[command timed out after ${timeoutMs}ms]`)
          }, timeoutMs)
          options.abortSignal?.addEventListener('abort', onAbort, { once: true })
          child.stdout.on('data', append)
          child.stderr.on('data', append)
          child.on('error', (error) => finish(`Error: ${error.message}`))
          child.on('close', (code) => {
            finish(`${output}${code && code !== 0 ? `\n[exit ${code}]` : ''}` || '(no output)')
          })
        })
      } catch (error) {
        return safeError(error)
      }
    }
  })

  return { read, list, grep, write, edit, shell }
}
