import { randomUUID } from 'node:crypto'
import { utilityProcess } from 'electron'
import type {
  AgentEventEnvelope,
  AgentStatus,
  McpAuthRecord,
  RuntimeModelsConfig,
  RuntimeWebSearchConfig,
  WorkerMessage
} from '@ateam/shared'
import { normalizeError } from './errors'

type UtilityProcess = ReturnType<typeof utilityProcess.fork>

const CALL_TIMEOUT_MS = 60_000

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface AgentManagerOptions {
  workerPath: string
  userDataPath: string
  workspacePath: string
  appVersion: string
  onEvent: (envelope: AgentEventEnvelope) => void
  mcpAuth?: () => McpAuthRecord[]
  onMcpAuth?: (auth: McpAuthRecord) => void
  browserRequest?: (
    sessionId: string,
    method: string,
    params?: Record<string, unknown>,
    deadline?: number
  ) => Promise<unknown>
}

export class AgentManager {
  private worker: UtilityProcess | null = null
  private pending = new Map<string, PendingCall>()
  private status: AgentStatus = { status: 'stopped' }
  private stopping = false
  private models: RuntimeModelsConfig = { providers: [], models: [], defaultModel: null }
  private modelsDirty = false
  private webSearch: RuntimeWebSearchConfig | null = null
  private webSearchDirty = false

  constructor(private readonly options: AgentManagerOptions) {}

  getStatus(): AgentStatus {
    return { ...this.status }
  }

  isReady(): boolean {
    return this.status.status === 'ready'
  }

  async start(
    models?: RuntimeModelsConfig,
    webSearch?: RuntimeWebSearchConfig | null
  ): Promise<void> {
    if (models) this.models = models
    if (webSearch !== undefined) this.webSearch = webSearch
    if (this.worker) await this.stop()

    this.stopping = false
    this.setStatus({ status: 'starting' })

    let worker: UtilityProcess
    try {
      worker = utilityProcess.fork(this.options.workerPath, [], {
        serviceName: 'ATeam Agent',
        stdio: 'pipe'
      })
    } catch (error) {
      this.setStatus({ status: 'error', error: normalizeError(error) })
      throw error
    }

    this.worker = worker
    this.attach(worker)

    try {
      await this.call('init', {
        userDataPath: this.options.userDataPath,
        workspacePath: this.options.workspacePath,
        appVersion: this.options.appVersion,
        models: this.models,
        webSearch: this.webSearch,
        mcpAuth: this.options.mcpAuth?.() ?? []
      })
      if (this.worker !== worker) return
      if (this.modelsDirty) {
        try {
          await this.call('setModels', { models: this.models })
          this.modelsDirty = false
        } catch (error) {
          console.error('[agent] failed to apply the latest model configuration', error)
        }
      }
      if (this.webSearchDirty) {
        try {
          await this.call('setWebSearch', { config: this.webSearch })
          this.webSearchDirty = false
        } catch (error) {
          console.error('[agent] failed to apply the latest web search configuration', error)
        }
      }
      this.setStatus({ status: 'ready', pid: worker.pid })
    } catch (error) {
      if (this.worker === worker) {
        this.worker = null
        this.rejectAll('AGENT_START_FAILED')
        this.setStatus({ status: 'error', error: normalizeError(error) })
        worker.kill()
      }
      throw error
    }
  }

  async restart(models?: RuntimeModelsConfig): Promise<AgentStatus> {
    await this.stop()
    await this.start(models)
    return this.getStatus()
  }

  async stop(): Promise<void> {
    const worker = this.worker
    if (!worker) {
      this.setStatus({ status: 'stopped' })
      return
    }

    this.stopping = true
    try {
      await Promise.race([
        this.call('shutdown'),
        new Promise((resolve) => setTimeout(resolve, 1_500))
      ])
    } catch {
      /* the worker is going away anyway */
    }
    worker.kill()
    this.worker = null
    this.rejectAll('AGENT_STOPPED')
    this.setStatus({ status: 'stopped' })
    this.stopping = false
  }

  async setModels(models: RuntimeModelsConfig): Promise<void> {
    this.models = models
    this.modelsDirty = true
    if (this.status.status !== 'ready' || !this.worker) return
    await this.call('setModels', { models })
    this.modelsDirty = false
  }

  async setWebSearch(config: RuntimeWebSearchConfig | null): Promise<void> {
    this.webSearch = config
    this.webSearchDirty = true
    if (this.status.status !== 'ready' || !this.worker) return
    await this.call('setWebSearch', { config })
    this.webSearchDirty = false
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    return (await this.call(method, params)) as T
  }

  async setMcpAuth(auths: McpAuthRecord[]): Promise<void> {
    if (this.status.status !== 'ready' || !this.worker) return
    await this.call('mcp.setAuth', { auths })
  }

  private attach(worker: UtilityProcess): void {
    worker.on('message', (message: WorkerMessage) => this.onMessage(message))
    worker.on('exit', (code) => this.onExit(worker, code))
    worker.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) console.log(`[agent] ${text}`)
    })
    worker.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) console.error(`[agent] ${text}`)
    })
  }

  private onMessage(message: WorkerMessage): void {
    if (!message || typeof message !== 'object') return

    if (message.kind === 'event') {
      this.options.onEvent(message.envelope)
      return
    }

    if (message.kind === 'mcp-auth') {
      this.options.onMcpAuth?.(message.auth)
      return
    }

    if (message.kind === 'browser') {
      const worker = this.worker
      const handler = this.options.browserRequest
      const request = handler
        ? handler(message.sessionId, message.method, message.params, Date.now() + 55_000)
        : Promise.reject(new Error('BROWSER_NOT_AVAILABLE'))
      void request
        .then((result) => {
          if (worker && worker === this.worker) {
            worker.postMessage({
              method: 'browser.result',
              requestId: message.requestId,
              ok: true,
              result
            })
          }
        })
        .catch((error: unknown) => {
          if (worker && worker === this.worker) {
            worker.postMessage({
              method: 'browser.result',
              requestId: message.requestId,
              ok: false,
              error: normalizeError(error)
            })
          }
        })
      return
    }

    if (message.kind === 'ready') {
      if (this.status.status === 'starting') {
        this.setStatus({ status: 'ready', pid: message.status.pid })
      }
      return
    }

    if (message.kind === 'response') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(message.error))
    }
  }

  private onExit(worker: UtilityProcess, code: number): void {
    if (this.worker !== worker) return
    this.worker = null
    this.rejectAll(`AGENT_EXITED: worker exited with code ${code}`)
    if (this.stopping) {
      this.setStatus({ status: 'stopped' })
    } else {
      this.setStatus({
        status: 'error',
        error: `The agent process stopped unexpectedly (exit code ${code}).`
      })
    }
  }

  private call(method: string, params?: unknown): Promise<unknown> {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('AGENT_NOT_READY'))

    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('AGENT_TIMEOUT'))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      worker.postMessage({ id, method, params })
    })
  }

  private rejectAll(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }

  private setStatus(status: AgentStatus): void {
    this.status = status
    this.options.onEvent({
      seq: 0,
      at: new Date().toISOString(),
      event: { type: 'agent.status', status: { ...status } }
    })
  }
}
