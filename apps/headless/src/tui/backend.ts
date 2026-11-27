import type { AgentRuntime } from '@ateam/agent-core'
import type {
  AgentEvent,
  MessagesSnapshot,
  ModelRef,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  ReasoningEffort,
  RuntimeModelsConfig,
  SessionMeta
} from '@ateam/shared'
import { createHeadlessRuntime } from '../runtime'

/** Options a new TUI session opens with. */
export interface TuiNewSession {
  permissionMode: PermissionMode
  reasoningEffort: ReasoningEffort | null
  agent: string | null
  model: ModelRef | null
}

export interface TuiBackendListener {
  /** One runtime event, already unwrapped from its envelope. */
  event(event: AgentEvent): void
  /**
   * The event stream reconnected after a gap. Snapshots must be reloaded
   * because deltas that arrived while disconnected were lost.
   */
  resync(): void
}

/**
 * Everything the TUI needs from a session host. Implemented in-process for
 * local use and over HTTP for attaching to a running `pnpm serve`.
 */
export interface TuiBackend {
  readonly mode: 'local' | 'attach'
  init(): Promise<void>
  listSessions(): Promise<SessionMeta[]>
  createSession(input: TuiNewSession): Promise<SessionMeta>
  messages(id: string): Promise<MessagesSnapshot>
  /** Returns `steered` when the session was busy and the text was queued. */
  sendChat(id: string, text: string): Promise<'sent' | 'steered'>
  stopChat(id: string): Promise<void>
  retryChat(id: string): Promise<void>
  replyPermission(id: string, decision: PermissionDecision): Promise<void>
  replyQuestion(id: string, answer: QuestionAnswer): Promise<void>
  permissions(): Promise<PermissionRequest[]>
  questions(): Promise<QuestionRequest[]>
  subscribe(listener: TuiBackendListener): () => void
  /** Aborts runs, closes stores and child processes. Safe to call twice. */
  shutdown(): Promise<void>
}

export interface LocalTuiBackendOptions {
  dataDir: string
  workspace: string
  models: RuntimeModelsConfig
  model: ModelRef | null
  permissionMode: PermissionMode
  reasoningEffort: ReasoningEffort | null
  agent: string | null
}

/**
 * In-process backend. Shares the session store and provider configuration
 * with the CLI and the desktop app.
 */
export class LocalTuiBackend implements TuiBackend {
  readonly mode = 'local' as const
  private runtime: AgentRuntime | null = null
  private readonly listeners = new Set<TuiBackendListener>()
  private closed = false

  constructor(private readonly options: LocalTuiBackendOptions) {}

  async init(): Promise<void> {
    if (this.runtime) return
    this.runtime = createHeadlessRuntime({
      dataDir: this.options.dataDir,
      workspace: this.options.workspace,
      models: this.options.models,
      send: (envelope) => {
        for (const listener of this.listeners) listener.event(envelope.event)
      }
    })
    await this.runtime.init()
  }

  private host(): AgentRuntime {
    if (!this.runtime) throw new Error('TUI backend is not initialized')
    return this.runtime
  }

  listSessions(): Promise<SessionMeta[]> {
    return Promise.resolve(this.host().listSessions())
  }

  async createSession(input: TuiNewSession): Promise<SessionMeta> {
    const runtime = this.host()
    let session = await runtime.createSession()
    session = await runtime.setSessionSettings(session.id, {
      permissionMode: input.permissionMode,
      reasoningEffort: input.reasoningEffort
    })
    if (input.model) session = await runtime.setSessionModel(session.id, input.model)
    if (input.agent) session = await runtime.setSessionAgent(session.id, input.agent)
    return session
  }

  messages(id: string): Promise<MessagesSnapshot> {
    return Promise.resolve(this.host().messages(id))
  }

  async sendChat(id: string, text: string): Promise<'sent' | 'steered'> {
    const runtime = this.host()
    try {
      await runtime.sendChat(id, text)
      return 'sent'
    } catch (error) {
      if (error instanceof Error && error.message.includes('SESSION_BUSY')) {
        runtime.steerChat(id, { text })
        return 'steered'
      }
      throw error
    }
  }

  stopChat(id: string): Promise<void> {
    // The runtime aborts synchronously; the persisted interrupt event follows.
    this.host().stopChat(id)
    return Promise.resolve()
  }

  retryChat(id: string): Promise<void> {
    return this.host().retryChat(id)
  }

  replyPermission(id: string, decision: PermissionDecision): Promise<void> {
    const runtime = this.host()
    runtime.replyPermission(id, decision)
    return Promise.resolve()
  }

  replyQuestion(id: string, answer: QuestionAnswer): Promise<void> {
    const runtime = this.host()
    runtime.replyQuestion(id, answer)
    return Promise.resolve()
  }

  permissions(): Promise<PermissionRequest[]> {
    return Promise.resolve(this.host().permissions())
  }

  questions(): Promise<QuestionRequest[]> {
    return Promise.resolve(this.host().questions())
  }

  subscribe(listener: TuiBackendListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async shutdown(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    if (!this.runtime) return
    const runtime = this.runtime
    this.runtime = null
    await runtime.shutdown()
  }
}
