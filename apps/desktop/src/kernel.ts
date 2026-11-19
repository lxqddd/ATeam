import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type {
  KernelEvent,
  KernelMessage,
  KernelModel,
  KernelSession,
  KernelState,
  ProviderTestResult,
} from '@ateam/shared' with { "resolution-mode": "import" }
import { kernelConfig, kernelEnv, providerConfig } from './settings'
import { activeDirectory } from './projects'

interface RawSession {
  id: string
  title?: string
  location?: { directory?: string }
  model?: { id?: string; providerID?: string }
  time?: { created?: number; updated?: number; busy?: number; idle?: number }
}

interface RawMessage {
  id: string
  type: string
  time?: { created?: number }
  payload?: { text?: string }
  text?: string
  description?: string
  command?: string
  status?: string
  outcome?: string
  error?: { message?: string }
  content?: unknown[]
}

interface RawModel {
  id: string
  providerID?: string
  name?: string
  type?: string
  limit?: { context?: number }
}

type EventListener = (event: KernelEvent) => void

export class KernelManager {
  private child: ChildProcess | null = null
  private baseURL = ''
  private password = ''
  private state: KernelState = { status: 'stopped' }
  private eventsAbort: AbortController | null = null
  private listeners = new Set<EventListener>()
  private starting: Promise<KernelState> | null = null

  private readonly dataRoot: string

  constructor(private readonly workspace: string) {
    this.dataRoot = path.join(app.getPath('userData'), 'opencode')
    for (const dir of ['data', 'config', 'state', 'cache']) {
      fs.mkdirSync(path.join(this.dataRoot, dir), { recursive: true })
    }
    fs.mkdirSync(workspace, { recursive: true })
  }

  status(): KernelState {
    return { ...this.state }
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<KernelState> {
    if (this.state.status === 'ready') {
      return this.status()
    }
    if (this.starting) {
      return this.starting
    }
    this.starting = this.startInternal().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async startInternal(): Promise<KernelState> {
    this.state = { status: 'starting' }
    try {
      const binary = resolveOpenCodeBinary()
      if (!binary) {
        throw new Error('ATeam kernel binary not found; run pnpm opencode:build or set OPENCODE_BIN')
      }
      const port = await freePort()
      writeKernelConfig(this.dataRoot)
      const child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
        cwd: this.workspace,
        env: {
          ...process.env,
          ...kernelEnv(),
          XDG_DATA_HOME: path.join(this.dataRoot, 'data'),
          XDG_CONFIG_HOME: path.join(this.dataRoot, 'config'),
          XDG_STATE_HOME: path.join(this.dataRoot, 'state'),
          XDG_CACHE_HOME: path.join(this.dataRoot, 'cache'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
      this.child = child
      child.once('exit', (code, signal) => {
        if (this.child !== child) {
          return
        }
        this.child = null
        this.eventsAbort?.abort()
        this.eventsAbort = null
        if (this.state.status !== 'stopped') {
          this.state = {
            status: 'error',
            error: `ATeam kernel exited (${signal ?? code ?? 'unknown'})`,
          }
        }
      })

      const { password } = await waitForServer(child, 15_000)
      this.password = password
      this.baseURL = `http://127.0.0.1:${port}`
      this.state = { status: 'ready', port }
      void this.consumeEvents()
      return this.status()
    } catch (error) {
      this.state = {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
      this.killChild()
      return this.status()
    }
  }

  async stop(): Promise<void> {
    this.state = { status: 'stopped' }
    this.eventsAbort?.abort()
    this.eventsAbort = null
    this.killChild()
  }

  async restart(): Promise<KernelState> {
    await this.stop()
    return this.start()
  }

  private killChild(): void {
    const child = this.child
    this.child = null
    if (!child || child.killed) {
      return
    }
    try {
      if (process.platform !== 'win32' && child.pid) {
        process.kill(-child.pid, 'SIGTERM')
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      child.kill('SIGTERM')
    }
  }

  async listSessions(): Promise<KernelSession[]> {
    const response = await this.request<{ data?: RawSession[] }>('/api/session?limit=50')
    return (response.data ?? []).map((raw) => mapSession(raw, this.sessionDirectory()))
  }

  async createSession(title: string): Promise<KernelSession> {
    const response = await this.request<{ data: RawSession }>('/api/session', {
      method: 'POST',
      body: {
        title: title.trim() || 'ATeam',
        location: { directory: this.sessionDirectory() },
      },
    })
    return mapSession(response.data, this.sessionDirectory())
  }

  private sessionDirectory(): string {
    return activeDirectory(this.workspace)
  }

  async prompt(sessionID: string, text: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/prompt`, {
      method: 'POST',
      body: { text },
    })
  }

  async messages(sessionID: string): Promise<KernelMessage[]> {
    const response = await this.request<{ data?: RawMessage[] }>(
      `/api/session/${encodeURIComponent(sessionID)}/message`,
    )
    const result: KernelMessage[] = []
    for (const raw of response.data ?? []) {
      result.push(...mapMessage(raw))
    }
    // The API returns newest messages first; the transcript renders oldest first.
    return result.reverse()
  }

  async interrupt(sessionID: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/interrupt`, { method: 'POST' })
  }

  async listModels(): Promise<KernelModel[]> {
    if (this.state.status !== 'ready') return []
    const response = await this.request<{ data?: RawModel[] }>('/api/model')
    return (response.data ?? [])
      .filter((model) => (!model.type || model.type === 'chat') && Boolean(model.providerID))
      .map((model) => ({
        id: model.id,
        providerID: model.providerID ?? '',
        name: model.name ?? model.id,
        ...(model.limit?.context ? { context: model.limit.context } : {}),
      }))
      .sort((left, right) => left.providerID.localeCompare(right.providerID) || left.name.localeCompare(right.name))
  }

  async switchModel(sessionID: string, model: { id: string; providerID: string }): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/model`, {
      method: 'POST',
      body: { model },
    })
  }

  async testProvider(): Promise<ProviderTestResult> {
    const config = providerConfig()
    if (!config) return { ok: false, message: '尚未配置模型供应商' }
    if (this.state.status !== 'ready') return { ok: false, message: 'ATeam 内核未就绪' }
    try {
      // The catalog settles shortly after startup; give it a few seconds before failing.
      let models: Array<{ id: string; providerID?: string }> = []
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await this.request<{ data?: Array<{ id: string; providerID?: string }> }>('/api/model')
        models = response.data ?? []
        if (models.length > 0) break
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      const match = models.some(
        (model) => model.id === config.model && (!model.providerID || model.providerID === config.kind),
      )
      if (!match) {
        return {
          ok: false,
          message: `未找到模型 ${config.kind}/${config.model}，请检查 API Key 与模型 ID`,
          modelCount: models.length,
        }
      }
      return { ok: true, message: `连接成功，共 ${models.length} 个可用模型`, modelCount: models.length }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private async request<T>(pathname: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    if (this.state.status !== 'ready' || !this.baseURL) {
      throw new Error('ATeam kernel is not ready')
    }
    const response = await fetch(this.baseURL + pathname, {
      method: init.method ?? 'GET',
      headers: {
        ...authHeader(this.password),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`ATeam kernel request failed (${response.status}): ${text.slice(0, 300)}`)
    }
    if (response.status === 204) {
      return undefined as T
    }
    return (await response.json()) as T
  }

  private async consumeEvents(): Promise<void> {
    const controller = new AbortController()
    this.eventsAbort = controller
    try {
      const response = await fetch(this.baseURL + '/api/event', {
        headers: authHeader(this.password),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        throw new Error(`event stream failed (${response.status})`)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        buffer += decoder.decode(value, { stream: true })
        let index = buffer.indexOf('\n\n')
        while (index >= 0) {
          const chunk = buffer.slice(0, index).replace(/\r/g, '')
          buffer = buffer.slice(index + 2)
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data:')) {
              continue
            }
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') {
              continue
            }
            try {
              const event = JSON.parse(payload) as KernelEvent
              if (event.type && event.type !== 'server.connected') {
                for (const listener of this.listeners) {
                  listener(event)
                }
              }
            } catch {
              /* ignore malformed event */
            }
          }
          index = buffer.indexOf('\n\n')
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        // The session APIs keep working; the next renderer poll will still refresh.
        console.warn('OpenCode event stream stopped:', error)
      }
    } finally {
      if (this.eventsAbort === controller) {
        this.eventsAbort = null
      }
    }
  }
}

function authHeader(password: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
  }
}

function mapSession(raw: RawSession, fallbackDirectory: string): KernelSession {
  const time = raw.time ?? {}
  const busy = Boolean(time.busy && (!time.idle || time.busy > time.idle))
  return {
    id: raw.id,
    title: raw.title ?? 'ATeam session',
    directory: raw.location?.directory ?? fallbackDirectory,
    busy,
    ...(raw.model?.id && raw.model.providerID
      ? { model: { id: raw.model.id, providerID: raw.model.providerID } }
      : {}),
    createdAt: time.created ? new Date(time.created).toISOString() : undefined,
    updatedAt: time.updated ? new Date(time.updated).toISOString() : undefined,
  }
}

function mapMessage(raw: RawMessage): KernelMessage[] {
  const createdAt = raw.time?.created ? new Date(raw.time.created).toISOString() : undefined
  switch (raw.type) {
    case 'user':
      return [{ id: raw.id, role: 'user', text: raw.payload?.text ?? raw.text ?? '', createdAt }]
    case 'assistant': {
      if (raw.error?.message && !raw.content?.length) {
        return [
          {
            id: raw.id,
            role: 'error',
            text: raw.error.message,
            createdAt,
          },
        ]
      }
      const messages: KernelMessage[] = []
      const content = Array.isArray(raw.content) ? raw.content : []
      const text = content
        .filter((part): part is { type: string; text?: string } => isRecord(part) && part.type === 'text')
        .map((part) => part.text ?? '')
        .filter(Boolean)
        .join('\n')
      if (text) {
        messages.push({ id: raw.id, role: 'assistant', text, createdAt })
      }
      content.forEach((part, index) => {
        if (!isRecord(part) || part.type !== 'tool') {
          return
        }
        const name = typeof part.name === 'string' ? part.name : 'tool'
        messages.push({
          id: `${raw.id}:tool:${index}`,
          role: 'tool',
          text: name,
          toolName: name,
          createdAt,
        })
      })
      if (messages.length === 0) {
        messages.push({ id: raw.id, role: 'assistant', text: '', createdAt })
      }
      return messages
    }
    case 'idle':
      // The assistant message already carries the same provider error.
      return []
    case 'system':
    case 'synthetic':
      return [
        {
          id: raw.id,
          role: 'system',
          text: raw.text ?? raw.description ?? '',
          createdAt,
        },
      ]
    case 'shell':
      return [
        {
          id: raw.id,
          role: 'tool',
          text: raw.command ?? raw.status ?? 'shell',
          toolName: 'shell',
          createdAt,
        },
      ]
    default:
      return []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function waitForServer(child: ChildProcess, timeout: number): Promise<{ password: string }> {
  return new Promise((resolve, reject) => {
    let password = ''
    let listening = false
    let stderr = ''
    let settled = false

    const finish = () => {
      if (!settled && password && listening) {
        settled = true
        cleanup()
        resolve({ password })
      }
    }
    const fail = (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    const timer = setTimeout(() => {
      fail(new Error(`ATeam kernel did not start within ${timeout}ms${stderr ? `: ${stderr.slice(-300)}` : ''}`))
    }, timeout)
    const onStdout = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const passwordMatch = line.match(/server password\s+(\S+)/)
        const matchedPassword = passwordMatch?.[1]
        if (matchedPassword) {
          password = matchedPassword
          finish()
        }
        if (/server listening on\s+http:\/\//.test(line)) {
          listening = true
          finish()
        }
      }
    }
    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString()
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(new Error(`ATeam kernel exited during startup (${signal ?? code ?? 'unknown'})`))
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.off('exit', onExit)
    }

    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.once('exit', onExit)
  })
}

function resolveOpenCodeBinary(): string | null {
  const explicit = process.env.OPENCODE_BIN
  if (explicit && fs.existsSync(explicit)) {
    return explicit
  }
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, 'opencode', 'opencode')
    : path.join(app.getAppPath(), 'resources', 'opencode', 'opencode')
  if (fs.existsSync(bundled)) {
    return bundled
  }
  const home = os.homedir()
  const candidates: string[] = []
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) {
      candidates.push(path.join(dir, 'opencode'))
      if (process.platform === 'win32') {
        candidates.push(path.join(dir, 'opencode.cmd'))
      }
    }
  }
  candidates.push(
    '/opt/homebrew/bin/opencode',
    '/usr/local/bin/opencode',
    path.join(home, '.local', 'bin', 'opencode'),
    path.join(home, '.bun', 'bin', 'opencode'),
  )
  const nvmRoot = path.join(home, '.nvm', 'versions', 'node')
  if (fs.existsSync(nvmRoot)) {
    for (const version of fs.readdirSync(nvmRoot)) {
      candidates.push(path.join(nvmRoot, version, 'bin', 'opencode'))
    }
  }
  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return fs.statSync(candidate).isFile()
    } catch {
      return false
    }
  }) ?? null
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('could not allocate a loopback port'))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

export function kernelWorkspace(): string {
  return path.join(app.getPath('userData'), 'workspace')
}

function writeKernelConfig(dataRoot: string) {
  const dir = path.join(dataRoot, 'config', 'opencode')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'opencode.json')
  const current = (() => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  })()
  const configured = kernelConfig()
  if (configured) {
    current.model = configured.model
  } else {
    delete current.model
  }
  fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`)
}
