import type { TextStreamPart, ToolSet } from 'ai'
import type {
  ChatMessage,
  ChatRetryStatus,
  ModelRef,
  RuntimeModelsConfig,
  StepStartPart,
  TokenUsage
} from '@ateam/shared'
import {
  messageCheckpoint,
  messageOpenStep,
  messageSnapshotBounds,
  messageSteps
} from '@ateam/shared'
import type { SessionsStore } from '../sessions/sessions-store'
import type { SnapshotStore } from '../sessions/snapshots'
import { nowIso, usageFrom } from './messages'
import { appendPart } from './run-messages'
import type { EventSink } from './runtime-events'
import type { Run } from './types'

export interface TurnStreamState {
  textParts: Map<string, number>
  reasoningParts: Map<string, number>
  usage?: TokenUsage
  lastStepUsage?: TokenUsage
  lastFinishReason?: string
}

export interface StepTrackerHost {
  readonly store: SessionsStore
  readonly snapshots: SnapshotStore
  readonly events: EventSink
  recordUsage(usage: TokenUsage, model: ModelRef | null, models: RuntimeModelsConfig): void
}

/**
 * Writes the step/snapshot/patch message parts that make a turn rewindable.
 * Every method is best effort: a failing snapshot leaves the step without a
 * snapshot (and therefore without a rewind point) instead of failing the run.
 */
export class StepTracker {
  constructor(private readonly host: StepTrackerHost) {}

  /**
   * Starts the step bookkeeping for the current `run.steps`. A real stream
   * sends `start-step` before the step's content, so the part precedes it.
   * Returns whether this call created the part (the fallback path).
   */
  ensureStepStarted(run: Run, message: ChatMessage): { part: StepStartPart; created: boolean } {
    const open = messageOpenStep(message.parts)
    if (open) return { part: open.part, created: false }
    const checkpoint = messageCheckpoint(message.parts)
    const part: StepStartPart = {
      type: 'step-start',
      step: run.steps,
      ...(checkpoint ? { snapshot: checkpoint } : {}),
      startedAt: nowIso()
    }
    appendPart(this.host.events, run, message, part)
    return { part, created: true }
  }

  /** Creates a checkpoint and diffs it against `before`; both must succeed. */
  private async captureStepSnapshot(
    run: Run,
    before: string | undefined
  ): Promise<{ snapshot: string; files: string[] } | undefined> {
    if (!before) return undefined
    try {
      const snapshot = await this.host.snapshots.create(
        run.workspace,
        run.sessionId,
        run.references
      )
      const diff = await this.host.snapshots.diff(before, snapshot.id)
      return { snapshot: snapshot.id, files: [...diff.added, ...diff.modified, ...diff.deleted] }
    } catch {
      /* snapshots are best effort */
      return undefined
    }
  }

  async finishStep(
    run: Run,
    message: ChatMessage,
    part: Extract<TextStreamPart<ToolSet>, { type: 'finish-step' }>,
    state: TurnStreamState
  ): Promise<void> {
    const step = run.steps
    const started = this.ensureStepStarted(run, message)
    const usage = part.usage ? usageFrom(part.usage) : undefined
    if (usage) {
      state.lastStepUsage = usage
      this.host.recordUsage(usage, message.model ?? null, run.models)
    }
    state.lastFinishReason = part.finishReason

    // A lazily created start part lands after the step content, so a rewind to
    // its boundary would keep content the snapshot no longer matches.
    const captured = started.created
      ? undefined
      : await this.captureStepSnapshot(run, started.part.snapshot)
    appendPart(this.host.events, run, message, {
      type: 'step-finish',
      step,
      ...(captured ? { snapshot: captured.snapshot } : {}),
      ...(part.finishReason ? { reason: part.finishReason } : {}),
      ...(usage ? { usage } : {}),
      ...(started.part.startedAt ? { startedAt: started.part.startedAt } : {}),
      finishedAt: nowIso()
    })
    if (captured && captured.files.length > 0) {
      appendPart(this.host.events, run, message, {
        type: 'patch',
        step,
        snapshot: captured.snapshot,
        files: captured.files
      })
    }
    run.steps += 1
  }

  async recordAfterSnapshot(run: Run, message: ChatMessage, reason = 'stop'): Promise<void> {
    const open = messageOpenStep(message.parts)
    if (open) {
      const captured = await this.captureStepSnapshot(run, open.part.snapshot)
      appendPart(this.host.events, run, message, {
        type: 'step-finish',
        step: open.step,
        ...(captured ? { snapshot: captured.snapshot } : {}),
        reason,
        ...(open.part.startedAt ? { startedAt: open.part.startedAt } : {}),
        finishedAt: nowIso()
      })
      if (captured && captured.files.length > 0) {
        appendPart(this.host.events, run, message, {
          type: 'patch',
          step: open.step,
          snapshot: captured.snapshot,
          files: captured.files
        })
      }
      await this.host.store.persist(run.sessionId)
      return
    }

    if (messageSteps(message.parts).length > 0) {
      await this.host.store.persist(run.sessionId)
      return
    }

    // No steps ran: record the turn as a single before/after snapshot pair.
    const bounds = messageSnapshotBounds(message.parts)
    const snapshotParts = message.parts.filter((part) => part.type === 'snapshot')
    if (!bounds.before || snapshotParts.length > 1) {
      await this.host.store.persist(run.sessionId)
      return
    }
    const captured = await this.captureStepSnapshot(run, bounds.before)
    if (captured) {
      appendPart(this.host.events, run, message, {
        type: 'snapshot',
        snapshot: captured.snapshot,
        ...(captured.files.length > 0 ? { files: captured.files } : {})
      })
    }
    await this.host.store.persist(run.sessionId)
  }

  resetAssistantMessage(run: Run, message: ChatMessage, retry?: ChatRetryStatus): void {
    // Keep the turn's starting snapshot so a retried stream still records its
    // before/after bounds; everything from the failed attempt is discarded.
    const head = message.parts[0]
    message.parts = head?.type === 'snapshot' ? [head] : []
    message.error = undefined
    message.usage = undefined
    message.contextUsage = undefined
    message.durationMs = undefined
    delete message.retry
    delete message.retryFailure
    if (retry) message.retry = retry
    message.status = 'streaming'
    message.updatedAt = nowIso()
    run.steps = 0
    this.host.events.emit({ type: 'message.upsert', message: structuredClone(message) })
  }
}
