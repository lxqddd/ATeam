import type { AgentEvent, AgentEventEnvelope, SessionMeta } from '@ateam/shared'
import type { PluginRegistry } from '../plugins'
import { nowIso } from './messages'

export interface RuntimeEventsHost {
  session(sessionId: string): SessionMeta | null
  isHidden(sessionId: string): boolean
  send: (envelope: AgentEventEnvelope) => void
  pluginsForSession?: (sessionId: string) => PluginRegistry | undefined
}

export interface EventSink {
  emit(event: AgentEvent): void
}

export class RuntimeEvents implements EventSink {
  private seq = 0

  constructor(private readonly host: RuntimeEventsHost) {}

  get currentSeq(): number {
    return this.seq
  }

  emitSession(sessionId: string): void {
    const session = this.host.session(sessionId)
    if (session) this.emit({ type: 'session.upsert', session })
  }

  emit(event: AgentEvent): void {
    const sessionId = 'sessionId' in event ? event.sessionId : null
    if (sessionId && this.host.isHidden(sessionId) && event.type !== 'subagent.finished') return
    this.seq += 1
    this.host.send({ seq: this.seq, at: nowIso(), event })
    if (sessionId) {
      const plugins = this.host.pluginsForSession?.(sessionId)
      if (plugins) void plugins.emitEvent(event).catch(() => undefined)
    }
  }
}
