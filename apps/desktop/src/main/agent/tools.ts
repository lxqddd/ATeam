import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { runCodeScript } from './code-mode'
import { ripgrepSearch } from './integrations/ripgrep'
import { extractPdfText } from './attachments'
import type {
  PermissionAction,
  QuestionInput,
  SubagentInput,
  TodoInput,
  WebFetchFormat
} from '@ateam/shared'

const MAX_TOOL_OUTPUT = 200_000
const MAX_READ_LINES = 2_000
const MAX_LIST_ENTRIES = 500
const MAX_GREP_MATCHES = 100
const GLOB_TIMEOUT_MS = 10_000
const MAX_READ_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_READ_PDF_BYTES = 10 * 1024 * 1024
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}
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
  writeTodos?: (todos: TodoInput[]) => Promise<string>
  readTodos?: () => Promise<string>
  askQuestion?: (input: QuestionInput, toolCallId: string) => Promise<string>
  listMcpPrompts?: (server?: string) => Promise<string>
  getMcpPrompt?: (server: string, prompt: string, args?: Record<string, string>) => Promise<string>
  listMcpResources?: (server?: string) => Promise<string>
  readMcpResource?: (server: string, uri: string) => Promise<string>
  grepEngine?: 'auto' | 'js'
  globTimeoutMs?: number
  lspHover?: (file: string, line: number, character: number) => Promise<string>
  lspDefinition?: (file: string, line: number, character: number) => Promise<string>
  worktreeCreate?: (input: { name: string; base?: string | null }) => Promise<string>
  worktreeList?: () => Promise<string>
  worktreeRemove?: (path: string, force: boolean) => Promise<string>
  moveSession?: (directory: string) => Promise<string>
  browserOpen?: (url: string, newTab?: boolean) => Promise<string>
  browserTabs?: () => Promise<string>
  browserSnapshot?: (tabId?: string) => Promise<string>
  browserClick?: (ref: string, tabId?: string) => Promise<string>
  browserType?: (ref: string, text: string, submit: boolean, tabId?: string) => Promise<string>
  browserScreenshot?: (
    tabId?: string
  ) => Promise<string | { summary: string; image: { mimeType: string; data: string } }>
  browserEval?: (code: string, tabId?: string) => Promise<string>
  browserNetwork?: (tabId?: string) => Promise<string>
  browserUpload?: (ref: string, path: string, tabId?: string) => Promise<string>
  browserClose?: (tabId?: string) => Promise<string>
  codeModeTools?: () => ToolSet
  codeTimeoutMs?: number
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

async function runCodeMode(
  tools: ToolSet,
  context: ToolContext,
  code: string,
  toolCallId: string
): Promise<string> {
  const preview = code.replace(/\s+/g, ' ').trim().slice(0, 200)
  const allowed = await context.askPermission(
    'shell',
    `code mode: ${preview}`,
    'execute',
    toolCallId
  )
  if (!allowed) return 'Permission denied; the code was not run.'

  return runCodeScript({
    tools: context.codeModeTools?.() ?? tools,
    code,
    timeoutMs: context.codeTimeoutMs ?? 10_000,
    toolCallId,
    signal: context.signal
  })
}

export function createTools(context: ToolContext): ToolSet {
  const read = tool({
    description:
      'Read a file inside the workspace. Text files return numbered lines (use offset/limit); images are returned as image content and PDFs as extracted text.',
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
        const extension = path.extname(filePath).toLowerCase()
        const imageMime = IMAGE_MIME[extension]
        if (imageMime) {
          const data = await fs.readFile(filePath)
          if (data.byteLength > MAX_READ_IMAGE_BYTES) return 'Error: image exceeds 5 MB'
          return {
            summary: `Image: ${inputPath} (${data.byteLength} bytes, ${imageMime})`,
            image: { mimeType: imageMime, data: data.toString('base64') }
          }
        }
        if (extension === '.pdf') {
          const data = await fs.readFile(filePath)
          if (data.byteLength > MAX_READ_PDF_BYTES) return 'Error: PDF exceeds 10 MB'
          const extracted = await extractPdfText(new Uint8Array(data))
          if (!extracted)
            return 'Error: the PDF has no extractable text; attach it in the composer.'
          return truncate(`PDF: ${inputPath}\n\`\`\`\n${extracted}\n\`\`\``)
        }
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
    },
    toModelOutput: ({ output }) => {
      if (output && typeof output === 'object' && 'image' in output) {
        const value = output as { summary: string; image: { mimeType: string; data: string } }
        return {
          type: 'content',
          value: [
            { type: 'text', text: value.summary },
            { type: 'image-data', data: value.image.data, mediaType: value.image.mimeType }
          ]
        }
      }
      return { type: 'text', value: typeof output === 'string' ? output : JSON.stringify(output) }
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
        let usedRipgrep = false
        if (context.grepEngine !== 'js') {
          const results = await ripgrepSearch({
            cwd: root,
            pattern,
            literal,
            caseSensitive,
            include: include || undefined,
            maxResults,
            signal: context.signal
          }).catch(() => null)
          if (results) {
            usedRipgrep = true
            for (const match of results) {
              matches.push(
                `${path.relative(base, path.resolve(root, match.path))}:${match.line}: ${match.text}`
              )
            }
            stop = matches.length >= maxResults
          }
        }
        if (!usedRipgrep)
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
        const next = replaceAll
          ? text.split(oldText).join(newText)
          : text.replace(oldText, () => newText)
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

  const lspHover = tool({
    description:
      'Get hover information such as types or documentation for a symbol at a 1-based line and character.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to the workspace'),
      line: z.number().int().min(1).describe('1-based line number'),
      character: z.number().int().min(1).optional().describe('1-based character position')
    }),
    execute: async ({ path: inputPath, line, character = 1 }, options) => {
      try {
        if (!context.lspHover) return 'Error: LSP is not available.'
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'read', options.toolCallId))
        ) {
          return 'Permission denied; the query was not run.'
        }
        const allowed = await context.askPermission(
          'read',
          inputPath,
          'lsp_hover',
          options.toolCallId
        )
        if (!allowed) return 'Permission denied; the query was not run.'
        const filePath = await resolvePath(context.workspace, inputPath, false, external)
        return (await context.lspHover(filePath, line, character)) || 'No hover information.'
      } catch (error) {
        return safeError(error)
      }
    }
  })

  const lspDefinition = tool({
    description:
      'Find the definition of a symbol at a 1-based line and character and return its file position.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to the workspace'),
      line: z.number().int().min(1).describe('1-based line number'),
      character: z.number().int().min(1).optional().describe('1-based character position')
    }),
    execute: async ({ path: inputPath, line, character = 1 }, options) => {
      try {
        if (!context.lspDefinition) return 'Error: LSP is not available.'
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'read', options.toolCallId))
        ) {
          return 'Permission denied; the query was not run.'
        }
        const allowed = await context.askPermission(
          'read',
          inputPath,
          'lsp_definition',
          options.toolCallId
        )
        if (!allowed) return 'Permission denied; the query was not run.'
        const filePath = await resolvePath(context.workspace, inputPath, false, external)
        return (await context.lspDefinition(filePath, line, character)) || 'No definition found.'
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
        let timedOut = false
        const deadline = Date.now() + (context.globTimeoutMs ?? GLOB_TIMEOUT_MS)

        const walk = async (directory: string, depth: number): Promise<void> => {
          if (depth > 12 || stopped) return
          if (Date.now() >= deadline) {
            timedOut = true
            stopped = true
            return
          }
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
        const header = timedOut
          ? '[glob timed out]\n'
          : stopped
            ? `[stopped at ${limit} results]\n`
            : ''
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

        const preparedUpdates = new Map<number, string>()
        const preparedFiles = new Map<string, string>()
        for (const [index, operation] of operations.entries()) {
          if (operation.kind !== 'update') continue
          const external = escapesWorkspace(context.workspace, operation.path)
          const filePath = await resolvePath(context.workspace, operation.path, false, external)
          let text = preparedFiles.get(filePath) ?? (await readFileText(filePath))
          for (const hunk of operation.hunks ?? []) {
            if (!text.includes(hunk.oldText)) {
              return `Error: old text not found in ${operation.path}`
            }
            text = text.replace(hunk.oldText, () => hunk.newText)
          }
          preparedFiles.set(filePath, text)
          preparedUpdates.set(index, text)
        }

        const summary: string[] = []
        const changed: string[] = []
        for (const [index, operation] of operations.entries()) {
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
          const text = preparedUpdates.get(index)
          if (text === undefined)
            return `Error: patch update could not be prepared for ${operation.path}`
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
      description: z.string().optional().describe('Short task summary'),
      background: z
        .boolean()
        .optional()
        .describe('Run in the background and report completion as a notification')
    }),
    execute: async (input, options) => {
      if (!context.runSubagent) return 'Error: subagents are not available.'
      const agentName = input.agent?.trim() || 'general'
      const allowed = await context.askPermission(
        'subagent',
        agentName,
        'subagent',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the subagent was not started.'
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

  const todoItemSchema = z.object({
    content: z.string().min(1).max(500).describe('Task description'),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
    priority: z.enum(['high', 'medium', 'low'])
  })

  const todowrite = tool({
    description:
      'Replace the session todo list. Use it to track progress on multi-step work; statuses are pending, in_progress, completed and cancelled.',
    inputSchema: z.object({
      todos: z.array(todoItemSchema).max(50).describe('The complete todo list')
    }),
    execute: async ({ todos }) => {
      if (!context.writeTodos) return 'Error: todo tracking is not available.'
      return context.writeTodos(todos)
    }
  })

  const todoread = tool({
    description: 'Read the current session todo list.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!context.readTodos) return 'Error: todo tracking is not available.'
      return context.readTodos()
    }
  })

  const question = tool({
    description:
      'Ask the user a structured question when a decision is genuinely theirs. Options are shown as buttons or checkboxes; free-form input can be enabled.',
    inputSchema: z.object({
      header: z.string().min(1).max(50).describe('Short label for the question'),
      question: z.string().min(1).max(500).describe('The question to ask'),
      options: z
        .array(
          z.object({
            label: z.string().min(1).max(100),
            description: z.string().max(300).optional()
          })
        )
        .min(1)
        .max(6),
      multiple: z.boolean().optional().describe('Allow selecting several options'),
      allowCustom: z.boolean().optional().describe('Allow a free-form answer')
    }),
    execute: async (input, options) => {
      if (!context.askQuestion) return 'Error: questions are not available.'
      return context.askQuestion(input, options.toolCallId)
    }
  })

  const browserOpen = tool({
    description:
      'Open a URL in the desktop app browser and return the page title. Use browser_snapshot afterwards to see the page and its interactive elements.',
    inputSchema: z.object({
      url: z.string().min(1).max(2_000).describe('HTTP or HTTPS URL'),
      newTab: z.boolean().optional().describe('Open in a new tab instead of navigating')
    }),
    execute: async ({ url, newTab = false }: { url: string; newTab?: boolean }, options) => {
      if (!context.browserOpen) return 'Error: browser automation is not available.'
      const allowed = await context.askPermission(
        'webfetch',
        url,
        'browser_open',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the page was not opened.'
      return context.browserOpen(url, newTab)
    }
  })

  const browserTabs = tool({
    description: 'List the browser tabs of this session and their ids.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!context.browserTabs) return 'Error: browser automation is not available.'
      return context.browserTabs()
    }
  })

  const browserSnapshot = tool({
    description:
      'Return the browser page title, URL, visible text, console output and numbered interactive elements. Element refs are valid until the next navigation or snapshot.',
    inputSchema: z.object({
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({ tabId }: { tabId?: string }) => {
      if (!context.browserSnapshot) return 'Error: browser automation is not available.'
      return context.browserSnapshot(tabId)
    }
  })

  const browserClick = tool({
    description: 'Click an interactive element by its snapshot ref.',
    inputSchema: z.object({
      ref: z.string().min(1).max(12).describe('Element ref from browser_snapshot'),
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({ ref, tabId }: { ref: string; tabId?: string }) => {
      if (!context.browserClick) return 'Error: browser automation is not available.'
      return context.browserClick(ref, tabId)
    }
  })

  const browserType = tool({
    description:
      'Type text into an input or textarea by snapshot ref. Set submit to submit the surrounding form.',
    inputSchema: z.object({
      ref: z.string().min(1).max(12).describe('Element ref from browser_snapshot'),
      text: z.string().max(20_000).describe('Text to enter'),
      submit: z.boolean().optional().describe('Submit the form after typing'),
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({
      ref,
      text,
      submit = false,
      tabId
    }: {
      ref: string
      text: string
      submit?: boolean
      tabId?: string
    }) => {
      if (!context.browserType) return 'Error: browser automation is not available.'
      return context.browserType(ref, text, submit, tabId)
    }
  })

  const browserScreenshot = tool({
    description: 'Capture the visible browser page as a PNG screenshot.',
    inputSchema: z.object({
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({ tabId }: { tabId?: string }) => {
      if (!context.browserScreenshot) return 'Error: browser automation is not available.'
      return context.browserScreenshot(tabId)
    },
    toModelOutput: ({ output }) => {
      if (output && typeof output === 'object' && 'image' in output) {
        return {
          type: 'content',
          value: [
            { type: 'text', text: output.summary },
            {
              type: 'image-data',
              data: output.image.data,
              mediaType: output.image.mimeType
            }
          ]
        }
      }
      return { type: 'text', value: typeof output === 'string' ? output : JSON.stringify(output) }
    }
  })

  const browserEval = tool({
    description:
      'Evaluate JavaScript in the current browser page and return a compact JSON result. Use it for page state that the snapshot does not expose.',
    inputSchema: z.object({
      code: z.string().min(1).max(20_000).describe('JavaScript expression or statements'),
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({ code, tabId }: { code: string; tabId?: string }, options) => {
      if (!context.browserEval) return 'Error: browser automation is not available.'
      const allowed = await context.askPermission(
        'shell',
        `browser eval: ${code.replace(/\s+/g, ' ').slice(0, 160)}`,
        'browser_eval',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the code was not evaluated.'
      return context.browserEval(code, tabId)
    }
  })

  const browserNetwork = tool({
    description: 'List recent network requests made by the current browser page.',
    inputSchema: z.object({
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async ({ tabId }: { tabId?: string }) => {
      if (!context.browserNetwork) return 'Error: browser automation is not available.'
      return context.browserNetwork(tabId)
    }
  })

  const browserUpload = tool({
    description: 'Attach a workspace file to a file input identified by its snapshot ref.',
    inputSchema: z.object({
      ref: z.string().min(1).max(12).describe('File input ref from browser_snapshot'),
      path: z.string().min(1).max(1_000).describe('Workspace-relative file path'),
      tabId: z.string().max(40).optional().describe('Tab id; defaults to the active tab')
    }),
    execute: async (
      { ref, path: inputPath, tabId }: { ref: string; path: string; tabId?: string },
      options
    ) => {
      if (!context.browserUpload) return 'Error: browser automation is not available.'
      try {
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'read', options.toolCallId))
        ) {
          return 'Permission denied; the file was not uploaded.'
        }
        const allowed = await context.askPermission(
          'read',
          inputPath,
          'browser_upload',
          options.toolCallId
        )
        if (!allowed) return 'Permission denied; the file was not uploaded.'
        const filePath = await resolvePath(context.workspace, inputPath, false, external)
        return context.browserUpload(ref, filePath, tabId)
      } catch (error) {
        return safeError(error)
      }
    }
  })

  const browserClose = tool({
    description: 'Close one browser tab, or the whole browser when no tabId is given.',
    inputSchema: z.object({
      tabId: z.string().max(40).optional().describe('Tab id to close; omit to close all tabs')
    }),
    execute: async ({ tabId }: { tabId?: string }) => {
      if (!context.browserClose) return 'Error: browser automation is not available.'
      return context.browserClose(tabId)
    }
  })

  const worktreeCreate = tool({
    description:
      'Create a Git worktree for the current project and return its directory. The worktree gets its own branch, or reuses an existing branch with the same name. Use session_move to continue working there.',
    inputSchema: z.object({
      name: z.string().min(1).max(200).describe('Worktree and branch name, e.g. feature/login'),
      base: z.string().max(200).optional().describe('Revision to branch from (default HEAD)')
    }),
    execute: async (input, options) => {
      if (!context.worktreeCreate) return 'Error: worktree management is not available.'
      const allowed = await context.askPermission(
        'shell',
        `git worktree add ${input.name}`,
        'worktree_create',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the worktree was not created.'
      return context.worktreeCreate(input)
    }
  })

  const worktreeList = tool({
    description: 'List the Git worktrees of the current project, including the main checkout.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!context.worktreeList) return 'Error: worktree management is not available.'
      return context.worktreeList()
    }
  })

  const worktreeRemove = tool({
    description:
      'Remove a worktree managed by ATeam. Set force to discard uncommitted changes. The main checkout cannot be removed.',
    inputSchema: z.object({
      path: z.string().min(1).max(1_000).describe('Worktree directory'),
      force: z.boolean().optional().describe('Discard uncommitted changes')
    }),
    execute: async ({ path: worktreePath, force = false }, options) => {
      if (!context.worktreeRemove) return 'Error: worktree management is not available.'
      const allowed = await context.askPermission(
        'edit',
        worktreePath,
        'worktree_remove',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the worktree was not removed.'
      return context.worktreeRemove(worktreePath, force)
    }
  })

  const sessionMove = tool({
    description:
      'Move this session to another directory, typically a newly created worktree. The move takes effect on the next message; the current run keeps using the current directory.',
    inputSchema: z.object({
      directory: z.string().min(1).max(1_000).describe('Absolute path of the new working directory')
    }),
    execute: async ({ directory }, options) => {
      if (!context.moveSession) return 'Error: session moves are not available.'
      const allowed = await context.askPermission(
        'edit',
        directory,
        'session_move',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the session was not moved.'
      return context.moveSession(directory)
    }
  })

  const mcpPrompt = tool({
    description:
      'List MCP prompts, or load one prompt by server and name and return its messages. Omit prompt to list.',
    inputSchema: z.object({
      server: z.string().optional().describe('MCP server name'),
      prompt: z.string().optional().describe('Prompt name to load'),
      arguments: z.record(z.string(), z.string()).optional().describe('Arguments for the prompt')
    }),
    execute: async (input, options) => {
      if (!input.prompt) {
        if (!context.listMcpPrompts) return 'Error: MCP prompts are not available.'
        return context.listMcpPrompts(input.server)
      }
      if (!context.getMcpPrompt) return 'Error: MCP prompts are not available.'
      const server = input.server?.trim()
      if (!server) return 'Error: server is required to load an MCP prompt.'
      const allowed = await context.askPermission(
        'mcp',
        `${server}/prompts/${input.prompt}`,
        'mcp_prompt',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the MCP prompt was not loaded.'
      return context.getMcpPrompt(server, input.prompt, input.arguments)
    }
  })

  const mcpResource = tool({
    description: 'List MCP resources, or read one resource by server and URI. Omit uri to list.',
    inputSchema: z.object({
      server: z.string().optional().describe('MCP server name'),
      uri: z.string().optional().describe('Resource URI to read')
    }),
    execute: async (input, options) => {
      if (!input.uri) {
        if (!context.listMcpResources) return 'Error: MCP resources are not available.'
        return context.listMcpResources(input.server)
      }
      if (!context.readMcpResource) return 'Error: MCP resources are not available.'
      const server = input.server?.trim()
      if (!server) return 'Error: server is required to read an MCP resource.'
      const allowed = await context.askPermission(
        'mcp',
        `${server}/resources/${input.uri}`,
        'mcp_resource',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the MCP resource was not read.'
      return context.readMcpResource(server, input.uri)
    }
  })

  const rawTools: ToolSet = {
    read,
    list,
    grep,
    glob,
    patch,
    write,
    edit,
    shell,
    subagent,
    websearch,
    webfetch,
    skill,
    todowrite,
    todoread,
    question,
    lsp_hover: lspHover,
    lsp_definition: lspDefinition,
    worktree_create: worktreeCreate,
    worktree_list: worktreeList,
    worktree_remove: worktreeRemove,
    session_move: sessionMove,
    ...(context.browserOpen
      ? {
          browser_open: browserOpen,
          browser_tabs: browserTabs,
          browser_snapshot: browserSnapshot,
          browser_click: browserClick,
          browser_type: browserType,
          browser_screenshot: browserScreenshot,
          browser_eval: browserEval,
          browser_network: browserNetwork,
          browser_upload: browserUpload,
          browser_close: browserClose
        }
      : {}),
    mcp_prompt: mcpPrompt,
    mcp_resource: mcpResource
  }

  const execute = tool({
    description:
      'Run JavaScript to orchestrate several tool calls in one step. Access tools as `await tools.<name>(input)` using the same names and inputs as direct tool calls, and use console.log for output. Only the value you return and what you log are added to the conversation; intermediate tool results stay inside the script. The script requires shell approval, runs in a separate terminated-after-inactivity worker, and inner tool calls still go through their normal permission checks. Prefer a direct tool call for a single operation.',
    inputSchema: z.object({
      code: z
        .string()
        .min(1)
        .max(20_000)
        .describe(
          'Async JavaScript body; return a concise result, e.g. `return await tools.grep({...})`'
        )
    }),
    execute: async ({ code }, options) => runCodeMode(rawTools, context, code, options.toolCallId)
  })

  return wrapToolOutputs({ ...rawTools, execute }, context)
}

export function filterToolsForModel(tools: ToolSet, applyPatch: boolean): ToolSet {
  const filtered = { ...tools }
  if (applyPatch) {
    delete filtered.edit
    delete filtered.write
  } else {
    delete filtered.patch
  }
  return filtered
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
