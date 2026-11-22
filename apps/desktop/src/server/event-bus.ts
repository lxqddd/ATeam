import type { AgentEvent, AgentEventEnvelope } from '@ateam/shared'

export type AgentEventListener = (envelope: AgentEventEnvelope) => void

/** Fan out agent events to SSE clients and await run completion. */
export class EventBus {
  private listeners = new Set<AgentEventListener>()

  publish = (envelope: AgentEventEnvelope): void => {
    for (const listener of this.listeners) {
      try {
        listener(envelope)
      } catch {
        /* a failed listener must not break the agent */
      }
    }
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  waitFor(
    type: AgentEvent['type'],
    predicate: (event: AgentEvent) => boolean,
    timeoutMs = 10 * 60_000,
    signal?: AbortSignal
  ): Promise<AgentEventEnvelope> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        unsubscribe()
        signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        cleanup()
        reject(new Error('Wait aborted'))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for ${type}`))
      }, timeoutMs)
      const unsubscribe = this.subscribe((envelope) => {
        if (envelope.event.type !== type || !predicate(envelope.event)) return
        cleanup()
        resolve(envelope)
      })
      if (signal?.aborted) onAbort()
      else signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}
