import { app } from 'electron'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type {
  KernelEvent,
  KernelMessage,
  KernelModel,
  KernelPart,
  KernelPermission,
  KernelPermissionDecision,
  KernelSession,
  KernelState,
  KernelToolStatus,
  ProviderTestResult,
} from '@ateam/shared' with { "resolution-mode": "import" }
import { kernelConfig, kernelEnv, providerConfig } from './settings'
import { activeDirectory } from './projects'
import { evaluate } from './policy'
import { audit } from './audit'

// ATeam always asks before a turn changes files or runs a command; the ruleset is merged after the agent's own, so
// it wins for sessions this app creates.
const ATEAM_PERMISSIONS = [
  { action: 'edit', resource: '*', effect: 'ask' as const },
  { action: 'shell', resource: '*', effect: 'ask' as const },
]

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

interface RawPermission {
  id: string
  sessionID?: string
  action: string
  resources?: string[]
  message?: string
  metadata?: Record<string, unknown>
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
  private readonly seenPermissions = new Set<string>()

  private readonly dataRoot: string
  private readonly logFile: string
  private readonly pidFile: string
  private logStream: fs.WriteStream | null = null

  constructor(private readonly workspace: string) {
    this.dataRoot = path.join(app.getPath('userData'), 'opencode')
    this.logFile = path.join(app.getPath('userData'), 'logs', 'kernel.log')
    this.pidFile = path.join(app.getPath('userData'), 'kernel.pid')
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
      const binary = resolveKernelBinary()
      if (!binary) {
        throw new Error('ATeam kernel binary not found; run pnpm kernel:build or set ATEAM_KERNEL_BIN')
      }
      this.killStale()
      this.handshake(binary)
      writeKernelConfig(this.dataRoot)

      let lastError: Error | undefined
      // A port taken between allocation and bind shows up as an early exit; retry with a fresh one.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const port = await freePort()
        try {
          this.openLog()
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
          this.writePid(child.pid, port)
          child.once('exit', (code, signal) => {
            if (this.child !== child) {
              return
            }
            this.child = null
            this.removePid()
            this.eventsAbort?.abort()
            this.eventsAbort = null
            this.closeLog()
            if (this.state.status !== 'stopped') {
              this.state = {
                status: 'error',
                error: `ATeam kernel exited (${signal ?? code ?? 'unknown'})`,
              }
            }
          })

          const { password } = await waitForServer(child, attempt === 0 ? 20_000 : 30_000, (line) => this.log(line))
          this.password = password
          this.baseURL = `http://127.0.0.1:${port}`
          this.state = { status: 'ready', port }
          void this.consumeEvents()
          return this.status()
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
          this.log(`start attempt ${attempt + 1} failed: ${lastError.message}`)
          this.killChild()
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
      throw lastError ?? new Error('ATeam kernel failed to start')
    } catch (error) {
      this.state = {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
      this.killChild()
      this.closeLog()
      return this.status()
    }
  }

  async stop(): Promise<void> {
    this.state = { status: 'stopped' }
    this.eventsAbort?.abort()
    this.eventsAbort = null
    this.killChild()
    this.closeLog()
  }

  async restart(): Promise<KernelState> {
    await this.stop()
    return this.start()
  }

  private killChild(): void {
    const child = this.child
    this.child = null
    this.removePid()
    if (!child || child.killed) {
      return
    }
    const pid = child.pid
    const signal = (name: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && pid) {
          process.kill(-pid, name)
        } else {
          child.kill(name)
        }
      } catch {
        try {
          child.kill(name)
        } catch {
          /* already gone */
        }
      }
    }
    signal('SIGTERM')
    // A kernel that ignores SIGTERM must not outlive the app.
    const force = setTimeout(() => signal('SIGKILL'), 3000)
    child.once('exit', () => clearTimeout(force))
  }

  private openLog(): void {
    if (this.logStream) return
    const dir = path.dirname(this.logFile)
    fs.mkdirSync(dir, { recursive: true })
    try {
      const stat = fs.statSync(this.logFile)
      if (stat.size > 5 * 1024 * 1024) {
        fs.renameSync(this.logFile, `${this.logFile}.1`)
      }
    } catch {
      /* no log yet */
    }
    this.logStream = fs.createWriteStream(this.logFile, { flags: 'a', mode: 0o600 })
  }

  private log(line: string): void {
    if (!this.logStream) return
    const redacted = line
      .replace(/(server password\s+)\S+/g, '$1[redacted]')
      .replace(/\b(?:oc_sk|sk)-[A-Za-z0-9_-]{16,}/g, '[redacted]')
    this.logStream.write(`${redacted}\n`)
  }

  private closeLog(): void {
    this.logStream?.end()
    this.logStream = null
  }

  private writePid(pid: number | undefined, port: number): void {
    if (!pid) return
    try {
      fs.writeFileSync(this.pidFile, `${JSON.stringify({ pid, port })}\n`, { mode: 0o600 })
    } catch {
      /* best effort */
    }
  }

  private removePid(): void {
    try {
      fs.rmSync(this.pidFile, { force: true })
    } catch {
      /* best effort */
    }
  }

  /** Terminates a kernel left behind by a previous run that was killed before it could clean up. */
  private killStale(): void {
    if (process.platform === 'win32') {
      this.removePid()
      return
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.pidFile, 'utf8')) as unknown
      const pid = raw && typeof raw === 'object' ? (raw as { pid?: unknown }).pid : undefined
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1) {
        this.removePid()
        return
      }
      const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
      if (command.includes('opencode')) {
        this.log(`terminating stale kernel pid=${pid}`)
        process.kill(-pid, 'SIGKILL')
      }
    } catch {
      /* no stale kernel */
    } finally {
      this.removePid()
    }
  }

  /** Records the binary identity and drops caches when a different kernel build takes over. */
  private handshake(binary: string): void {
    const file = path.join(app.getPath('userData'), 'kernel-version.json')
    let previous: { size?: number; mtimeMs?: number } | undefined
    try {
      previous = JSON.parse(fs.readFileSync(file, 'utf8')) as { size?: number; mtimeMs?: number }
    } catch {
      previous = undefined
    }
    const stat = fs.statSync(binary)
    const current = {
      app: app.getVersion(),
      binary: path.basename(binary),
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      recordedAt: new Date().toISOString(),
    }
    if (previous && (previous.size !== current.size || previous.mtimeMs !== current.mtimeMs)) {
      this.log('kernel binary changed; clearing the kernel cache directory')
      try {
        fs.rmSync(path.join(this.dataRoot, 'cache'), { recursive: true, force: true })
        fs.mkdirSync(path.join(this.dataRoot, 'cache'), { recursive: true })
      } catch {
        /* cache stays; the kernel rebuilds it */
      }
    }
    try {
      fs.writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 })
    } catch {
      /* best effort */
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
        permissions: ATEAM_PERMISSIONS,
      },
    })
    return mapSession(response.data, this.sessionDirectory())
  }

  async listPermissions(sessionID: string): Promise<KernelPermission[]> {
    if (this.state.status !== 'ready') return []
    const response = await this.request<{ data?: RawPermission[] }>(
      `/api/session/${encodeURIComponent(sessionID)}/permission`,
    )
    return (response.data ?? []).map((raw) => {
      const command = typeof raw.metadata?.command === 'string' ? raw.metadata.command : undefined
      const verdict = evaluate(raw.action, raw.resources ?? [], command)
      if (!this.seenPermissions.has(raw.id)) {
        this.seenPermissions.add(raw.id)
        audit({ type: 'permission.asked', sessionID, requestID: raw.id, action: raw.action, resources: raw.resources, command })
      }
      return {
        id: raw.id,
        sessionID: raw.sessionID ?? sessionID,
        action: raw.action,
        resources: raw.resources ?? [],
        ...(raw.message ? { message: raw.message } : {}),
        ...(command ? { command } : {}),
        allowed: verdict.allowed,
        ...(verdict.reason ? { reason: verdict.reason } : {}),
      }
    })
  }

  async replyPermission(
    sessionID: string,
    requestID: string,
    decision: KernelPermissionDecision,
    message?: string,
  ): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`, {
      method: 'POST',
      body: { decision, ...(message ? { message } : {}) },
    })
    this.seenPermissions.delete(requestID)
    audit({ type: 'permission.replied', sessionID, requestID, decision, message })
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
    const signal = controller.signal
    while (!signal.aborted && this.state.status === 'ready') {
      try {
        const response = await fetch(this.baseURL + '/api/event', {
          headers: authHeader(this.password),
          signal,
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
                if (event.type) {
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
        if (!signal.aborted) {
          console.warn('ATeam kernel event stream interrupted; reconnecting:', error)
        }
      }
      if (signal.aborted) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (this.eventsAbort === controller) {
      this.eventsAbort = null
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
    case 'user': {
      const text = raw.payload?.text ?? raw.text ?? ''
      return [{ id: raw.id, role: 'user', parts: [{ kind: 'text', text }], text, createdAt }]
    }
    case 'assistant': {
      if (raw.error?.message && !raw.content?.length) {
        return [
          {
            id: raw.id,
            role: 'error',
            parts: [{ kind: 'text', text: raw.error.message }],
            text: raw.error.message,
            createdAt,
          },
        ]
      }
      const parts = mapParts(Array.isArray(raw.content) ? raw.content : [])
      const text = parts
        .filter((part): part is Extract<KernelPart, { kind: 'text' }> => part.kind === 'text' && !part.reasoning)
        .map((part) => part.text)
        .join('\n')
      return [{ id: raw.id, role: 'assistant', parts, text, createdAt }]
    }
    case 'idle':
      // The assistant message already carries the same provider error.
      return []
    case 'system':
    case 'synthetic': {
      const text = raw.text ?? raw.description ?? ''
      return [{ id: raw.id, role: 'system', parts: [{ kind: 'text', text }], text, createdAt }]
    }
    case 'shell': {
      const text = raw.command ?? raw.status ?? 'shell'
      return [{ id: raw.id, role: 'tool', parts: [{ kind: 'text', text }], text, createdAt }]
    }
    default:
      return []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function mapParts(content: unknown[]): KernelPart[] {
  const parts: KernelPart[] = []
  for (const item of content) {
    if (!isRecord(item)) continue
    if ((item.type === 'text' || item.type === 'reasoning') && typeof item.text === 'string') {
      if (!item.text) continue
      parts.push({
        kind: 'text',
        text: item.text,
        ...(item.type === 'reasoning' ? { reasoning: true } : {}),
      })
      continue
    }
    if (item.type !== 'tool') continue
    const state = isRecord(item.state) ? item.state : {}
    const rawStatus = typeof state.status === 'string' ? state.status : 'pending'
    const status: KernelToolStatus =
      rawStatus === 'completed'
        ? 'completed'
        : rawStatus === 'failed' || rawStatus === 'error'
          ? 'failed'
          : rawStatus === 'running'
            ? 'running'
            : 'pending'
    const input = state.input === undefined ? undefined : JSON.stringify(state.input)
    const output = Array.isArray(state.content)
      ? state.content
          .filter(isRecord)
          .filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => String(part.text))
          .join('\n')
      : undefined
    parts.push({
      kind: 'tool',
      id: typeof item.id === 'string' ? item.id : `tool:${parts.length}`,
      name: typeof item.name === 'string' ? item.name : 'tool',
      status,
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
    })
  }
  return parts
}

function waitForServer(
  child: ChildProcess,
  timeout: number,
  onLine?: (line: string) => void,
): Promise<{ password: string }> {
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
        if (!line) continue
        onLine?.(line)
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
      const text = chunk.toString()
      stderr += text
      for (const line of text.split('\n')) {
        if (line) onLine?.(`stderr: ${line}`)
      }
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

function resolveKernelBinary(): string | null {
  const explicit = process.env.ATEAM_KERNEL_BIN ?? process.env.OPENCODE_BIN
  if (explicit && fs.existsSync(explicit)) {
    return explicit
  }
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, 'kernel', 'ateam')
    : path.join(app.getAppPath(), 'resources', 'kernel', 'ateam')
  if (fs.existsSync(bundled)) {
    return bundled
  }
  const home = os.homedir()
  const names = ['ateam', 'opencode']
  const candidates: string[] = []
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) {
      continue
    }
    for (const name of names) {
      candidates.push(path.join(dir, name))
      if (process.platform === 'win32') {
        candidates.push(path.join(dir, `${name}.cmd`))
      }
    }
  }
  candidates.push(
    '/opt/homebrew/bin/ateam',
    '/usr/local/bin/ateam',
    path.join(home, '.local', 'bin', 'ateam'),
    '/opt/homebrew/bin/opencode',
    '/usr/local/bin/opencode',
    path.join(home, '.local', 'bin', 'opencode'),
    path.join(home, '.bun', 'bin', 'opencode'),
  )
  const nvmRoot = path.join(home, '.nvm', 'versions', 'node')
  if (fs.existsSync(nvmRoot)) {
    for (const version of fs.readdirSync(nvmRoot)) {
      for (const name of names) {
        candidates.push(path.join(nvmRoot, version, 'bin', name))
      }
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
