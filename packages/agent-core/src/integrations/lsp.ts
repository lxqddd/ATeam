import { spawn as nodeSpawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AgentConfig } from '@ateam/shared'
import { resolveExecutable } from './executables'

const MAX_DIAGNOSTIC_FILESIZE = 1_000_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 5_000
const MAX_REPORTED_DIAGNOSTICS = 20

export interface LspDiagnostic {
  line: number
  character: number
  severity: number
  message: string
  source?: string
  code?: string | number
}

export interface LspServerDefinition {
  id: string
  extensions: readonly string[]
  command: readonly string[]
  env?: Record<string, string>
  initialization?: Record<string, unknown>
}

export interface LspChildProcess {
  stdin: NodeJS.WritableStream | null
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'exit', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type LspSpawn = (
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv }
) => LspChildProcess

interface LspMessage {
  jsonrpc?: string
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string }
}

const MAX_LSP_BUFFER_BYTES = 10 * 1024 * 1024

const LANGUAGE_IDS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.go': 'go',
  '.py': 'python',
  '.pyi': 'python',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp'
}

export function resolveLspServers(config?: AgentConfig): readonly LspServerDefinition[] {
  const servers = new Map(LSP_SERVERS.map((server) => [server.id, { ...server }]))
  for (const [id, input] of Object.entries(config?.lspServers ?? {})) {
    if (input.disabled) {
      servers.delete(id)
      continue
    }
    const existing = servers.get(id)
    const command = input.command && input.command.length > 0 ? input.command : existing?.command
    if (!command || command.length === 0) continue
    servers.set(id, {
      id,
      command,
      extensions: input.extensions ?? existing?.extensions ?? [],
      ...(input.env ? { env: input.env } : {}),
      ...(input.initialization ? { initialization: input.initialization } : {})
    })
  }
  return [...servers.values()]
}

export const LSP_SERVERS: readonly LspServerDefinition[] = [
  {
    id: 'typescript',
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    command: ['typescript-language-server', '--stdio']
  },
  { id: 'gopls', extensions: ['.go'], command: ['gopls'] },
  { id: 'pyright', extensions: ['.py', '.pyi'], command: ['pyright-langserver', '--stdio'] },
  { id: 'rust-analyzer', extensions: ['.rs'], command: ['rust-analyzer'] },
  {
    id: 'clangd',
    extensions: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp'],
    command: ['clangd']
  }
]

export function lspServerForFile(
  filePath: string,
  servers: readonly LspServerDefinition[] = LSP_SERVERS
): LspServerDefinition | null {
  const extension = path.extname(filePath).toLowerCase()
  return servers.find((server) => server.extensions.includes(extension)) ?? null
}

export function languageIdForFile(filePath: string): string {
  return LANGUAGE_IDS[path.extname(filePath).toLowerCase()] ?? 'plaintext'
}

export function fileUri(filePath: string): string {
  return pathToFileURL(path.resolve(filePath)).href
}

export function filePathFromUri(uri: string): string {
  return fileURLToPath(uri)
}

export function encodeLspMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

export function decodeLspMessages(buffer: Buffer): { messages: unknown[]; rest: Buffer } {
  const messages: unknown[] = []
  let rest = buffer
  for (;;) {
    const headerEnd = rest.indexOf('\r\n\r\n')
    if (headerEnd === -1) break
    const header = rest.subarray(0, headerEnd).toString('ascii')
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    if (!match) {
      rest = rest.subarray(headerEnd + 4)
      continue
    }
    const start = headerEnd + 4
    const length = Number(match[1])
    if (rest.length < start + length) break
    const body = rest.subarray(start, start + length).toString('utf8')
    rest = rest.subarray(start + length)
    try {
      messages.push(JSON.parse(body))
    } catch {
      /* skip malformed payloads */
    }
  }
  return { messages, rest }
}

function toDiagnostic(value: unknown): LspDiagnostic {
  const raw = (value ?? {}) as {
    range?: { start?: { line?: number; character?: number } }
    severity?: number
    message?: string
    source?: string
    code?: string | number
  }
  return {
    line: (raw.range?.start?.line ?? 0) + 1,
    character: (raw.range?.start?.character ?? 0) + 1,
    severity: raw.severity ?? 1,
    message: raw.message ?? '',
    ...(raw.source ? { source: raw.source } : {}),
    ...(raw.code !== undefined ? { code: raw.code } : {})
  }
}

export class LspClient {
  private child: LspChildProcess | null = null
  private startPromise: Promise<void> | null = null
  private exited = false
  private nextId = 1
  private buffer: Buffer = Buffer.alloc(0)
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()
  private waiters = new Map<string, Array<(diagnostics: LspDiagnostic[]) => void>>()
  private openDocuments = new Map<string, number>()
  private readonly requestTimeoutMs: number
  private readonly diagnosticsTimeoutMs: number

  constructor(
    private readonly options: {
      workspace: string
      server: LspServerDefinition
      command: string
      spawn?: LspSpawn
      env?: NodeJS.ProcessEnv
      requestTimeoutMs?: number
      diagnosticsTimeoutMs?: number
    }
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.diagnosticsTimeoutMs = options.diagnosticsTimeoutMs ?? DEFAULT_DIAGNOSTICS_TIMEOUT_MS
  }

  start(): Promise<void> {
    this.startPromise ??= this.launch()
    return this.startPromise
  }

  private async launch(): Promise<void> {
    const spawn = this.options.spawn ?? (nodeSpawn as unknown as LspSpawn)
    const [, ...args] = this.options.server.command
    const child = spawn(this.options.command, args, {
      cwd: this.options.workspace,
      env: this.options.env
    })
    this.child = child
    child.stdout?.on('data', (chunk: Buffer) => this.handleData(chunk))
    child.stderr?.on('data', () => undefined)
    child.on('exit', () => this.handleExit())
    child.on('error', () => this.handleExit())

    await this.request('initialize', {
      ...(this.options.server.initialization ?? {}),
      processId: process.pid,
      clientInfo: { name: 'ATeam' },
      rootUri: fileUri(this.options.workspace),
      workspaceFolders: [
        { uri: fileUri(this.options.workspace), name: path.basename(this.options.workspace) }
      ],
      capabilities: {
        textDocument: { synchronization: { didSave: false }, publishDiagnostics: {} },
        workspace: { workspaceFolders: true }
      }
    })
    this.notify('initialized', {})
  }

  async diagnostics(filePath: string, text: string): Promise<LspDiagnostic[]> {
    if (this.exited) return []
    await this.start()
    if (this.exited) return []

    const uri = fileUri(filePath)
    const pending = this.waitForDiagnostics(uri)
    try {
      this.syncDocument(filePath, text)
    } catch {
      return []
    }
    return pending
  }

  private syncDocument(filePath: string, text: string): string {
    const uri = fileUri(filePath)
    const version = this.openDocuments.get(uri)
    if (version === undefined) {
      this.openDocuments.set(uri, 1)
      this.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: languageIdForFile(filePath), version: 1, text }
      })
    } else {
      this.openDocuments.set(uri, version + 1)
      this.notify('textDocument/didChange', {
        textDocument: { uri, version: version + 1 },
        contentChanges: [{ text }]
      })
    }
    return uri
  }

  async hover(filePath: string, text: string, line: number, character: number): Promise<unknown> {
    return this.positionQuery('textDocument/hover', filePath, text, line, character)
  }

  async definition(
    filePath: string,
    text: string,
    line: number,
    character: number
  ): Promise<unknown> {
    return this.positionQuery('textDocument/definition', filePath, text, line, character)
  }

  private async positionQuery(
    method: string,
    filePath: string,
    text: string,
    line: number,
    character: number
  ): Promise<unknown> {
    if (this.exited) return null
    await this.start()
    if (this.exited) return null
    let uri: string
    try {
      uri = this.syncDocument(filePath, text)
    } catch {
      return null
    }
    return this.request(method, {
      textDocument: { uri },
      position: { line: Math.max(0, line - 1), character: Math.max(0, character - 1) }
    })
  }

  async dispose(): Promise<void> {
    if (!this.child && this.exited) return
    if (!this.exited) {
      try {
        this.write({ jsonrpc: '2.0', id: this.nextId++, method: 'shutdown', params: null })
        this.write({ jsonrpc: '2.0', method: 'exit', params: null })
      } catch {
        /* the server may already be gone */
      }
    }
    this.handleExit()
    try {
      this.child?.kill()
    } catch {
      /* the process may already be gone */
    }
    this.child = null
  }

  private waitForDiagnostics(uri: string): Promise<LspDiagnostic[]> {
    return new Promise((resolve) => {
      let settled = false
      const settle = (diagnostics: LspDiagnostic[]): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(diagnostics)
      }
      const timer = setTimeout(() => {
        const waiters = (this.waiters.get(uri) ?? []).filter((entry) => entry !== settle)
        if (waiters.length > 0) this.waiters.set(uri, waiters)
        else this.waiters.delete(uri)
        settle([])
      }, this.diagnosticsTimeoutMs)
      const list = this.waiters.get(uri) ?? []
      list.push(settle)
      this.waiters.set(uri, list)
    })
  }

  private handleData(chunk: Buffer): void {
    const decoded = decodeLspMessages(Buffer.concat([this.buffer, chunk]))
    this.buffer = decoded.rest.length > MAX_LSP_BUFFER_BYTES ? Buffer.alloc(0) : decoded.rest
    for (const message of decoded.messages as LspMessage[]) {
      if (message.method === 'textDocument/publishDiagnostics') {
        this.handlePublishedDiagnostics(message.params)
        continue
      }
      if (typeof message.id === 'number' && message.method === undefined) {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) {
          pending.reject(new Error(message.error.message ?? 'LSP request failed'))
        } else {
          pending.resolve(message.result)
        }
        continue
      }
      if (typeof message.id === 'number' && message.method !== undefined) {
        this.write({ jsonrpc: '2.0', id: message.id, result: null })
      }
    }
  }

  private handlePublishedDiagnostics(params: Record<string, unknown> | undefined): void {
    const uri = String(params?.uri ?? '')
    const raw = Array.isArray(params?.diagnostics) ? params.diagnostics : []
    const diagnostics = raw.map(toDiagnostic)
    const waiters = this.waiters.get(uri)
    if (!waiters) return
    this.waiters.delete(uri)
    for (const waiter of waiters) waiter(diagnostics)
  }

  private handleExit(): void {
    this.exited = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('LSP server exited'))
    }
    this.pending.clear()
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) waiter([])
    }
    this.waiters.clear()
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      if (this.exited) {
        reject(new Error('LSP server is not running'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`LSP request timed out: ${method}`))
      }, this.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private notify(method: string, params: unknown): void {
    if (this.exited) return
    this.write({ jsonrpc: '2.0', method, params })
  }

  private write(message: unknown): void {
    if (!this.child?.stdin) throw new Error('LSP server is not running')
    this.child.stdin.write(encodeLspMessage(message))
  }
}

interface LspManagerOptions {
  workspace: string
  spawn?: LspSpawn
  env?: NodeJS.ProcessEnv
  resolveExecutable?: (bin: string) => Promise<string | null>
  requestTimeoutMs?: number
  diagnosticsTimeoutMs?: number
  servers?: readonly LspServerDefinition[]
}

export class LspManager {
  private clients = new Map<string, { client: LspClient; ready: Promise<void> }>()
  private failed = new Set<string>()
  private executables = new Map<string, Promise<string | null>>()
  private disposed = false

  constructor(private readonly options: LspManagerOptions) {}

  async diagnostics(files: string[]): Promise<Map<string, LspDiagnostic[]>> {
    const results = new Map<string, LspDiagnostic[]>()
    for (const file of new Set(files)) {
      const server = lspServerForFile(file, this.options.servers)
      if (!server) continue
      const client = await this.clientFor(server)
      if (!client) continue
      const text = await readTextFile(file)
      if (text === null) continue
      results.set(file, await client.diagnostics(file, text).catch(() => []))
    }
    return results
  }

  async hover(file: string, line: number, character: number): Promise<string> {
    const server = lspServerForFile(file, this.options.servers)
    if (!server) return ''
    try {
      const client = await this.clientFor(server)
      if (!client) return ''
      const text = await readTextFile(file)
      if (text === null) return ''
      const result = await client.hover(file, text, line, character)
      return formatHoverResult(result, file, line, character, this.options.workspace)
    } catch {
      return ''
    }
  }

  async definition(file: string, line: number, character: number): Promise<string> {
    const server = lspServerForFile(file, this.options.servers)
    if (!server) return ''
    try {
      const client = await this.clientFor(server)
      if (!client) return ''
      const text = await readTextFile(file)
      if (text === null) return ''
      const result = await client.definition(file, text, line, character)
      return formatDefinitionResult(result, this.options.workspace)
    } catch {
      return ''
    }
  }

  async availableServers(): Promise<string[]> {
    const available: string[] = []
    for (const server of this.options.servers ?? LSP_SERVERS) {
      if (await this.executableFor(server)) available.push(server.id)
    }
    return available
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.all([...this.clients.values()].map((entry) => entry.client.dispose()))
    this.clients.clear()
  }

  private executableFor(server: LspServerDefinition): Promise<string | null> {
    let resolution = this.executables.get(server.id)
    if (!resolution) {
      const resolve =
        this.options.resolveExecutable ??
        ((bin: string) => resolveExecutable(bin, this.options.workspace, this.options.env))
      resolution = resolve(server.command[0]).catch(() => null)
      this.executables.set(server.id, resolution)
    }
    return resolution
  }

  private async clientFor(server: LspServerDefinition): Promise<LspClient | null> {
    if (this.disposed || this.failed.has(server.id)) return null
    const existing = this.clients.get(server.id)
    if (existing) {
      try {
        await existing.ready
      } catch {
        return null
      }
      return existing.client
    }

    const executable = await this.executableFor(server)
    if (!executable || this.disposed) return null
    const envOverrides = { ...(this.options.env ?? {}), ...(server.env ?? {}) }
    const client = new LspClient({
      workspace: this.options.workspace,
      server,
      command: executable,
      spawn: this.options.spawn,
      env: Object.keys(envOverrides).length > 0 ? { ...process.env, ...envOverrides } : undefined,
      requestTimeoutMs: this.options.requestTimeoutMs,
      diagnosticsTimeoutMs: this.options.diagnosticsTimeoutMs
    })
    const ready = client.start()
    this.clients.set(server.id, { client, ready })
    try {
      await ready
    } catch {
      this.failed.add(server.id)
      this.clients.delete(server.id)
      await client.dispose()
      return null
    }
    if (this.disposed) {
      this.clients.delete(server.id)
      await client.dispose()
      return null
    }
    return client
  }
}

async function readTextFile(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file)
    if (stat.size > MAX_DIAGNOSTIC_FILESIZE) return null
    const text = await fs.readFile(file, 'utf8')
    if (text.includes('\u0000')) return null
    return text
  } catch {
    return null
  }
}

function severityLabel(severity: number): string {
  if (severity === 1) return 'error'
  if (severity === 2) return 'warning'
  if (severity === 3) return 'info'
  return 'hint'
}

function hoverText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(hoverText).filter(Boolean).join('\n\n')
  if (value && typeof value === 'object') {
    const text = (value as { value?: unknown }).value
    if (typeof text === 'string') return text
  }
  return ''
}

export function formatHoverResult(
  result: unknown,
  file: string,
  line: number,
  character: number,
  workspace: string
): string {
  const contents = (result as { contents?: unknown } | null)?.contents
  const text = hoverText(contents).trim()
  if (!text) return ''
  const relative = path.relative(workspace, file).split(path.sep).join('/')
  return `Hover at ${relative}:${line}:${character}:\n${text.slice(0, 4_000)}`
}

export function formatDefinitionResult(result: unknown, workspace: string): string {
  const entries = Array.isArray(result) ? result : result ? [result] : []
  const locations: string[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const location = entry as {
      uri?: unknown
      targetUri?: unknown
      range?: { start?: { line?: unknown; character?: unknown } }
      targetSelectionRange?: { start?: { line?: unknown; character?: unknown } }
      targetRange?: { start?: { line?: unknown; character?: unknown } }
    }
    const uri =
      typeof location.uri === 'string'
        ? location.uri
        : typeof location.targetUri === 'string'
          ? location.targetUri
          : null
    if (!uri) continue
    let file: string
    try {
      file = fileURLToPath(uri)
    } catch {
      continue
    }
    const range = location.range ?? location.targetSelectionRange ?? location.targetRange
    const line = typeof range?.start?.line === 'number' ? range.start.line + 1 : 1
    const character = typeof range?.start?.character === 'number' ? range.start.character + 1 : 1
    locations.push(
      `${path.relative(workspace, file).split(path.sep).join('/')}:${line}:${character}`
    )
  }
  if (locations.length === 0) return ''
  return `Definition:\n${[...new Set(locations)].map((entry) => `- ${entry}`).join('\n')}`
}

export function formatDiagnosticReport(
  results: Map<string, LspDiagnostic[]>,
  workspace: string,
  limit = MAX_REPORTED_DIAGNOSTICS
): string {
  const lines: string[] = []
  let total = 0
  for (const [file, diagnostics] of results) {
    const relative = path.relative(workspace, file).split(path.sep).join('/')
    for (const diagnostic of diagnostics) {
      total += 1
      if (lines.length >= limit) continue
      const code = diagnostic.code !== undefined ? `(${diagnostic.code})` : ''
      const source = diagnostic.source ? ` ${diagnostic.source}` : ''
      lines.push(
        `${relative}:${diagnostic.line}:${diagnostic.character} ${severityLabel(diagnostic.severity)}${source}${code}: ${diagnostic.message}`
      )
    }
  }
  if (lines.length === 0) return ''
  const extra = total > lines.length ? `\n[+${total - lines.length} more diagnostics]` : ''
  return `LSP diagnostics:\n${lines.join('\n')}${extra}`
}

export async function availableLspServers(workspace: string): Promise<string[]> {
  const manager = new LspManager({ workspace })
  try {
    return await manager.availableServers()
  } finally {
    await manager.dispose()
  }
}
