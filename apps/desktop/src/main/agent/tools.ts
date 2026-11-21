import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { PermissionAction, SubagentInput, WebFetchFormat } from '@ateam/shared'

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
  loadNestedInstructions?: (targetPath: string) => Promise<string>
  storeOutput?: (toolCallId: string, output: string) => Promise<{ output: string; path?: string }>
  onToolOutput?: (toolCallId: string, delta: string) => void
  backgroundOutputPath?: (toolCallId: string) => Promise<string>
  onBackgroundFinished?: (info: {
    toolCallId: string
    command: string
    exitCode: number | null
    outputPath: string | null
  }) => void
  formatFiles?: (files: string[]) => Promise<string>
  diagnoseFiles?: (files: string[]) => Promise<string>
  runSubagent?: (input: SubagentInput, toolCallId: string) => Promise<string>
  fetchWeb?: (input: { url: string; format: WebFetchFormat; timeoutMs?: number }) => Promise<string>
  webSearch?: (input: { query: string; count: number }) => Promise<string>
  loadSkill?: (name: string) => Promise<string>
}

async function afterWrite(context: ToolContext, files: string[]): Promise<string> {
  if (files.length === 0) return ''
  const formatted = (await context.formatFiles?.(files)) ?? ''
  const diagnostics = (await context.diagnoseFiles?.(files)) ?? ''
  return [formatted, diagnostics].filter(Boolean).join('\n\n')
}

function withNotes(result: string, notes: string): string {
  return notes ? `${result}\n\n${notes}` : result
}

function truncate(value: string): string {
  if (value.length <= MAX_TOOL_OUTPUT) return value
  return `${value.slice(0, MAX_TOOL_OUTPUT)}\n[output truncated at ${MAX_TOOL_OUTPUT} characters]`
}

function escapesWorkspace(workspace: string, input: string): boolean {
  const resolved = path.resolve(workspace, input)
  const root = path.resolve(workspace)
  return resolved !== root && !resolved.startsWith(`${root}${path.sep}`)
}

async function resolvePath(
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

async function ensureExternalAccess(
  context: ToolContext,
  input: string,
  toolName: string,
  toolCallId: string
): Promise<boolean> {
  if (!escapesWorkspace(context.workspace, input)) return true
  return context.askPermission('external_directory', input, toolName, toolCallId)
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

function escapeRegExp(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, '\\$&')
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

interface PatchHunk {
  oldText: string
  newText: string
}

interface PatchOperation {
  kind: 'add' | 'update' | 'delete'
  path: string
  content?: string
  hunks?: PatchHunk[]
}

function parsePatch(patchText: string): PatchOperation[] {
  const lines = patchText.split(/\r?\n/)
  if (
    lines[0]?.trim() !== '*** Begin Patch' ||
    lines[lines.length - 1]?.trim() !== '*** End Patch'
  ) {
    throw new Error('Invalid patch: missing Begin/End markers')
  }

  const operations: PatchOperation[] = []
  let index = 1
  while (index < lines.length - 1) {
    const line = lines[index]
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line)
    if (!header) throw new Error(`Invalid patch line: ${line}`)
    const kind = header[1].toLowerCase() as PatchOperation['kind']
    const filePath = header[2]
    index += 1

    if (kind === 'add') {
      const content: string[] = []
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (!lines[index].startsWith('+')) throw new Error('Invalid add file line')
        content.push(lines[index].slice(1))
        index += 1
      }
      operations.push({ kind, path: filePath, content: content.join('\n') })
      continue
    }

    if (kind === 'delete') {
      operations.push({ kind, path: filePath })
      continue
    }

    const hunks: PatchHunk[] = []
    while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
      if (!lines[index].startsWith('@@')) throw new Error('Invalid update hunk header')
      index += 1
      const oldLines: string[] = []
      const newLines: string[] = []
      while (
        index < lines.length - 1 &&
        !lines[index].startsWith('@@') &&
        !lines[index].startsWith('*** ')
      ) {
        const hunkLine = lines[index]
        const marker = hunkLine[0] ?? ' '
        const text = hunkLine.slice(1)
        if (marker === ' ') {
          oldLines.push(text)
          newLines.push(text)
        } else if (marker === '-') {
          oldLines.push(text)
        } else if (marker === '+') {
          newLines.push(text)
        } else {
          throw new Error(`Invalid update line: ${hunkLine}`)
        }
        index += 1
      }
      hunks.push({ oldText: oldLines.join('\n'), newText: newLines.join('\n') })
    }
    operations.push({ kind, path: filePath, hunks })
  }

  if (operations.length === 0) throw new Error('Patch contains no file operations')
  return operations
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
    execute: async ({ path: inputPath, offset = 1, limit = MAX_READ_LINES }, options) => {
      try {
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'read', options.toolCallId))
        ) {
          return 'Permission denied; the file was not read.'
        }
        const allowed = await context.askPermission('read', inputPath, 'read', options.toolCallId)
        if (!allowed) return 'Permission denied; the file was not read.'
        const filePath = await resolvePath(context.workspace, inputPath, false, external)
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
        const nested = (await context.loadNestedInstructions?.(inputPath)) ?? ''
        const body = truncate(`${numbered}${suffix}${nested ? `\n\n${nested}` : ''}`)
        const diagnostics = (await context.diagnoseFiles?.([filePath])) ?? ''
        return withNotes(body, diagnostics)
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
    execute: async ({ path: inputPath = '.', depth = 1 }, options) => {
      try {
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'list', options.toolCallId))
        ) {
          return 'Permission denied; the directory was not listed.'
        }
        const allowed = await context.askPermission('list', inputPath, 'list', options.toolCallId)
        if (!allowed) return 'Permission denied; the directory was not listed.'
        const root = await resolvePath(context.workspace, inputPath, false, external)
        const base = path.resolve(context.workspace)
        const entries: string[] = []
        await listDirectory(root, base, 1, depth, entries)
        const listed = entries.join('\n') || '(empty directory)'
        const nested = (await context.loadNestedInstructions?.(inputPath)) ?? ''
        return truncate(`${listed}${nested ? `\n\n${nested}` : ''}`)
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
      literal: z.boolean().optional().describe('Treat the pattern as literal text'),
      caseSensitive: z.boolean().optional().describe('Use case-sensitive matching'),
      maxResults: z.number().int().min(1).max(500).optional()
    }),
    execute: async (
      {
        pattern,
        path: inputPath = '.',
        include = '',
        literal = false,
        caseSensitive = false,
        maxResults = MAX_GREP_MATCHES
      },
      options
    ) => {
      try {
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'grep', options.toolCallId))
        ) {
          return 'Permission denied; the search was not run.'
        }
        const allowed = await context.askPermission('grep', pattern, 'grep', options.toolCallId)
        if (!allowed) return 'Permission denied; the search was not run.'
        const expression = new RegExp(
          literal ? escapeRegExp(pattern) : pattern,
          caseSensitive ? '' : 'i'
        )
        const root = await resolvePath(context.workspace, inputPath, false, external)
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
        const matchesText = header + (matches.join('\n') || 'No matches')
        const nested = (await context.loadNestedInstructions?.(inputPath)) ?? ''
        return truncate(`${matchesText}${nested ? `\n\n${nested}` : ''}`)
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
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'write', options.toolCallId))
        ) {
          return 'Permission denied; the file was not written.'
        }
        const allowed = await context.askPermission('write', inputPath, 'write', options.toolCallId)
        if (!allowed) return 'Permission denied; the file was not written.'
        const filePath = await resolvePath(context.workspace, inputPath, true, external)
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, content, 'utf8')
        return withNotes(
          `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${inputPath}`,
          await afterWrite(context, [filePath])
        )
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
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'edit', options.toolCallId))
        ) {
          return 'Permission denied; the file was not edited.'
        }
        const allowed = await context.askPermission('edit', inputPath, 'edit', options.toolCallId)
        if (!allowed) return 'Permission denied; the file was not edited.'
        const filePath = await resolvePath(context.workspace, inputPath, false, external)
        const text = await readFileText(filePath)
        const occurrences = text.split(oldText).length - 1
        if (occurrences === 0) return 'Error: oldText was not found'
        if (occurrences > 1 && !replaceAll) {
          return `Error: oldText occurs ${occurrences} times; pass replaceAll or use a unique match`
        }
        const next = replaceAll ? text.split(oldText).join(newText) : text.replace(oldText, newText)
        await fs.writeFile(filePath, next, 'utf8')
        return withNotes(
          `Replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${inputPath}`,
          await afterWrite(context, [filePath])
        )
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
      timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
      background: z.boolean().optional().describe('Run in the background and return immediately')
    }),
    execute: async ({ command, cwd = '.', timeoutMs = 120_000, background = false }, options) => {
      try {
        const external = escapesWorkspace(context.workspace, cwd)
        if (external && !(await ensureExternalAccess(context, cwd, 'shell', options.toolCallId))) {
          return 'Permission denied; the command was not run.'
        }
        const allowed = await context.askPermission('shell', command, 'shell', options.toolCallId)
        if (!allowed) return 'Permission denied; the command was not run.'
        const workdir = await resolvePath(context.workspace, cwd, false, external)

        if (background) {
          const outputPath = context.backgroundOutputPath
            ? await context.backgroundOutputPath(options.toolCallId)
            : null
          const handle = outputPath ? await fs.open(outputPath, 'a') : null
          const descriptor = handle?.fd ?? null
          const child = spawn(command, {
            cwd: workdir,
            shell: true,
            detached: process.platform !== 'win32',
            env: process.env,
            stdio: descriptor === null ? 'ignore' : ['ignore', descriptor, descriptor]
          })
          let finished = false
          const finish = (code: number | null): void => {
            if (finished) return
            finished = true
            if (handle) void handle.close()
            context.onBackgroundFinished?.({
              toolCallId: options.toolCallId,
              command,
              exitCode: code,
              outputPath
            })
          }
          child.on('error', () => finish(null))
          child.on('close', (code) => finish(code))
          child.unref()
          return `Started background command (pid ${child.pid ?? 'unknown'}).${
            outputPath ? ` Output: ${outputPath}` : ''
          }`
        }

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
            const text = chunk.toString('utf8')
            const remaining = Math.max(0, MAX_TOOL_OUTPUT - output.length)
            output += text
            const delta = text.slice(0, remaining)
            if (delta) context.onToolOutput?.(options.toolCallId, delta)
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

  const glob = tool({
    description:
      'Find files in the workspace by glob pattern such as **/*.ts. Skips ignored directories by default.',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern relative to the workspace'),
      path: z.string().optional().describe('Directory to search from'),
      hidden: z.boolean().optional().describe('Include hidden files and directories'),
      limit: z.number().int().min(1).max(1_000).optional()
    }),
    execute: async ({ pattern, path: inputPath = '.', hidden = false, limit = 100 }, options) => {
      try {
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'glob', options.toolCallId))
        ) {
          return 'Permission denied; the file search was not run.'
        }
        const allowed = await context.askPermission('list', pattern, 'glob', options.toolCallId)
        if (!allowed) return 'Permission denied; the file search was not run.'
        const base = await resolvePath(context.workspace, inputPath, false, external)
        const root = path.resolve(context.workspace)
        const matcher = globExpression(pattern)
        const matches: string[] = []
        let stopped = false

        const walk = async (directory: string, depth: number): Promise<void> => {
          if (depth > 12 || stopped) return
          const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
          for (const entry of entries) {
            if (stopped) return
            if (IGNORED_DIRS.has(entry.name)) continue
            if (!hidden && entry.name.startsWith('.')) continue
            const absolute = path.join(directory, entry.name)
            if (entry.isDirectory()) {
              await walk(absolute, depth + 1)
            } else if (entry.isFile()) {
              const relative = path.relative(root, absolute).split(path.sep).join('/')
              const relativeToBase = path.relative(base, absolute).split(path.sep).join('/')
              if (!matcher.test(relativeToBase)) continue
              matches.push(relative)
              if (matches.length >= limit) {
                stopped = true
                return
              }
            }
          }
        }

        await walk(base, 0)
        matches.sort()
        const header = stopped ? `[stopped at ${limit} results]\n` : ''
        const listed = header + (matches.join('\n') || 'No matches')
        const nested = (await context.loadNestedInstructions?.(inputPath)) ?? ''
        return truncate(`${listed}${nested ? `\n\n${nested}` : ''}`)
      } catch (error) {
        return safeError(error)
      }
    }
  })

  const patch = tool({
    description:
      'Apply one patch that can add, update, move, or delete several files. Requires approval for each file.',
    inputSchema: z.object({
      patchText: z
        .string()
        .describe('Patch text using *** Add File, *** Update File and *** Delete File sections')
    }),
    execute: async ({ patchText }, options) => {
      try {
        const operations = parsePatch(patchText)
        for (const operation of operations) {
          if (!(await ensureExternalAccess(context, operation.path, 'patch', options.toolCallId))) {
            return 'Permission denied; the patch was not applied.'
          }
          const allowed = await context.askPermission(
            'edit',
            operation.path,
            'patch',
            options.toolCallId
          )
          if (!allowed) return 'Permission denied; the patch was not applied.'
        }

        const summary: string[] = []
        const changed: string[] = []
        for (const operation of operations) {
          const external = escapesWorkspace(context.workspace, operation.path)
          if (operation.kind === 'add') {
            const filePath = await resolvePath(context.workspace, operation.path, true, external)
            await fs.mkdir(path.dirname(filePath), { recursive: true })
            await fs.writeFile(filePath, operation.content ?? '', 'utf8')
            summary.push(`Added ${operation.path}`)
            changed.push(filePath)
            continue
          }
          if (operation.kind === 'delete') {
            const filePath = await resolvePath(context.workspace, operation.path, false, external)
            await fs.rm(filePath, { force: true })
            summary.push(`Deleted ${operation.path}`)
            continue
          }
          const filePath = await resolvePath(context.workspace, operation.path, false, external)
          let text = await readFileText(filePath)
          for (const hunk of operation.hunks ?? []) {
            if (!text.includes(hunk.oldText)) {
              return `Error: old text not found in ${operation.path}`
            }
            text = text.replace(hunk.oldText, hunk.newText)
          }
          await fs.writeFile(filePath, text, 'utf8')
          summary.push(`Updated ${operation.path}`)
          changed.push(filePath)
        }
        return withNotes(summary.join('\n'), await afterWrite(context, [...new Set(changed)]))
      } catch (error) {
        return safeError(error)
      }
    }
  })

  const subagent = tool({
    description:
      'Delegate a focused task to a subagent that works in its own context and returns the result. Use sessionId to continue an earlier subagent session.',
    inputSchema: z.object({
      prompt: z.string().min(1).describe('Task instructions for the subagent'),
      agent: z.string().optional().describe('Subagent name such as explore or general'),
      sessionId: z.string().optional().describe('Continue a previous subagent session'),
      description: z.string().optional().describe('Short task summary')
    }),
    execute: async (input, options) => {
      if (!context.runSubagent) return 'Error: subagents are not available.'
      return context.runSubagent(input, options.toolCallId)
    }
  })

  const websearch = tool({
    description:
      'Search the web for a query and return result titles, URLs and snippets. Requires approval.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query'),
      count: z.number().int().min(1).max(10).optional().describe('Number of results (default 5)')
    }),
    execute: async ({ query, count = 5 }, options) => {
      if (!context.webSearch) return 'Error: web search is not available.'
      const allowed = await context.askPermission(
        'websearch',
        query,
        'websearch',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the search was not run.'
      return context.webSearch({ query, count })
    }
  })

  const webfetch = tool({
    description:
      'Fetch a web page and return its content as markdown, plain text or raw HTML. Requires approval.',
    inputSchema: z.object({
      url: z.string().describe('http(s) URL to fetch'),
      format: z
        .enum(['markdown', 'text', 'html'])
        .optional()
        .describe('Output format (default markdown)'),
      timeoutMs: z.number().int().min(1_000).max(120_000).optional()
    }),
    execute: async (input, options) => {
      if (!context.fetchWeb) return 'Error: web fetching is not available.'
      const allowed = await context.askPermission(
        'webfetch',
        input.url,
        'webfetch',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the page was not fetched.'
      return context.fetchWeb({
        url: input.url,
        format: input.format ?? 'markdown',
        timeoutMs: input.timeoutMs
      })
    }
  })

  const skill = tool({
    description:
      'Load the full instructions of an available skill by name. Use a skill when its description matches the task.',
    inputSchema: z.object({
      name: z.string().min(1).describe('Skill name as listed in the system prompt')
    }),
    execute: async ({ name }, options) => {
      if (!context.loadSkill) return 'Error: skills are not available.'
      const allowed = await context.askPermission('skill', name, 'skill', options.toolCallId)
      if (!allowed) return 'Permission denied; the skill was not loaded.'
      return context.loadSkill(name)
    }
  })

  return wrapToolOutputs(
    { read, list, grep, glob, patch, write, edit, shell, subagent, websearch, webfetch, skill },
    context
  )
}

function wrapToolOutputs(tools: ToolSet, context: ToolContext): ToolSet {
  if (!context.storeOutput) return tools
  const wrapped: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(tools)) {
    const executable = definition as unknown as {
      execute?: (input: never, options: { toolCallId: string }) => unknown
    }
    if (typeof executable.execute !== 'function') {
      wrapped[name] = definition
      continue
    }
    const execute = executable.execute
    wrapped[name] = {
      ...definition,
      execute: async (input: never, options: { toolCallId: string }) => {
        const result = await execute(input, options)
        if (typeof result !== 'string') return result
        return (await context.storeOutput?.(options.toolCallId, result))?.output ?? result
      }
    }
  }
  return wrapped as ToolSet
}
