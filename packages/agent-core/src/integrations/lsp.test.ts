import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConfig } from '@ateam/shared'
import {
  LspClient,
  LspManager,
  decodeLspMessages,
  encodeLspMessage,
  filePathFromUri,
  fileUri,
  formatCallHierarchyResult,
  formatDiagnosticReport,
  formatDocumentSymbols,
  formatLocationList,
  formatWorkspaceSymbols,
  languageIdForFile,
  lspServerForFile,
  resolveLspRoot,
  resolveLspServers,
  type LspChildProcess,
  type LspDiagnostic,
  type LspServerDefinition,
  type LspSpawn
} from './lsp'

interface LspMessage {
  jsonrpc?: string
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: unknown
}

type Handler = (server: FakeServer, message: LspMessage) => void

class FakeServer extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly requests: LspMessage[] = []
  killed = false
  private buffer: Buffer = Buffer.alloc(0)

  constructor(private readonly handler: Handler) {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      const decoded = decodeLspMessages(Buffer.concat([this.buffer, chunk]))
      this.buffer = decoded.rest
      for (const message of decoded.messages as LspMessage[]) {
        this.requests.push(message)
        this.handler(this, message)
      }
    })
  }

  respond(id: number | undefined, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result })
  }

  send(message: unknown): void {
    this.stdout.write(encodeLspMessage(message))
  }

  publish(uri: string, diagnostics: unknown[]): void {
    this.send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics }
    })
  }

  kill(): boolean {
    this.killed = true
    this.stdin.end()
    this.stdout.end()
    this.emit('exit', 0)
    return true
  }
}

const TYPESCRIPT: LspServerDefinition = {
  id: 'typescript',
  extensions: ['.ts', '.tsx'],
  command: ['typescript-language-server', '--stdio']
}

function createClient(
  handler: Handler,
  diagnosticsTimeoutMs = 100
): {
  client: LspClient
  servers: FakeServer[]
} {
  const servers: FakeServer[] = []
  const spawn: LspSpawn = () => {
    const server = new FakeServer(handler)
    servers.push(server)
    return server as unknown as LspChildProcess
  }
  const client = new LspClient({
    workspace: '/work/project',
    server: TYPESCRIPT,
    command: '/bin/typescript-language-server',
    spawn,
    diagnosticsTimeoutMs
  })
  return { client, servers }
}

function initializing(handler: Handler): Handler {
  return (server, message) => {
    if (message.method === 'initialize') {
      server.respond(message.id, { capabilities: {} })
      return
    }
    handler(server, message)
  }
}

describe('lsp framing and helpers', () => {
  it('decodes multiple messages and keeps the incomplete tail', () => {
    const first = encodeLspMessage({ a: 1 })
    const second = encodeLspMessage({ b: 2 })
    const partial = second.subarray(0, 7)

    const decoded = decodeLspMessages(Buffer.concat([first, partial]))
    expect(decoded.messages).toEqual([{ a: 1 }])

    const next = decodeLspMessages(Buffer.concat([decoded.rest, second.subarray(7)]))
    expect(next.messages).toEqual([{ b: 2 }])
    expect(next.rest.length).toBe(0)
  })

  it('round-trips file URIs with spaces and unicode', () => {
    const file = path.join(os.tmpdir(), 'a b', '目录', 'file name.ts')
    expect(filePathFromUri(fileUri(file))).toBe(path.resolve(file))
  })

  it('maps extensions to language servers and language ids', () => {
    expect(lspServerForFile('src/a.TS')?.id).toBe('typescript')
    expect(lspServerForFile('main.go')?.id).toBe('gopls')
    expect(lspServerForFile('script.py')?.id).toBe('pyright')
    expect(lspServerForFile('README.md')).toBeNull()
    expect(languageIdForFile('a.tsx')).toBe('typescriptreact')
    expect(languageIdForFile('a.js')).toBe('javascript')
    expect(languageIdForFile('a.go')).toBe('go')
  })

  it('covers the expanded language server matrix', () => {
    expect(lspServerForFile('a.yaml')?.id).toBe('yaml')
    expect(lspServerForFile('a.json')?.id).toBe('json')
    expect(lspServerForFile('a.css')?.id).toBe('css')
    expect(lspServerForFile('a.vue')?.id).toBe('vue')
    expect(lspServerForFile('a.svelte')?.id).toBe('svelte')
    expect(lspServerForFile('a.astro')?.id).toBe('astro')
    expect(lspServerForFile('a.php')?.id).toBe('php')
    expect(lspServerForFile('a.toml')?.id).toBe('toml')
    expect(lspServerForFile('a.kt')?.id).toBe('kotlin')
    expect(lspServerForFile('a.rb')?.id).toBe('ruby')
    expect(lspServerForFile('a.dart')?.id).toBe('dart')
    expect(lspServerForFile('a.swift')?.id).toBe('swift')
    expect(lspServerForFile('a.zig')?.id).toBe('zig')
    expect(languageIdForFile('a.yml')).toBe('yaml')
    expect(languageIdForFile('a.sh')).toBe('shellscript')
    expect(languageIdForFile('a.jsonc')).toBe('jsonc')
  })

  it('reports every built-in server once and keeps root markers', () => {
    const servers = resolveLspServers()
    const ids = servers.map((server) => server.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(servers.find((server) => server.id === 'typescript')?.rootMarkers).toContain(
      'tsconfig.json'
    )
    expect(servers.find((server) => server.id === 'pyright')?.npmPackages).toContain('pyright')
  })
})

describe('resolveLspRoot', () => {
  let workspace: string
  const rooted: LspServerDefinition = {
    ...TYPESCRIPT,
    rootMarkers: ['tsconfig.json', 'package.json']
  }

  beforeEach(async () => {
    workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-lsp-root-')))
  })

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('uses the nearest root marker at or above the file', async () => {
    const project = path.join(workspace, 'packages', 'app')
    await fs.mkdir(path.join(project, 'src'), { recursive: true })
    await fs.writeFile(path.join(project, 'tsconfig.json'), '{}')

    expect(resolveLspRoot(path.join(project, 'src', 'a.ts'), rooted, workspace)).toBe(project)
  })

  it('falls back to the workspace without markers', async () => {
    const src = path.join(workspace, 'src')
    await fs.mkdir(src, { recursive: true })

    expect(resolveLspRoot(path.join(src, 'a.ts'), rooted, workspace)).toBe(workspace)
    expect(resolveLspRoot(path.join(src, 'a.ts'), TYPESCRIPT, workspace)).toBe(workspace)
  })

  it('honours custom markers and never escapes the workspace', async () => {
    const project = path.join(workspace, 'modules', 'core')
    await fs.mkdir(project, { recursive: true })
    await fs.writeFile(path.join(project, '.custom-root'), '')
    const custom: LspServerDefinition = { ...TYPESCRIPT, rootMarkers: ['.custom-root'] }

    expect(resolveLspRoot(path.join(project, 'a.ts'), custom, workspace)).toBe(project)
    expect(resolveLspRoot('/elsewhere/project/a.ts', rooted, workspace)).toBe(workspace)
  })
})

describe('LspClient', () => {
  it('initializes the server with the workspace root', async () => {
    const { client, servers } = createClient(initializing(() => undefined))

    await client.start()

    expect(servers).toHaveLength(1)
    const initialize = servers[0].requests.find((entry) => entry.method === 'initialize')
    expect(initialize?.params).toMatchObject({
      rootUri: fileUri('/work/project'),
      processId: expect.any(Number)
    })
    expect(servers[0].requests.some((entry) => entry.method === 'initialized')).toBe(true)
    await client.dispose()
  })

  it('requests hover and definition at zero-based positions', async () => {
    const hoverResult = { contents: { kind: 'markdown', value: '**Docs**' } }
    const definitionResult = {
      uri: 'file:///work/project/b.ts',
      range: { start: { line: 2, character: 3 }, end: { line: 2, character: 4 } }
    }
    const { client, servers } = createClient(
      initializing((server, message) => {
        if (message.method === 'textDocument/hover') server.respond(message.id, hoverResult)
        if (message.method === 'textDocument/definition') {
          server.respond(message.id, definitionResult)
        }
      })
    )

    await expect(client.hover('/work/project/a.ts', 'const x = 1', 3, 5)).resolves.toEqual(
      hoverResult
    )
    await expect(client.definition('/work/project/a.ts', 'const x = 1', 3, 5)).resolves.toEqual(
      definitionResult
    )

    const hover = servers[0].requests.find((entry) => entry.method === 'textDocument/hover')
    expect(hover?.params).toMatchObject({
      textDocument: { uri: fileUri('/work/project/a.ts') },
      position: { line: 2, character: 4 }
    })
    await client.dispose()
  })

  it('opens a document and returns published diagnostics', async () => {
    const { client } = createClient(
      initializing((server, message) => {
        if (message.method !== 'textDocument/didOpen') return
        const document = message.params?.textDocument as { uri: string }
        server.publish(document.uri, [
          {
            range: { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } },
            severity: 1,
            message: 'Type error',
            source: 'ts',
            code: 2322
          }
        ])
      })
    )

    const diagnostics = await client.diagnostics('/work/project/src/a.ts', 'const x: number = "s"')

    expect(diagnostics).toEqual<LspDiagnostic[]>([
      { line: 3, character: 5, severity: 1, message: 'Type error', source: 'ts', code: 2322 }
    ])
    await client.dispose()
  })

  it('sends didChange with an incremented version on repeat calls', async () => {
    const { client, servers } = createClient(
      initializing((server, message) => {
        if (message.method === 'initialize') return
        const document = message.params?.textDocument as { uri: string }
        if (message.method === 'textDocument/didOpen') server.publish(document.uri, [])
        if (message.method === 'textDocument/didChange') {
          const change = message.params?.contentChanges as Array<{ text: string }>
          server.publish(
            document.uri,
            change[0].text.includes('error')
              ? [{ message: 'broken', range: { start: { line: 0, character: 0 } } }]
              : []
          )
        }
      })
    )

    await client.diagnostics('/work/project/src/a.ts', 'one')
    const diagnostics = await client.diagnostics('/work/project/src/a.ts', 'error')

    const changes = servers[0].requests.filter((entry) => entry.method === 'textDocument/didChange')
    expect(changes).toHaveLength(1)
    expect(changes[0].params).toMatchObject({
      textDocument: { uri: fileUri('/work/project/src/a.ts'), version: 2 },
      contentChanges: [{ text: 'error' }]
    })
    expect(diagnostics[0]?.message).toBe('broken')
    await client.dispose()
  })

  it('returns no diagnostics when the server stays silent', async () => {
    const { client } = createClient(
      initializing(() => undefined),
      30
    )

    await expect(client.diagnostics('/work/project/src/a.ts', 'x')).resolves.toEqual([])
    await client.dispose()
  })

  it('returns no diagnostics after the server exits', async () => {
    const { client, servers } = createClient(initializing(() => undefined))
    await client.start()

    servers[0].kill()

    await expect(client.diagnostics('/work/project/src/a.ts', 'x')).resolves.toEqual([])
    await client.dispose()
  })

  it('answers server requests so the language server is not blocked', async () => {
    let sent = false
    const { client, servers } = createClient(
      initializing((server, message) => {
        if (message.method !== 'initialized' || sent) return
        sent = true
        server.send({
          jsonrpc: '2.0',
          id: 99,
          method: 'client/registerCapability',
          params: { registrations: [] }
        })
      })
    )

    await client.start()

    await vi.waitFor(() => {
      const response = servers[0].requests.find((entry) => entry.id === 99)
      expect(response).toMatchObject({ id: 99, result: null })
    })
    await client.dispose()
  })
})

describe('LspManager', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-lsp-')))
  })

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('reuses one client per server and skips unsupported files', async () => {
    const files = [
      path.join(workspace, 'a.ts'),
      path.join(workspace, 'b.ts'),
      path.join(workspace, 'readme.md')
    ]
    await Promise.all(files.map((file) => fs.writeFile(file, 'x')))
    const servers: FakeServer[] = []
    const spawn = vi.fn<LspSpawn>(() => {
      const server = new FakeServer(
        initializing((instance, message) => {
          if (message.method !== 'textDocument/didOpen') return
          const document = message.params?.textDocument as { uri: string }
          instance.publish(document.uri, [])
        })
      )
      servers.push(server)
      return server as unknown as LspChildProcess
    })
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: async () => '/bin/typescript-language-server',
      diagnosticsTimeoutMs: 30
    })

    const results = await manager.diagnostics(files)

    expect(spawn).toHaveBeenCalledTimes(1)
    expect([...results.keys()]).toEqual(files.slice(0, 2))
    await manager.dispose()
    expect(servers[0].killed).toBe(true)
  })

  it('does not spawn a server when disposed during executable lookup', async () => {
    const file = path.join(workspace, 'a.ts')
    await fs.writeFile(file, 'const x = 1')
    let release: (value: string | null) => void = () => undefined
    const resolved = new Promise<string | null>((resolve) => {
      release = resolve
    })
    const spawn = vi.fn<LspSpawn>()
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: () => resolved
    })

    const pending = manager.diagnostics([file])
    await manager.dispose()
    release('/bin/typescript-language-server')
    await pending

    expect(spawn).not.toHaveBeenCalled()
  })

  it('formats hover and definition results', async () => {
    const file = path.join(workspace, 'a.ts')
    await fs.writeFile(file, 'const x = 1')
    const spawn = vi.fn<LspSpawn>(() => {
      const server = new FakeServer(
        initializing((instance, message) => {
          if (message.method === 'textDocument/hover') {
            instance.respond(message.id, { contents: 'Docs for x' })
          }
          if (message.method === 'textDocument/definition') {
            instance.respond(message.id, {
              uri: pathToFileURL(file).toString(),
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }
            })
          }
        })
      )
      return server as unknown as LspChildProcess
    })
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: async () => '/bin/typescript-language-server',
      diagnosticsTimeoutMs: 30
    })

    await expect(manager.hover(file, 1, 1)).resolves.toContain('Docs for x')
    await expect(manager.definition(file, 1, 1)).resolves.toContain('a.ts:1:1')
    await manager.dispose()
  })

  it('returns nothing when the server executable is unavailable', async () => {
    const file = path.join(workspace, 'a.ts')
    await fs.writeFile(file, 'x')
    const spawn = vi.fn<LspSpawn>()
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: async () => null,
      diagnosticsTimeoutMs: 30
    })

    await expect(manager.diagnostics([file])).resolves.toEqual(new Map())
    expect(spawn).not.toHaveBeenCalled()
    await manager.dispose()
  })

  it('reports the servers whose executables are installed', async () => {
    const manager = new LspManager({
      workspace,
      resolveExecutable: async (bin) => (bin === 'gopls' ? '/bin/gopls' : null)
    })

    await expect(manager.availableServers()).resolves.toEqual(['gopls'])
    await manager.dispose()
  })

  it('starts one client per project root', async () => {
    const project = path.join(workspace, 'packages', 'app')
    const appFile = path.join(project, 'src', 'a.ts')
    const rootFile = path.join(workspace, 'b.ts')
    await fs.mkdir(path.dirname(appFile), { recursive: true })
    await fs.writeFile(path.join(project, 'tsconfig.json'), '{}')
    await fs.writeFile(path.join(workspace, 'package.json'), '{}')
    await Promise.all([fs.writeFile(appFile, 'x'), fs.writeFile(rootFile, 'x')])
    const servers: FakeServer[] = []
    const spawn = vi.fn<LspSpawn>(() => {
      const server = new FakeServer(
        initializing((instance, message) => {
          if (message.method === 'textDocument/hover') {
            instance.respond(message.id, { contents: 'docs' })
          }
        })
      )
      servers.push(server)
      return server as unknown as LspChildProcess
    })
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: async () => '/bin/typescript-language-server',
      diagnosticsTimeoutMs: 20
    })

    await manager.hover(appFile, 1, 1)
    await manager.hover(rootFile, 1, 1)

    expect(spawn).toHaveBeenCalledTimes(2)
    const roots = servers.map(
      (server) =>
        (
          server.requests.find((entry) => entry.method === 'initialize')?.params as {
            rootUri?: string
          }
        )?.rootUri
    )
    expect(roots).toEqual([fileUri(project), fileUri(workspace)])
    await manager.dispose()
  })
})

describe('formatDiagnosticReport', () => {
  it('formats diagnostics relative to the workspace', () => {
    const results = new Map<string, LspDiagnostic[]>([
      [
        path.join('/work', 'src', 'a.ts'),
        [
          {
            line: 3,
            character: 5,
            severity: 1,
            message: 'Type error',
            source: 'ts',
            code: 2322
          }
        ]
      ],
      [path.join('/work', 'src', 'b.ts'), []]
    ])

    expect(formatDiagnosticReport(results, '/work')).toBe(
      'LSP diagnostics:\nsrc/a.ts:3:5 error ts(2322): Type error'
    )
  })

  it('returns an empty string without diagnostics and truncates long lists', () => {
    expect(formatDiagnosticReport(new Map(), '/work')).toBe('')

    const many = Array.from({ length: 25 }, (_, index) => ({
      line: index + 1,
      character: 1,
      severity: 2,
      message: `warning ${index}`
    }))
    const report = formatDiagnosticReport(new Map([['/work/a.ts', many]]), '/work')
    expect(report.split('\n')).toHaveLength(22)
    expect(report).toContain('[+5 more diagnostics]')
  })
})

describe('resolveLspServers', () => {
  const config = {
    snapshots: true,
    instructions: [],
    lsp: true,
    formatters: true,
    formatterOverrides: {},
    lspServers: {
      typescript: { extensions: ['.ts', '.foo'] },
      clangd: { disabled: true },
      deno: { command: ['deno', 'lsp'], extensions: ['.tsx'] }
    }
  } satisfies AgentConfig

  it('overrides, disables and adds servers', () => {
    const servers = resolveLspServers(config)
    expect(servers.find((server) => server.id === 'typescript')?.command).toEqual([
      'typescript-language-server',
      '--stdio'
    ])
    expect(servers.find((server) => server.id === 'typescript')?.extensions).toEqual([
      '.ts',
      '.foo'
    ])
    expect(servers.some((server) => server.id === 'clangd')).toBe(false)
    expect(servers.find((server) => server.id === 'deno')?.extensions).toEqual(['.tsx'])
    expect(lspServerForFile('index.ts', servers)?.id).toBe('typescript')
    expect(lspServerForFile('index.tsx', servers)?.id).toBe('deno')
  })
})

describe('configured LSP manager', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-lsp-config-')))
  })

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('uses configured servers for hover and definition', async () => {
    const file = path.join(workspace, 'a.foo')
    await fs.writeFile(file, 'const x = 1')
    const spawn = vi.fn<LspSpawn>(() => {
      const server = new FakeServer(
        initializing((instance, message) => {
          if (message.method === 'textDocument/hover') {
            instance.respond(message.id, { contents: 'Custom docs' })
          }
          if (message.method === 'textDocument/definition') {
            instance.respond(message.id, {
              uri: pathToFileURL(file).toString(),
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }
            })
          }
        })
      )
      return server as unknown as LspChildProcess
    })
    const manager = new LspManager({
      workspace,
      servers: [
        {
          id: 'custom',
          command: ['/bin/custom-language-server'],
          extensions: ['.foo']
        }
      ],
      spawn,
      resolveExecutable: async () => '/bin/custom-language-server',
      diagnosticsTimeoutMs: 30
    })

    await expect(manager.hover(file, 1, 1)).resolves.toContain('Custom docs')
    await expect(manager.definition(file, 1, 1)).resolves.toContain('a.foo:1:1')
    await manager.dispose()
  })
})

describe('LSP query operations', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-lsp-ops-')))
  })

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('formats references, implementations, symbols and call hierarchy', async () => {
    const file = path.join(workspace, 'src', 'a.ts')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, 'function foo(): void {}')
    const uri = pathToFileURL(file).toString()
    const range = { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } }
    const location = { uri, range }
    const servers: FakeServer[] = []
    const spawn = vi.fn<LspSpawn>(() => {
      const server = new FakeServer(
        initializing((instance, message) => {
          if (message.method === 'textDocument/references') {
            instance.respond(message.id, [location, location])
          }
          if (message.method === 'textDocument/implementation') {
            instance.respond(message.id, location)
          }
          if (message.method === 'textDocument/documentSymbol') {
            instance.respond(message.id, [
              {
                name: 'Foo',
                kind: 5,
                range,
                selectionRange: range,
                children: [
                  {
                    name: 'bar',
                    kind: 6,
                    range: { start: { line: 1, character: 2 } },
                    selectionRange: { start: { line: 1, character: 2 } }
                  }
                ]
              }
            ])
          }
          if (message.method === 'workspace/symbol') {
            instance.respond(message.id, [
              { name: 'Baz', kind: 12, location, containerName: 'mod' }
            ])
          }
          if (message.method === 'textDocument/prepareCallHierarchy') {
            instance.respond(message.id, [{ name: 'foo', uri, range, selectionRange: range }])
          }
          if (message.method === 'callHierarchy/incomingCalls') {
            instance.respond(message.id, [{ from: { name: 'caller', uri, range } }])
          }
          if (message.method === 'callHierarchy/outgoingCalls') {
            instance.respond(message.id, [{ to: { name: 'callee', uri, range } }])
          }
        })
      )
      servers.push(server)
      return server as unknown as LspChildProcess
    })
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: async () => '/bin/typescript-language-server',
      diagnosticsTimeoutMs: 20
    })

    await expect(manager.references(file, 5, 3)).resolves.toBe('References:\n- src/a.ts:5:3')
    await expect(manager.implementation(file, 5, 3)).resolves.toBe(
      'Implementations:\n- src/a.ts:5:3'
    )
    await expect(manager.documentSymbols(file)).resolves.toBe(
      'Symbols in src/a.ts:\n- Foo (class) src/a.ts:5:3\n  - bar (method) src/a.ts:2:3'
    )
    await expect(manager.workspaceSymbols('Baz', file)).resolves.toBe(
      'Workspace symbols for "Baz":\n- mod/Baz (function) src/a.ts:5:3'
    )
    const hierarchy = await manager.callHierarchy(file, 5, 3)
    expect(hierarchy).toContain('Call hierarchy at src/a.ts:5:3:')
    expect(hierarchy).toContain('Incoming:\n- caller (src/a.ts:5:3)')
    expect(hierarchy).toContain('Outgoing:\n- callee (src/a.ts:5:3)')

    const requests = servers[0].requests.map((entry) => entry.method)
    expect(requests.filter((method) => method === 'textDocument/references')).toHaveLength(1)
    const hierarchyRequests = servers[0].requests.filter((entry) =>
      entry.method?.startsWith('callHierarchy/')
    )
    expect(hierarchyRequests).toHaveLength(2)
    await manager.dispose()
  })

  it('limits call hierarchy requests to the requested direction', async () => {
    const file = path.join(workspace, 'a.ts')
    await fs.writeFile(file, 'function foo(): void {}')
    const uri = pathToFileURL(file).toString()
    const range = { start: { line: 0, character: 0 } }
    const servers: FakeServer[] = []
    const spawn = vi.fn<LspSpawn>(() => {
      const server = new FakeServer(
        initializing((instance, message) => {
          if (message.method === 'textDocument/prepareCallHierarchy') {
            instance.respond(message.id, [{ name: 'foo', uri, range }])
          }
          if (message.method === 'callHierarchy/incomingCalls') {
            instance.respond(message.id, [{ from: { name: 'caller', uri, range } }])
          }
          if (message.method === 'callHierarchy/outgoingCalls') {
            instance.respond(message.id, [{ to: { name: 'callee', uri, range } }])
          }
        })
      )
      servers.push(server)
      return server as unknown as LspChildProcess
    })
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: async () => '/bin/typescript-language-server',
      diagnosticsTimeoutMs: 20
    })

    const result = await manager.callHierarchy(file, 1, 1, 'incoming')

    expect(result).toContain('Incoming:')
    expect(result).not.toContain('Outgoing:')
    const methods = servers[0].requests.map((entry) => entry.method)
    expect(methods).not.toContain('callHierarchy/outgoingCalls')
    expect(methods.filter((method) => method === 'callHierarchy/incomingCalls')).toHaveLength(1)
    await manager.dispose()
  })

  it('returns empty strings for unsupported files and empty results', async () => {
    const markdown = path.join(workspace, 'README.md')
    const typescript = path.join(workspace, 'a.ts')
    await Promise.all([fs.writeFile(markdown, '# docs'), fs.writeFile(typescript, 'x')])
    const spawn = vi.fn<LspSpawn>(() => {
      const server = new FakeServer(
        initializing((instance, message) => {
          if (message.method === 'textDocument/references') instance.respond(message.id, [])
          if (message.method === 'textDocument/implementation') instance.respond(message.id, null)
          if (message.method === 'textDocument/documentSymbol') instance.respond(message.id, [])
          if (message.method === 'workspace/symbol') instance.respond(message.id, [])
          if (message.method === 'textDocument/prepareCallHierarchy') {
            instance.respond(message.id, null)
          }
        })
      )
      return server as unknown as LspChildProcess
    })
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: async () => '/bin/typescript-language-server',
      diagnosticsTimeoutMs: 20
    })

    await expect(manager.references(markdown, 1, 1)).resolves.toBe('')
    await expect(manager.references(typescript, 1, 1)).resolves.toBe('')
    await expect(manager.implementation(typescript, 1, 1)).resolves.toBe('')
    await expect(manager.documentSymbols(typescript)).resolves.toBe('')
    await expect(manager.workspaceSymbols('Nope', typescript)).resolves.toBe('')
    await expect(manager.callHierarchy(typescript, 1, 1)).resolves.toBe('')
    await manager.dispose()
  })
})

describe('LSP auto-install', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-lsp-install-')))
  })

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('installs a missing npm server on first use when enabled', async () => {
    const file = path.join(workspace, 'a.ts')
    await fs.writeFile(file, 'const x = 1')
    const spawn = vi.fn<LspSpawn>(() => {
      const server = new FakeServer(
        initializing((instance, message) => {
          if (message.method === 'textDocument/hover') {
            instance.respond(message.id, { contents: 'Installed docs' })
          }
        })
      )
      return server as unknown as LspChildProcess
    })
    const install = vi.fn(async () => '/bin/installed-language-server')
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: async () => null,
      autoInstall: true,
      install,
      diagnosticsTimeoutMs: 20
    })

    await expect(manager.hover(file, 1, 1)).resolves.toContain('Installed docs')

    expect(install).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'typescript', npmPackages: expect.any(Array) })
    )
    expect(spawn).toHaveBeenCalledTimes(1)
    await manager.dispose()
  })

  it('falls back to no LSP when installation fails', async () => {
    const file = path.join(workspace, 'a.ts')
    await fs.writeFile(file, 'x')
    const spawn = vi.fn<LspSpawn>()
    const install = vi.fn(async () => null)
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: async () => null,
      autoInstall: true,
      install,
      diagnosticsTimeoutMs: 20
    })

    await expect(manager.hover(file, 1, 1)).resolves.toBe('')

    expect(install).toHaveBeenCalledTimes(1)
    expect(spawn).not.toHaveBeenCalled()
    await manager.dispose()

    await expect(manager.references(file, 1, 1)).resolves.toBe('')
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('never installs when auto-install is off', async () => {
    const file = path.join(workspace, 'a.ts')
    await fs.writeFile(file, 'x')
    const spawn = vi.fn<LspSpawn>()
    const install = vi.fn(async () => '/bin/installed-language-server')
    const manager = new LspManager({
      workspace,
      spawn,
      resolveExecutable: async () => null,
      install
    })

    await expect(manager.hover(file, 1, 1)).resolves.toBe('')
    await expect(manager.availableServers()).resolves.toEqual([])

    expect(install).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    await manager.dispose()
  })
})

describe('LSP result formatting', () => {
  const workspace = '/work'
  const uri = pathToFileURL(path.join(workspace, 'src', 'a.ts')).toString()

  it('formats and dedupes locations with a cap', () => {
    const range = { start: { line: 4, character: 2 } }
    expect(formatLocationList('References', null, workspace)).toBe('')
    expect(formatLocationList('References', { uri, range }, workspace)).toBe(
      'References:\n- src/a.ts:5:3'
    )
    expect(
      formatLocationList(
        'Definition',
        [
          { uri, range },
          { uri, range }
        ],
        workspace
      )
    ).toBe('Definition:\n- src/a.ts:5:3')

    const many = Array.from({ length: 105 }, (_, index) => ({
      uri,
      range: { start: { line: index, character: 0 } }
    }))
    const report = formatLocationList('References', many, workspace)
    expect(report.split('\n')).toHaveLength(102)
    expect(report).toContain('[+5 more locations]')
  })

  it('formats document symbols hierarchically', () => {
    const result = [
      {
        name: 'Widget',
        kind: 5,
        selectionRange: { start: { line: 0, character: 0 } },
        children: [
          {
            name: 'render',
            kind: 6,
            selectionRange: { start: { line: 2, character: 4 } },
            children: [
              { name: 'inner', kind: 13, selectionRange: { start: { line: 3, character: 6 } } }
            ]
          }
        ]
      }
    ]

    expect(formatDocumentSymbols(result, path.join(workspace, 'src', 'a.ts'), workspace)).toBe(
      [
        'Symbols in src/a.ts:',
        '- Widget (class) src/a.ts:1:1',
        '  - render (method) src/a.ts:3:5',
        '    - inner (variable) src/a.ts:4:7'
      ].join('\n')
    )
    expect(formatDocumentSymbols([], '/work/a.ts', workspace)).toBe('')
  })

  it('formats workspace symbols with containers and skips entries without locations', () => {
    const result = [
      {
        name: 'helper',
        kind: 12,
        containerName: 'utils',
        location: { uri, range: { start: { line: 9, character: 4 } } }
      },
      { name: 'orphan', kind: 13 }
    ]

    expect(formatWorkspaceSymbols(result, 'help', workspace)).toBe(
      'Workspace symbols for "help":\n- utils/helper (function) src/a.ts:10:5'
    )
    expect(formatWorkspaceSymbols([], 'help', workspace)).toBe('')
  })

  it('formats call hierarchy sections', () => {
    const range = { start: { line: 1, character: 2 } }
    const result = formatCallHierarchyResult(
      'Call hierarchy at src/a.ts:2:3:',
      [
        {
          label: 'Incoming',
          items: [
            { from: { name: 'caller', uri, range } },
            { from: { name: 'caller', uri, range } }
          ]
        },
        { label: 'Outgoing', items: [{ to: { name: 'callee', uri, range } }] }
      ],
      workspace
    )

    expect(result).toBe(
      [
        'Call hierarchy at src/a.ts:2:3:',
        'Incoming:',
        '- caller (src/a.ts:2:3)',
        'Outgoing:',
        '- callee (src/a.ts:2:3)'
      ].join('\n')
    )
    expect(
      formatCallHierarchyResult('Heading:', [{ label: 'Incoming', items: [] }], workspace)
    ).toBe('')
  })
})
