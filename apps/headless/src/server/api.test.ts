import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AgentDefinition,
  AgentEvent,
  CommandDefinition,
  EffectiveAgentConfig,
  McpServerConfig,
  McpServerStatus,
  MessagesSnapshot,
  ModelRef,
  PermissionDecision,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  ResourceProvider,
  SessionMeta,
  SessionSettings
} from '@ateam/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { makeSession } from '@ateam/agent-core/testing'
import { createApiServer, type ApiRuntime } from './api'
import { EventBus } from './event-bus'
import type { LspServerSource } from './resources'

function effectiveConfigFixture(): EffectiveAgentConfig {
  return {
    config: {
      snapshots: true,
      instructions: [],
      lsp: true,
      formatters: true,
      formatterOverrides: {},
      systemPrompt: 'Use sk-abcdefghijklmnopqrstuvwxyz for calls',
      mcpServers: [
        {
          name: 'github',
          type: 'local',
          command: 'node',
          args: ['server.js'],
          env: { GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
          headers: { Authorization: 'Bearer header-secret-value' }
        }
      ],
      lspServers: {
        custom: {
          command: ['custom-lsp'],
          extensions: ['.foo'],
          env: { LSP_TOKEN: 'lsp-secret-value' }
        }
      },
      formatterServers: {
        custom: {
          command: ['custom-fmt', '$FILE'],
          extensions: ['.foo'],
          environment: { FMT_TOKEN: 'fmt-secret-value' }
        }
      },
      providers: {
        project: {
          type: 'openai-compatible',
          baseURL: 'https://project.example',
          apiKeyEnv: 'PROJECT_KEY'
        }
      }
    },
    sources: {
      globalConfigPath: '/user/agent/config.json',
      projectConfigPath: '/workspace/ateam.json',
      projectConfigDir: '/workspace',
      projectRoot: '/workspace'
    },
    diagnostics: [],
    provenance: {
      snapshots: 'default',
      instructions: 'default',
      lsp: 'project',
      formatters: 'project',
      references: 'default',
      permissions: 'default',
      mcp: 'project',
      agents: 'default',
      providers: 'project',
      plugins: 'default',
      commands: 'default',
      skills: 'default',
      retry: 'default',
      environment: 'default',
      toolOutput: 'default',
      systemPrompt: 'default'
    }
  }
}

class FakeRuntime implements ApiRuntime {
  sessions = new Map<string, SessionMeta>()
  snapshots = new Map<string, MessagesSnapshot>()
  permissionsList: PermissionRequest[] = []
  questionsList: QuestionRequest[] = []
  decisions: Array<{ id: string; decision: PermissionDecision }> = []
  answers: Array<{ id: string; answer: QuestionAnswer }> = []
  sent: Array<{ id: string; text: string; model?: ModelRef | null }> = []
  sendError: Error | null = null
  stopped: string[] = []
  workspace = '.'
  defaultWorkspacePath = '/default/workspace'
  resourceWorkspaces: string[] = []
  agents: AgentDefinition[] = []
  commands: CommandDefinition[] = []
  config: EffectiveAgentConfig = effectiveConfigFixture()
  providersList: ResourceProvider[] = []
  mcpServers: McpServerConfig[] = []
  mcpStatusList: McpServerStatus[] = []
  lspServers: LspServerSource[] = []
  private seq = 0

  constructor(private readonly bus: EventBus) {}

  listSessions(): SessionMeta[] {
    return [...this.sessions.values()]
  }

  async createSession(): Promise<SessionMeta> {
    const session = makeSession({ model: null, status: 'idle' })
    this.sessions.set(session.id, session)
    this.snapshots.set(session.id, { sessionId: session.id, seq: 0, messages: [], running: false })
    return { ...session }
  }

  async renameSession(id: string, title: string): Promise<SessionMeta> {
    const session = this.get(id)
    session.title = title
    return { ...session }
  }

  async setSessionModel(id: string, model: ModelRef | null): Promise<SessionMeta> {
    const session = this.get(id)
    session.model = model
    return { ...session }
  }

  async setSessionAgent(id: string, agent: string | null): Promise<SessionMeta> {
    const session = this.get(id)
    session.agent = agent
    return { ...session }
  }

  async setSessionSettings(id: string, settings: SessionSettings): Promise<SessionMeta> {
    const session = this.get(id)
    session.permissionMode = settings.permissionMode
    session.reasoningEffort = settings.reasoningEffort
    return { ...session }
  }

  messages(id: string): MessagesSnapshot {
    this.get(id)
    return this.snapshots.get(id) ?? { sessionId: id, seq: 0, messages: [], running: false }
  }

  sessionWorkspace(id: string): string {
    this.get(id)
    return this.workspace
  }

  defaultWorkspace(): string {
    return this.defaultWorkspacePath
  }

  async listAgents(workspace?: string): Promise<AgentDefinition[]> {
    this.resourceWorkspaces.push(workspace ?? '')
    return this.agents
  }

  async listCommands(workspace?: string): Promise<CommandDefinition[]> {
    this.resourceWorkspaces.push(workspace ?? '')
    return this.commands
  }

  async effectiveConfig(workspace?: string): Promise<EffectiveAgentConfig> {
    this.resourceWorkspaces.push(workspace ?? '')
    return this.config
  }

  async listProviders(workspace?: string): Promise<ResourceProvider[]> {
    this.resourceWorkspaces.push(workspace ?? '')
    return this.providersList
  }

  async listMcpServers(workspace?: string): Promise<McpServerConfig[]> {
    this.resourceWorkspaces.push(workspace ?? '')
    return this.mcpServers
  }

  async mcpStatuses(
    _options?: { probe?: boolean },
    workspace?: string
  ): Promise<McpServerStatus[]> {
    this.resourceWorkspaces.push(workspace ?? '')
    return this.mcpStatusList
  }

  async listLspServers(workspace?: string): Promise<LspServerSource[]> {
    this.resourceWorkspaces.push(workspace ?? '')
    return this.lspServers
  }

  async sendChat(id: string, text: string, model?: ModelRef | null): Promise<void> {
    this.get(id)
    if (this.sendError) throw this.sendError
    this.sent.push({ id, text, model })
    const event: AgentEvent = {
      type: 'run.finished',
      sessionId: id,
      messageId: 'assistant-1',
      status: 'completed'
    }
    queueMicrotask(() => {
      this.bus.publish({ seq: ++this.seq, at: new Date().toISOString(), event })
    })
  }

  stopChat(id: string): void {
    this.stopped.push(id)
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id)
    this.snapshots.delete(id)
  }

  async compactSession(id: string): Promise<SessionMeta> {
    return { ...this.get(id), compaction: null }
  }

  permissions(): PermissionRequest[] {
    return this.permissionsList
  }

  replyPermission(id: string, decision: PermissionDecision): void {
    this.decisions.push({ id, decision })
  }

  questions(): QuestionRequest[] {
    return this.questionsList
  }

  replyQuestion(id: string, answer: QuestionAnswer): void {
    this.answers.push({ id, answer })
  }

  private get(id: string): SessionMeta {
    const session = this.sessions.get(id)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    return session
  }
}

let api: ReturnType<typeof createApiServer> | null = null
const tempDirs: string[] = []

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-files-api-'))
  tempDirs.push(root)
  await fs.mkdir(path.join(root, 'src'))
  await fs.writeFile(path.join(root, 'README.md'), '# readme\n')
  await fs.writeFile(path.join(root, 'src/main.ts'), 'export const value = 1\n')
  await fs.writeFile(path.join(root, 'src/util.ts'), 'export const helper = 2\n')
  return root
}

async function start(token: string | null = null): Promise<{
  baseUrl: string
  runtime: FakeRuntime
  bus: EventBus
}> {
  const bus = new EventBus()
  const runtime = new FakeRuntime(bus)
  api = createApiServer({ runtime, bus, token, port: 0 })
  const address = await api.listen()
  return { baseUrl: `http://${address.host}:${address.port}`, runtime, bus }
}

afterEach(async () => {
  await api?.close()
  api = null
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

describe('API server', () => {
  it('serves health without auth and protects other routes', async () => {
    const { baseUrl } = await start('secret')

    expect(await (await fetch(`${baseUrl}/health`)).json()).toMatchObject({ ok: true })
    expect(await (await fetch(`${baseUrl}/v1/health`)).json()).toMatchObject({ ok: true })
    expect((await fetch(`${baseUrl}/sessions`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/v1/sessions`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/sessions`, { headers: auth('secret') })).status).toBe(200)
  })

  it('does not grant cross-origin access by default', async () => {
    const { baseUrl } = await start()
    const response = await fetch(`${baseUrl}/health`)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()

    const preflight = await fetch(`${baseUrl}/sessions`, { method: 'OPTIONS' })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('refuses to bind a remote host without a token', async () => {
    const bus = new EventBus()
    const runtime = new FakeRuntime(bus)
    const server = createApiServer({ runtime, bus, host: '0.0.0.0', port: 0 })
    await expect(server.listen()).rejects.toThrow('AUTH_REQUIRED_FOR_REMOTE_BIND')
  })

  it('creates sessions with settings and returns them', async () => {
    const { baseUrl } = await start('secret')
    const created = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'API session',
        permissionMode: 'acceptEdits',
        reasoningEffort: 'low',
        agent: 'plan',
        model: { providerId: 'p1', modelId: 'm1', variant: 'high' }
      })
    })
    const session = (await created.json()) as { id: string }

    expect(created.status).toBe(201)
    expect(session).toMatchObject({
      title: 'API session',
      permissionMode: 'acceptEdits',
      reasoningEffort: 'low',
      agent: 'plan',
      model: { providerId: 'p1', modelId: 'm1', variant: 'high' }
    })
    expect(
      await (await fetch(`${baseUrl}/sessions/${session.id}`, { headers: auth('secret') })).json()
    ).toMatchObject({ id: session.id })

    const deleted = await fetch(`${baseUrl}/sessions/${session.id}`, {
      method: 'DELETE',
      headers: auth('secret')
    })
    expect(deleted.status).toBe(200)
    expect(await (await fetch(`${baseUrl}/sessions`, { headers: auth('secret') })).json()).toEqual(
      []
    )
  })

  it('starts messages and optionally waits for completion', async () => {
    const { baseUrl, runtime } = await start('secret')
    const session = await runtime.createSession()

    const queued = await fetch(`${baseUrl}/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' })
    })
    expect(queued.status).toBe(202)

    const waited = await fetch(`${baseUrl}/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello again', wait: true })
    })
    const result = await waited.json()
    expect(result).toMatchObject({ sessionId: session.id, status: 'completed' })
    expect(runtime.sent.map((entry) => entry.text)).toEqual(['hello', 'hello again'])
  })

  it('maps busy sessions to 409 without leaking the wait promise', async () => {
    const { baseUrl, runtime } = await start('secret')
    const session = await runtime.createSession()
    runtime.sendError = new Error('SESSION_BUSY')

    const response = await fetch(`${baseUrl}/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello', wait: true })
    })

    expect(response.status).toBe(409)
  })

  it('stops and compacts sessions', async () => {
    const { baseUrl, runtime } = await start('secret')
    const session = await runtime.createSession()

    expect(
      (
        await fetch(`${baseUrl}/sessions/${session.id}/stop`, {
          method: 'POST',
          headers: auth('secret')
        })
      ).status
    ).toBe(202)
    expect(runtime.stopped).toEqual([session.id])

    expect(
      (
        await fetch(`${baseUrl}/sessions/${session.id}/compact`, {
          method: 'POST',
          headers: { ...auth('secret'), 'content-type': 'application/json' },
          body: JSON.stringify({ force: true })
        })
      ).status
    ).toBe(200)
  })

  it('lists and replies to permissions and questions', async () => {
    const { baseUrl, runtime } = await start('secret')
    runtime.permissionsList = [
      {
        id: 'perm-1',
        sessionId: 's1',
        messageId: 'm1',
        toolCallId: 'c1',
        action: 'shell',
        resource: 'ls',
        toolName: 'shell',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    runtime.questionsList = [
      {
        id: 'q1',
        sessionId: 's1',
        messageId: 'm1',
        toolCallId: 'c1',
        header: 'Pick',
        question: 'Continue?',
        options: [{ label: 'yes' }],
        multiple: false,
        allowCustom: false,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ]

    expect(
      await (await fetch(`${baseUrl}/permissions`, { headers: auth('secret') })).json()
    ).toHaveLength(1)
    await fetch(`${baseUrl}/permissions/perm-1`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'always' })
    })
    expect(runtime.decisions).toEqual([{ id: 'perm-1', decision: 'always' }])

    expect(
      await (await fetch(`${baseUrl}/questions`, { headers: auth('secret') })).json()
    ).toHaveLength(1)
    await fetch(`${baseUrl}/questions/q1`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ answer: { selected: ['yes'], custom: null } })
    })
    expect(runtime.answers[0]).toMatchObject({ id: 'q1', answer: { selected: ['yes'] } })
  })

  it('streams events over SSE with a token query', async () => {
    const { baseUrl, bus } = await start('secret')
    const controller = new AbortController()
    const response = await fetch(`${baseUrl}/events?token=secret`, {
      signal: controller.signal
    })
    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('missing body')

    const decoder = new TextDecoder()
    let buffer = ''
    const initial = await reader.read()
    if (!initial.done) buffer += decoder.decode(initial.value, { stream: true })
    bus.publish({
      seq: 1,
      at: '2026-01-01T00:00:00.000Z',
      event: { type: 'run.finished', sessionId: 's1', messageId: 'm1', status: 'completed' }
    })
    while (!buffer.includes('run.finished')) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
    }
    controller.abort()
    await reader.cancel().catch(() => undefined)
    expect(buffer).toContain('run.finished')
  })

  it('rejects unknown sessions and invalid bodies', async () => {
    const { baseUrl } = await start('secret')

    const missing = await fetch(`${baseUrl}/sessions/does-not-exist`, {
      headers: auth('secret')
    })
    expect(missing.status).toBe(404)

    const invalid = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { ...auth('secret'), 'content-type': 'application/json' },
      body: JSON.stringify({ permissionMode: 'invalid' })
    })
    expect(invalid.status).toBe(400)
  })

  it('lists, reads, finds and greps files inside the session workspace', async () => {
    const workspace = await makeWorkspace()
    const { baseUrl, runtime } = await start('secret')
    const session = await runtime.createSession()
    runtime.workspace = workspace

    const listed = (await (
      await fetch(`${baseUrl}/sessions/${session.id}/files`, { headers: auth('secret') })
    ).json()) as {
      sessionId: string
      path: string
      entries: Array<{ path: string; type: string; size: number | null }>
      truncated: boolean
    }
    expect(listed).toMatchObject({ sessionId: session.id, path: '', truncated: false })
    expect(listed.entries).toEqual(
      expect.arrayContaining([
        { path: 'README.md', name: 'README.md', type: 'file', size: expect.any(Number) },
        { path: 'src', name: 'src', type: 'directory', size: null }
      ])
    )

    const nested = (await (
      await fetch(`${baseUrl}/sessions/${session.id}/files?path=src&depth=2`, {
        headers: auth('secret')
      })
    ).json()) as { path: string; entries: Array<{ path: string; type: string }> }
    expect(nested.path).toBe('src')
    expect(nested.entries).toEqual(
      expect.arrayContaining([
        { path: 'src/main.ts', name: 'main.ts', type: 'file', size: expect.any(Number) },
        { path: 'src/util.ts', name: 'util.ts', type: 'file', size: expect.any(Number) }
      ])
    )

    const read = (await (
      await fetch(`${baseUrl}/sessions/${session.id}/files/content?path=src/main.ts`, {
        headers: auth('secret')
      })
    ).json()) as { path: string; content: string; truncated: boolean }
    expect(read).toMatchObject({
      path: 'src/main.ts',
      content: 'export const value = 1\n',
      truncated: false
    })

    const found = (await (
      await fetch(`${baseUrl}/sessions/${session.id}/files/find?pattern=**/*.ts`, {
        headers: auth('secret')
      })
    ).json()) as { sessionId: string; root: string; pattern: string; matches: string[] }
    expect(found).toMatchObject({ sessionId: session.id, root: '', pattern: '**/*.ts' })
    expect(found.matches).toEqual(['src/main.ts', 'src/util.ts'])

    const grepped = (await (
      await fetch(`${baseUrl}/sessions/${session.id}/files/grep?pattern=helper&include=*.ts`, {
        headers: auth('secret')
      })
    ).json()) as {
      matches: Array<{ path: string; line: number; text: string }>
      truncated: boolean
    }
    expect(grepped.truncated).toBe(false)
    expect(grepped.matches).toEqual([
      { path: 'src/util.ts', line: 1, text: 'export const helper = 2' }
    ])
  })

  it('rejects paths that escape the workspace and unreadable files', async () => {
    const workspace = await makeWorkspace()
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-files-outside-'))
    tempDirs.push(outside)
    await fs.writeFile(path.join(outside, 'secret.txt'), 'top secret\n')
    await fs.writeFile(path.join(workspace, 'data.bin'), Buffer.from([0x00, 0x01, 0x02]))
    await fs.symlink(outside, path.join(workspace, 'escape'))

    const { baseUrl, runtime } = await start('secret')
    const session = await runtime.createSession()
    runtime.workspace = workspace
    const base = `${baseUrl}/sessions/${session.id}/files`

    expect(
      (
        await fetch(`${base}/content?path=${encodeURIComponent('../outside.txt')}`, {
          headers: auth('secret')
        })
      ).status
    ).toBe(403)
    expect(
      (
        await fetch(`${base}/content?path=${encodeURIComponent('escape/secret.txt')}`, {
          headers: auth('secret')
        })
      ).status
    ).toBe(403)
    expect(
      (await fetch(`${base}?path=${encodeURIComponent('escape')}`, { headers: auth('secret') }))
        .status
    ).toBe(403)
    expect(
      (await fetch(`${base}/content?path=missing.txt`, { headers: auth('secret') })).status
    ).toBe(404)
    expect((await fetch(`${base}/content?path=data.bin`, { headers: auth('secret') })).status).toBe(
      415
    )
    expect((await fetch(`${base}/grep?pattern=(`, { headers: auth('secret') })).status).toBe(400)
    expect((await fetch(`${base}/grep`, { headers: auth('secret') })).status).toBe(400)

    const unknown = await fetch(`${baseUrl}/sessions/does-not-exist/files`, {
      headers: auth('secret')
    })
    expect(unknown.status).toBe(404)
  })

  it('marks listings and reads that hit their limits', async () => {
    const workspace = await makeWorkspace()
    const { baseUrl, runtime } = await start('secret')
    const session = await runtime.createSession()
    runtime.workspace = workspace
    await fs.writeFile(path.join(workspace, 'src/large.ts'), 'x'.repeat(600 * 1024))

    const limited = (await (
      await fetch(`${baseUrl}/sessions/${session.id}/files?limit=1`, { headers: auth('secret') })
    ).json()) as { entries: unknown[]; truncated: boolean }
    expect(limited.entries).toHaveLength(1)
    expect(limited.truncated).toBe(true)

    const read = (await (
      await fetch(`${baseUrl}/sessions/${session.id}/files/content?path=src/large.ts`, {
        headers: auth('secret')
      })
    ).json()) as { size: number; truncated: boolean }
    expect(read.size).toBe(600 * 1024)
    expect(read.truncated).toBe(true)
  })

  it('serves configuration and extension resources without credentials', async () => {
    const { baseUrl, runtime } = await start('secret')
    const session = await runtime.createSession()
    runtime.workspace = '/session/workspace'
    runtime.agents = [
      {
        id: 'reviewer',
        name: 'Reviewer',
        description: 'reviews',
        mode: 'primary',
        model: null,
        tools: null,
        permissions: [],
        maxSteps: null,
        temperature: null,
        prompt: 'Use sk-abcdefghijklmnopqrstuvwxyz',
        source: 'project'
      }
    ]
    runtime.commands = [
      {
        id: 'review',
        name: 'review',
        description: 'Review',
        template: 'curl -H "Authorization: Bearer abcdefghijklmnop"',
        agent: null,
        model: null,
        source: 'project'
      }
    ]
    runtime.providersList = [
      {
        id: 'project',
        name: 'Project',
        type: 'openai-compatible',
        baseURL: 'https://user:pass@api.example.com/v1?token=query-secret',
        hasApiKey: true,
        source: 'project'
      }
    ]
    runtime.mcpServers = [
      {
        id: 'mcp-1',
        name: 'remote',
        type: 'remote',
        command: null,
        args: [],
        url: 'https://user:pass@mcp.example.com/sse?token=query-secret',
        headers: { Authorization: 'Bearer header-secret-value' },
        env: { GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
        enabled: true,
        timeout: null,
        cwd: null,
        oauthClientId: 'client-id',
        oauthScope: null,
        oauthRedirectUri: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'project'
      }
    ]
    runtime.mcpStatusList = [
      {
        id: 'mcp-1',
        name: 'remote',
        state: 'connected',
        toolCount: 3,
        promptCount: 0,
        resourceCount: 0,
        error: null,
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    runtime.lspServers = [
      {
        id: 'typescript',
        extensions: ['.ts'],
        command: ['typescript-language-server', '--stdio', '--token=abc123'],
        env: { NODE_OPTIONS: '--inspect' },
        rootMarkers: ['tsconfig.json'],
        npmPackages: ['typescript']
      }
    ]
    const headers = auth('secret')

    const agents = (await (
      await fetch(`${baseUrl}/agents?sessionId=${session.id}`, { headers })
    ).json()) as AgentDefinition[]
    expect(agents[0].prompt).toBe('Use [REDACTED]')
    expect(runtime.resourceWorkspaces[0]).toBe('/session/workspace')

    const commands = (await (
      await fetch(`${baseUrl}/v1/commands`, { headers })
    ).json()) as CommandDefinition[]
    expect(commands[0].template).toBe('curl -H "Authorization: [REDACTED]"')
    expect(runtime.resourceWorkspaces[1]).toBe(runtime.defaultWorkspacePath)

    const config = (await (
      await fetch(`${baseUrl}/config?sessionId=${session.id}`, { headers })
    ).json()) as Record<string, unknown> & {
      workspace: string
      config: {
        mcpServers: Array<Record<string, unknown>>
        lspServers: Record<string, Record<string, unknown>>
        formatterServers: Record<string, Record<string, unknown>>
        providers: Record<string, { apiKeyEnv?: string }>
        systemPrompt?: string
      }
    }
    expect(config.workspace).toBe('/session/workspace')
    expect(config.config.mcpServers[0]).not.toHaveProperty('env')
    expect(config.config.mcpServers[0]).not.toHaveProperty('headers')
    expect(config.config.lspServers.custom).not.toHaveProperty('env')
    expect(config.config.formatterServers.custom).not.toHaveProperty('environment')
    expect(config.config.providers.project.apiKeyEnv).toBe('PROJECT_KEY')
    expect(config.config.systemPrompt).toContain('[REDACTED]')

    const providers = (await (
      await fetch(`${baseUrl}/v1/providers`, { headers })
    ).json()) as ResourceProvider[]
    expect(providers[0]).toMatchObject({
      id: 'project',
      baseURL: 'https://api.example.com/v1',
      hasApiKey: true,
      source: 'project'
    })

    const mcp = (await (await fetch(`${baseUrl}/mcp`, { headers })).json()) as Array<
      Record<string, unknown>
    >
    expect(mcp[0]).toMatchObject({
      id: 'mcp-1',
      url: 'https://mcp.example.com/sse',
      headerNames: ['Authorization'],
      envNames: ['GITHUB_TOKEN'],
      hasOAuthClientId: true,
      source: 'project',
      status: { id: 'mcp-1', state: 'connected' }
    })
    expect(JSON.stringify(mcp)).not.toContain('header-secret-value')
    expect(JSON.stringify(mcp)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')

    const lsp = (await (await fetch(`${baseUrl}/lsp`, { headers })).json()) as Array<
      Record<string, unknown>
    >
    expect(lsp[0]).toEqual({
      id: 'typescript',
      extensions: ['.ts'],
      command: ['typescript-language-server', '--stdio', '--token=[REDACTED]'],
      envNames: ['NODE_OPTIONS'],
      rootMarkers: ['tsconfig.json'],
      npmPackages: ['typescript']
    })

    const payload = JSON.stringify({ agents, commands, config, providers, mcp, lsp })
    for (const secret of [
      'sk-abcdefghijklmnopqrstuvwxyz',
      'abcdefghijklmnop',
      'query-secret',
      'header-secret-value',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'lsp-secret-value',
      'fmt-secret-value',
      'abc123'
    ]) {
      expect(payload).not.toContain(secret)
    }
  })

  it('rejects unknown sessions and malformed ids on resource routes', async () => {
    const { baseUrl } = await start('secret')
    const headers = auth('secret')

    expect((await fetch(`${baseUrl}/config?sessionId=missing`, { headers })).status).toBe(404)
    expect(
      (await fetch(`${baseUrl}/providers?sessionId=${encodeURIComponent('bad/id')}`, { headers }))
        .status
    ).toBe(400)
    expect((await fetch(`${baseUrl}/providers`)).status).toBe(401)
    expect((await fetch(`${baseUrl}/v1/providers`, { headers })).status).toBe(200)
  })
})
