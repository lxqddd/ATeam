import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AgentConfig } from '@ateam/shared'
import { resolveExecutable } from './executables'

const MAX_DIAGNOSTIC_FILESIZE = 1_000_000
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 5_000
const DEFAULT_INSTALL_TIMEOUT_MS = 120_000
const MAX_REPORTED_DIAGNOSTICS = 20
const MAX_LOCATION_RESULTS = 100
const MAX_SYMBOL_RESULTS = 100
const MAX_CALL_RESULTS = 50
const MAX_CALL_HIERARCHY_ITEMS = 20

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
  /** Names of files or directories that mark the project root for this server. */
  rootMarkers?: readonly string[]
  /** npm packages installed on demand when the executable is missing. */
  npmPackages?: readonly string[]
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
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.htm': 'html',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
  '.php': 'php',
  '.prisma': 'prisma',
  '.toml': 'toml',
  '.lua': 'lua',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.rb': 'ruby',
  '.dart': 'dart',
  '.swift': 'swift',
  '.zig': 'zig',
  '.graphql': 'graphql',
  '.gql': 'graphql'
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
    const rootMarkers = input.rootMarkers ?? existing?.rootMarkers
    const npmPackages = input.npmPackages ?? existing?.npmPackages
    servers.set(id, {
      id,
      command,
      extensions: input.extensions ?? existing?.extensions ?? [],
      ...(rootMarkers && rootMarkers.length > 0 ? { rootMarkers } : {}),
      ...(npmPackages && npmPackages.length > 0 ? { npmPackages } : {}),
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
    command: ['typescript-language-server', '--stdio'],
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    npmPackages: ['typescript-language-server', 'typescript']
  },
  {
    id: 'gopls',
    extensions: ['.go'],
    command: ['gopls'],
    rootMarkers: ['go.work', 'go.mod']
  },
  {
    id: 'pyright',
    extensions: ['.py', '.pyi'],
    command: ['pyright-langserver', '--stdio'],
    rootMarkers: [
      'pyrightconfig.json',
      'pyproject.toml',
      'setup.py',
      'setup.cfg',
      'requirements.txt',
      'Pipfile'
    ],
    npmPackages: ['pyright']
  },
  {
    id: 'rust-analyzer',
    extensions: ['.rs'],
    command: ['rust-analyzer'],
    rootMarkers: ['Cargo.toml', 'rust-toolchain.toml']
  },
  {
    id: 'clangd',
    extensions: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'],
    command: ['clangd'],
    rootMarkers: ['compile_commands.json', 'compile_flags.txt', '.clangd', 'CMakeLists.txt']
  },
  {
    id: 'yaml',
    extensions: ['.yaml', '.yml'],
    command: ['yaml-language-server', '--stdio'],
    npmPackages: ['yaml-language-server']
  },
  {
    id: 'bash',
    extensions: ['.sh', '.bash', '.zsh'],
    command: ['bash-language-server', 'start'],
    npmPackages: ['bash-language-server']
  },
  {
    id: 'json',
    extensions: ['.json', '.jsonc'],
    command: ['vscode-json-language-server', '--stdio'],
    npmPackages: ['vscode-langservers-extracted']
  },
  {
    id: 'css',
    extensions: ['.css', '.scss', '.less'],
    command: ['vscode-css-language-server', '--stdio'],
    npmPackages: ['vscode-langservers-extracted']
  },
  {
    id: 'html',
    extensions: ['.html', '.htm'],
    command: ['vscode-html-language-server', '--stdio'],
    npmPackages: ['vscode-langservers-extracted']
  },
  {
    id: 'vue',
    extensions: ['.vue'],
    command: ['vue-language-server', '--stdio'],
    rootMarkers: ['package.json'],
    npmPackages: ['@vue/language-server']
  },
  {
    id: 'svelte',
    extensions: ['.svelte'],
    command: ['svelteserver', '--stdio'],
    rootMarkers: ['package.json'],
    npmPackages: ['svelte-language-server']
  },
  {
    id: 'astro',
    extensions: ['.astro'],
    command: ['astro-ls', '--stdio'],
    rootMarkers: ['package.json'],
    npmPackages: ['@astrojs/language-server']
  },
  {
    id: 'php',
    extensions: ['.php'],
    command: ['intelephense', '--stdio'],
    rootMarkers: ['composer.json'],
    npmPackages: ['intelephense']
  },
  {
    id: 'prisma',
    extensions: ['.prisma'],
    command: ['prisma-language-server', '--stdio'],
    rootMarkers: ['package.json', 'schema.prisma'],
    npmPackages: ['@prisma/language-server']
  },
  {
    id: 'toml',
    extensions: ['.toml'],
    command: ['taplo', 'lsp', 'stdio'],
    npmPackages: ['@taplo/cli']
  },
  {
    id: 'lua',
    extensions: ['.lua'],
    command: ['lua-language-server']
  },
  {
    id: 'kotlin',
    extensions: ['.kt', '.kts'],
    command: ['kotlin-language-server'],
    rootMarkers: ['settings.gradle.kts', 'settings.gradle', 'build.gradle.kts', 'build.gradle']
  },
  {
    id: 'ruby',
    extensions: ['.rb'],
    command: ['ruby-lsp'],
    rootMarkers: ['Gemfile']
  },
  {
    id: 'dart',
    extensions: ['.dart'],
    command: ['dart', 'language-server'],
    rootMarkers: ['pubspec.yaml']
  },
  {
    id: 'swift',
    extensions: ['.swift'],
    command: ['sourcekit-lsp'],
    rootMarkers: ['Package.swift']
  },
  {
    id: 'zig',
    extensions: ['.zig'],
    command: ['zls'],
    rootMarkers: ['build.zig']
  },
  {
    id: 'graphql',
    extensions: ['.graphql', '.gql'],
    command: ['graphql-lsp', 'server', '--method', 'stream'],
    npmPackages: ['graphql-language-service-cli']
  }
]

export function lspServerForFile(
  filePath: string,
  servers: readonly LspServerDefinition[] = LSP_SERVERS
): LspServerDefinition | null {
  const extension = path.extname(filePath).toLowerCase()
  return servers.find((server) => server.extensions.includes(extension)) ?? null
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Finds the nearest directory at or above the file that carries one of the
 * server's root markers, bounded by the workspace. Files outside the workspace
 * and servers without markers fall back to the workspace root.
 */
export function resolveLspRoot(
  file: string,
  server: LspServerDefinition,
  workspace: string
): string {
  const root = path.resolve(workspace)
  const markers = server.rootMarkers ?? []
  if (markers.length === 0) return root
  let directory = path.dirname(path.resolve(file))
  if (!isInside(root, directory)) return root
  for (;;) {
    if (markers.some((marker) => existsSync(path.join(directory, marker)))) return directory
    if (directory === root) return root
    directory = path.dirname(directory)
  }
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
      /** Project root reported to the server; defaults to the workspace. */
      root?: string
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
    const root = this.options.root ?? this.options.workspace
    const [, ...args] = this.options.server.command
    const child = spawn(this.options.command, args, {
      cwd: root,
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
      rootUri: fileUri(root),
      workspaceFolders: [{ uri: fileUri(root), name: path.basename(root) }],
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

  async references(
    filePath: string,
    text: string,
    line: number,
    character: number
  ): Promise<unknown> {
    return this.positionQuery('textDocument/references', filePath, text, line, character, {
      context: { includeDeclaration: true }
    })
  }

  async implementation(
    filePath: string,
    text: string,
    line: number,
    character: number
  ): Promise<unknown> {
    return this.positionQuery('textDocument/implementation', filePath, text, line, character)
  }

  async prepareCallHierarchy(
    filePath: string,
    text: string,
    line: number,
    character: number
  ): Promise<unknown> {
    return this.positionQuery('textDocument/prepareCallHierarchy', filePath, text, line, character)
  }

  async documentSymbols(filePath: string, text: string): Promise<unknown> {
    return this.documentQuery('textDocument/documentSymbol', filePath, text)
  }

  async workspaceSymbols(query: string): Promise<unknown> {
    if (this.exited) return null
    await this.start()
    if (this.exited) return null
    return this.request('workspace/symbol', { query })
  }

  async incomingCalls(item: unknown): Promise<unknown> {
    if (this.exited) return null
    await this.start()
    if (this.exited) return null
    return this.request('callHierarchy/incomingCalls', { item })
  }

  async outgoingCalls(item: unknown): Promise<unknown> {
    if (this.exited) return null
    await this.start()
    if (this.exited) return null
    return this.request('callHierarchy/outgoingCalls', { item })
  }

  private async positionQuery(
    method: string,
    filePath: string,
    text: string,
    line: number,
    character: number,
    extra?: Record<string, unknown>
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
      position: { line: Math.max(0, line - 1), character: Math.max(0, character - 1) },
      ...(extra ?? {})
    })
  }

  private async documentQuery(method: string, filePath: string, text: string): Promise<unknown> {
    if (this.exited) return null
    await this.start()
    if (this.exited) return null
    let uri: string
    try {
      uri = this.syncDocument(filePath, text)
    } catch {
      return null
    }
    return this.request(method, { textDocument: { uri } })
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

export type LspCallDirection = 'incoming' | 'outgoing' | 'both'

interface LspManagerOptions {
  workspace: string
  spawn?: LspSpawn
  env?: NodeJS.ProcessEnv
  resolveExecutable?: (bin: string, cwd?: string) => Promise<string | null>
  requestTimeoutMs?: number
  diagnosticsTimeoutMs?: number
  servers?: readonly LspServerDefinition[]
  /** Directory that receives npm installations of missing servers. */
  installDirectory?: string
  /** Install missing npm language servers on first use; off by default. */
  autoInstall?: boolean
  /** Replaces the npm installer, mainly for tests. */
  install?: (server: LspServerDefinition) => Promise<string | null>
}

interface ResolvedServer {
  server: LspServerDefinition
  root: string
}

function clientKey(server: LspServerDefinition, root: string): string {
  return `${server.id}\u0000${root}`
}

export class LspManager {
  private clients = new Map<string, { client: LspClient; ready: Promise<void> }>()
  private failed = new Set<string>()
  private executables = new Map<string, Promise<string | null>>()
  private installs = new Map<string, Promise<string | null>>()
  private disposed = false

  constructor(private readonly options: LspManagerOptions) {}

  async diagnostics(files: string[]): Promise<Map<string, LspDiagnostic[]>> {
    const results = new Map<string, LspDiagnostic[]>()
    for (const file of new Set(files)) {
      const resolved = this.serverFor(file)
      if (!resolved) continue
      const client = await this.clientFor(resolved)
      if (!client) continue
      const text = await readTextFile(file)
      if (text === null) continue
      results.set(file, await client.diagnostics(file, text).catch(() => []))
    }
    return results
  }

  async hover(file: string, line: number, character: number): Promise<string> {
    const result = await this.positionResult(file, (client, text) =>
      client.hover(file, text, line, character)
    )
    return formatHoverResult(result, file, line, character, this.options.workspace)
  }

  async definition(file: string, line: number, character: number): Promise<string> {
    const result = await this.positionResult(file, (client, text) =>
      client.definition(file, text, line, character)
    )
    return formatDefinitionResult(result, this.options.workspace)
  }

  async references(file: string, line: number, character: number): Promise<string> {
    const result = await this.positionResult(file, (client, text) =>
      client.references(file, text, line, character)
    )
    return formatLocationList('References', result, this.options.workspace)
  }

  async implementation(file: string, line: number, character: number): Promise<string> {
    const result = await this.positionResult(file, (client, text) =>
      client.implementation(file, text, line, character)
    )
    return formatLocationList('Implementations', result, this.options.workspace)
  }

  async documentSymbols(file: string): Promise<string> {
    const resolved = this.serverFor(file)
    if (!resolved) return ''
    try {
      const client = await this.clientFor(resolved)
      if (!client) return ''
      const text = await readTextFile(file)
      if (text === null) return ''
      const result = await client.documentSymbols(file, text)
      return formatDocumentSymbols(result, file, this.options.workspace)
    } catch {
      return ''
    }
  }

  async workspaceSymbols(query: string, file: string): Promise<string> {
    const resolved = this.serverFor(file)
    if (!resolved) return ''
    try {
      const client = await this.clientFor(resolved)
      if (!client) return ''
      const result = await client.workspaceSymbols(query)
      return formatWorkspaceSymbols(result, query, this.options.workspace)
    } catch {
      return ''
    }
  }

  async callHierarchy(
    file: string,
    line: number,
    character: number,
    direction: LspCallDirection = 'both'
  ): Promise<string> {
    const resolved = this.serverFor(file)
    if (!resolved) return ''
    try {
      const client = await this.clientFor(resolved)
      if (!client) return ''
      const text = await readTextFile(file)
      if (text === null) return ''
      const prepared = await client.prepareCallHierarchy(file, text, line, character)
      const items = Array.isArray(prepared) ? prepared : prepared ? [prepared] : []
      if (items.length === 0) return ''
      const incoming: unknown[] = []
      const outgoing: unknown[] = []
      for (const item of items.slice(0, MAX_CALL_HIERARCHY_ITEMS)) {
        if (direction !== 'outgoing') {
          const result = await client.incomingCalls(item)
          if (Array.isArray(result)) incoming.push(...result)
        }
        if (direction !== 'incoming') {
          const result = await client.outgoingCalls(item)
          if (Array.isArray(result)) outgoing.push(...result)
        }
      }
      const sections: Array<{ label: 'Incoming' | 'Outgoing'; items: unknown[] }> = []
      if (direction !== 'outgoing') sections.push({ label: 'Incoming', items: incoming })
      if (direction !== 'incoming') sections.push({ label: 'Outgoing', items: outgoing })
      const relative = path.relative(this.options.workspace, file).split(path.sep).join('/')
      return formatCallHierarchyResult(
        `Call hierarchy at ${relative}:${line}:${character}:`,
        sections,
        this.options.workspace
      )
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

  private serverFor(file: string): ResolvedServer | null {
    const server = lspServerForFile(file, this.options.servers)
    if (!server) return null
    return { server, root: resolveLspRoot(file, server, this.options.workspace) }
  }

  private async positionResult(
    file: string,
    run: (client: LspClient, text: string) => Promise<unknown>
  ): Promise<unknown> {
    const resolved = this.serverFor(file)
    if (!resolved) return null
    try {
      const client = await this.clientFor(resolved)
      if (!client) return null
      const text = await readTextFile(file)
      if (text === null) return null
      return await run(client, text)
    } catch {
      return null
    }
  }

  private resolver(): (bin: string, cwd?: string) => Promise<string | null> {
    return (
      this.options.resolveExecutable ??
      ((bin, cwd) => resolveExecutable(bin, cwd ?? this.options.workspace, this.options.env))
    )
  }

  private executableFor(server: LspServerDefinition): Promise<string | null> {
    let resolution = this.executables.get(server.id)
    if (!resolution) {
      resolution = this.resolver()(server.command[0], this.options.workspace).catch(() => null)
      this.executables.set(server.id, resolution)
    }
    return resolution
  }

  private executableForClient(server: LspServerDefinition): Promise<string | null> {
    return this.executableFor(server).then((direct) => direct ?? this.installFor(server))
  }

  private installFor(server: LspServerDefinition): Promise<string | null> {
    if (!this.options.autoInstall || this.disposed) return Promise.resolve(null)
    let installation = this.installs.get(server.id)
    if (!installation) {
      installation = (
        this.options.install ? this.options.install(server) : this.installFromNpm(server)
      ).catch(() => null)
      this.installs.set(server.id, installation)
    }
    return installation
  }

  private async installFromNpm(server: LspServerDefinition): Promise<string | null> {
    const directory = this.options.installDirectory
    const packages = server.npmPackages ?? []
    if (!directory || packages.length === 0) return null
    return installNpmServer(server, directory, this.resolver())
  }

  private async clientFor(resolved: ResolvedServer): Promise<LspClient | null> {
    const { server, root } = resolved
    const key = clientKey(server, root)
    if (this.disposed || this.failed.has(key)) return null
    const existing = this.clients.get(key)
    if (existing) {
      try {
        await existing.ready
      } catch {
        return null
      }
      return existing.client
    }

    const executable = await this.executableForClient(server)
    if (!executable || this.disposed) return null
    const envOverrides = { ...(this.options.env ?? {}), ...(server.env ?? {}) }
    const client = new LspClient({
      workspace: this.options.workspace,
      root,
      server,
      command: executable,
      spawn: this.options.spawn,
      env: Object.keys(envOverrides).length > 0 ? { ...process.env, ...envOverrides } : undefined,
      requestTimeoutMs: this.options.requestTimeoutMs,
      diagnosticsTimeoutMs: this.options.diagnosticsTimeoutMs
    })
    const ready = client.start()
    this.clients.set(key, { client, ready })
    try {
      await ready
    } catch {
      this.failed.add(key)
      this.clients.delete(key)
      await client.dispose()
      return null
    }
    if (this.disposed) {
      this.clients.delete(key)
      await client.dispose()
      return null
    }
    return client
  }
}

async function installNpmServer(
  server: LspServerDefinition,
  directory: string,
  resolve: (bin: string, cwd?: string) => Promise<string | null>
): Promise<string | null> {
  const packages = server.npmPackages ?? []
  if (packages.length === 0) return null
  const target = path.join(directory, server.id)
  try {
    await fs.mkdir(target, { recursive: true })
  } catch {
    return null
  }
  const npm = await resolve('npm', target).catch(() => null)
  if (!npm) return null
  if (!(await runNpmInstall(npm, target, packages))) return null
  return resolve(server.command[0], target).catch(() => null)
}

function runNpmInstall(npm: string, cwd: string, packages: readonly string[]): Promise<boolean> {
  return new Promise((done) => {
    let child: LspChildProcess
    try {
      child = nodeSpawn(
        npm,
        ['install', '--prefix', cwd, '--no-fund', '--no-audit', '--loglevel=error', ...packages],
        { cwd, env: process.env, stdio: 'ignore' }
      ) as unknown as LspChildProcess
    } catch {
      done(false)
      return
    }
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      done(ok)
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* the process may already be gone */
      }
      finish(false)
    }, DEFAULT_INSTALL_TIMEOUT_MS)
    child.on('exit', (code) => finish(code === 0))
    child.on('error', () => finish(false))
  })
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

interface LspLocationPoint {
  file: string
  line: number
  character: number
}

function relativePath(workspace: string, file: string): string {
  return path.relative(workspace, file).split(path.sep).join('/')
}

function toLocationPoint(value: unknown): LspLocationPoint | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as {
    uri?: unknown
    targetUri?: unknown
    range?: { start?: { line?: unknown; character?: unknown } }
    targetSelectionRange?: { start?: { line?: unknown; character?: unknown } }
    targetRange?: { start?: { line?: unknown; character?: unknown } }
  }
  const uri =
    typeof entry.uri === 'string'
      ? entry.uri
      : typeof entry.targetUri === 'string'
        ? entry.targetUri
        : null
  if (!uri) return null
  let file: string
  try {
    file = fileURLToPath(uri)
  } catch {
    return null
  }
  const range = entry.range ?? entry.targetSelectionRange ?? entry.targetRange
  const line = typeof range?.start?.line === 'number' ? range.start.line + 1 : 1
  const character = typeof range?.start?.character === 'number' ? range.start.character + 1 : 1
  return { file, line, character }
}

export function formatLocationList(label: string, result: unknown, workspace: string): string {
  const entries = Array.isArray(result) ? result : result ? [result] : []
  const locations: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const point = toLocationPoint(entry)
    if (!point) continue
    const formatted = `${relativePath(workspace, point.file)}:${point.line}:${point.character}`
    if (seen.has(formatted)) continue
    seen.add(formatted)
    locations.push(formatted)
  }
  if (locations.length === 0) return ''
  const shown = locations.slice(0, MAX_LOCATION_RESULTS)
  const extra =
    locations.length > shown.length ? `\n[+${locations.length - shown.length} more locations]` : ''
  return `${label}:\n${shown.map((entry) => `- ${entry}`).join('\n')}${extra}`
}

export function formatDefinitionResult(result: unknown, workspace: string): string {
  return formatLocationList('Definition', result, workspace)
}

export function symbolKindLabel(kind: unknown): string {
  const labels: Record<number, string> = {
    1: 'file',
    2: 'module',
    3: 'namespace',
    4: 'package',
    5: 'class',
    6: 'method',
    7: 'property',
    8: 'field',
    9: 'constructor',
    10: 'enum',
    11: 'interface',
    12: 'function',
    13: 'variable',
    14: 'constant',
    15: 'string',
    16: 'number',
    17: 'boolean',
    18: 'array',
    19: 'object',
    20: 'key',
    21: 'null',
    22: 'enum member',
    23: 'struct',
    24: 'event',
    25: 'operator',
    26: 'type parameter'
  }
  return typeof kind === 'number' ? (labels[kind] ?? 'symbol') : 'symbol'
}

interface SymbolLike {
  name?: unknown
  kind?: unknown
  range?: { start?: { line?: unknown; character?: unknown } }
  selectionRange?: { start?: { line?: unknown; character?: unknown } }
  location?: unknown
  children?: unknown
  containerName?: unknown
}

function symbolPosition(symbol: SymbolLike, file: string): LspLocationPoint | null {
  if (symbol.location) return toLocationPoint(symbol.location)
  const range = symbol.selectionRange ?? symbol.range
  if (!range) return null
  const line = typeof range.start?.line === 'number' ? range.start.line + 1 : 1
  const character = typeof range.start?.character === 'number' ? range.start.character + 1 : 1
  return { file, line, character }
}

export function formatDocumentSymbols(result: unknown, file: string, workspace: string): string {
  const symbols = Array.isArray(result) ? result : []
  if (symbols.length === 0) return ''
  const lines: string[] = []
  let total = 0
  const walk = (entries: unknown[], depth: number): void => {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const symbol = entry as SymbolLike
      total += 1
      if (lines.length < MAX_SYMBOL_RESULTS) {
        const name = typeof symbol.name === 'string' ? symbol.name : '<unnamed>'
        const point = symbolPosition(symbol, file)
        const suffix = point
          ? ` ${relativePath(workspace, point.file)}:${point.line}:${point.character}`
          : ''
        lines.push(`${'  '.repeat(depth)}- ${name} (${symbolKindLabel(symbol.kind)})${suffix}`)
      }
      if (depth < 8 && Array.isArray(symbol.children)) walk(symbol.children, depth + 1)
    }
  }
  walk(symbols, 0)
  if (lines.length === 0) return ''
  const extra = total > lines.length ? `\n[+${total - lines.length} more symbols]` : ''
  return `Symbols in ${relativePath(workspace, file)}:\n${lines.join('\n')}${extra}`
}

export function formatWorkspaceSymbols(result: unknown, query: string, workspace: string): string {
  const symbols = Array.isArray(result) ? result : []
  const lines: string[] = []
  let total = 0
  for (const entry of symbols) {
    if (!entry || typeof entry !== 'object') continue
    const symbol = entry as SymbolLike
    const point = symbolPosition(symbol, '')
    if (!point) continue
    total += 1
    if (lines.length >= MAX_SYMBOL_RESULTS) continue
    const name = typeof symbol.name === 'string' ? symbol.name : '<unnamed>'
    const container =
      typeof symbol.containerName === 'string' && symbol.containerName
        ? `${symbol.containerName}/`
        : ''
    lines.push(
      `- ${container}${name} (${symbolKindLabel(symbol.kind)}) ${relativePath(workspace, point.file)}:${point.line}:${point.character}`
    )
  }
  if (lines.length === 0) return ''
  const extra = total > lines.length ? `\n[+${total - lines.length} more symbols]` : ''
  return `Workspace symbols for "${query}":\n${lines.join('\n')}${extra}`
}

export function formatCallHierarchyResult(
  heading: string,
  sections: ReadonlyArray<{ label: 'Incoming' | 'Outgoing'; items: unknown[] }>,
  workspace: string
): string {
  const lines: string[] = []
  for (const section of sections) {
    const entries: string[] = []
    const seen = new Set<string>()
    for (const raw of section.items) {
      if (!raw || typeof raw !== 'object') continue
      const call = raw as { from?: unknown; to?: unknown }
      const item = (section.label === 'Incoming' ? call.from : call.to) as
        | {
            name?: unknown
            uri?: unknown
            range?: { start?: { line?: unknown; character?: unknown } }
          }
        | undefined
      if (!item || typeof item.uri !== 'string') continue
      let file: string
      try {
        file = fileURLToPath(item.uri)
      } catch {
        continue
      }
      const line = typeof item.range?.start?.line === 'number' ? item.range.start.line + 1 : 1
      const character =
        typeof item.range?.start?.character === 'number' ? item.range.start.character + 1 : 1
      const name = typeof item.name === 'string' ? item.name : '(anonymous)'
      const formatted = `${name} (${relativePath(workspace, file)}:${line}:${character})`
      if (seen.has(formatted)) continue
      seen.add(formatted)
      entries.push(formatted)
    }
    if (entries.length === 0) continue
    lines.push(`${section.label}:`)
    for (const entry of entries.slice(0, MAX_CALL_RESULTS)) lines.push(`- ${entry}`)
    if (entries.length > MAX_CALL_RESULTS) {
      lines.push(`[+${entries.length - MAX_CALL_RESULTS} more calls]`)
    }
  }
  if (lines.length === 0) return ''
  return `${heading}\n${lines.join('\n')}`
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
