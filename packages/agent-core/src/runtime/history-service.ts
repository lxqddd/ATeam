import type {
  AgentEvent,
  SessionChangesSummary,
  SessionMeta,
  TurnChanges,
  VcsDiffOptions,
  VcsDiffResult,
  VcsStatus
} from '@ateam/shared'
import { messageChangedFiles, messageSnapshotBounds, messageSteps } from '@ateam/shared'
import type { SessionsStore } from '../sessions/sessions-store'
import type { SnapshotStore } from '../sessions/snapshots'
import type { VcsService } from '../vcs'
import { nowIso } from './messages'
import {
  allowedChangePaths,
  buildSessionChanges,
  buildTurnChanges,
  latestSnapshotMessage,
  type TurnChangesHost
} from './turn-changes'

export interface HistoryHost {
  readonly store: SessionsStore
  readonly snapshots: SnapshotStore
  emit(event: AgentEvent): void
  updateContextUsage(sessionId: string): Promise<void>
  reserveSession(sessionId: string): void
  releaseSession(sessionId: string): void
  sessionBusy(sessionId: string): boolean
  sessionWorkspace(sessionId: string): string
  /** Creates a snapshot of the session workspace taken before a revert. */
  createRevertSnapshot(sessionId: string, workspace: string): Promise<string>
  vcs(workspace: string): VcsService
}

/**
 * Session history: whole-turn undo/redo, step rewind, turn changes and
 * file-level revert/unrevert. All state lives in `SessionsStore` and
 * `SnapshotStore`; the runtime only supplies workspace resolution and the
 * busy/reservation bookkeeping.
 */
export class HistoryService {
  constructor(private readonly host: HistoryHost) {}

  async undoSession(
    id: string,
    messageId?: string,
    stepIndex?: number
  ): Promise<{ session: SessionMeta; prompt: string }> {
    if (stepIndex !== undefined) return this.rewindAssistantStep(id, messageId, stepIndex)
    const record = this.host.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    this.host.reserveSession(id)

    try {
      let assistantIndex = -1
      if (messageId) {
        assistantIndex = record.messages.findIndex(
          (message) => message.id === messageId && message.role === 'assistant'
        )
      } else {
        for (let index = record.messages.length - 1; index >= 0; index -= 1) {
          if (record.messages[index].role === 'assistant') {
            assistantIndex = index
            break
          }
        }
      }
      if (assistantIndex < 0) throw new Error('NOTHING_TO_UNDO')

      let userIndex = assistantIndex - 1
      while (userIndex >= 0 && record.messages[userIndex].role !== 'user') userIndex -= 1
      if (userIndex < 0) throw new Error('NOTHING_TO_UNDO')

      const assistant = record.messages[assistantIndex]
      const removedMessages = record.messages.slice(userIndex)
      const removedAssistants = removedMessages.filter((item) => item.role === 'assistant')
      const finalAssistant = removedAssistants[removedAssistants.length - 1]
      const files = [
        ...new Set(removedMessages.flatMap((message) => messageChangedFiles(message.parts)))
      ]
      const before = messageSnapshotBounds(assistant.parts).before
      if (before && files.length > 0) {
        try {
          await this.host.snapshots.restorePaths(before, files)
        } catch {
          throw new Error('SNAPSHOT_RESTORE_FAILED')
        }
      }

      const prompt = record.messages[userIndex].parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
      const staged = await this.host.store.stageUndo(
        id,
        userIndex,
        finalAssistant ? (messageSnapshotBounds(finalAssistant.parts).after ?? null) : null,
        prompt,
        files
      )
      if (!staged) throw new Error('NOTHING_TO_UNDO')
      this.host.emit({ type: 'session.upsert', session: staged.session })
      await this.host.updateContextUsage(id)
      return { session: this.host.store.getSession(id) ?? staged.session, prompt }
    } finally {
      this.host.releaseSession(id)
    }
  }

  /**
   * Truncates the latest assistant turn at a recorded step boundary and
   * restores the workspace files to the snapshot taken when that step ended.
   * The original message is kept in the redo state so the rewind can be undone.
   */
  private async rewindAssistantStep(
    id: string,
    messageId: string | undefined,
    stepIndex: number
  ): Promise<{ session: SessionMeta; prompt: string }> {
    if (!Number.isInteger(stepIndex) || stepIndex < 0) throw new Error('INVALID_STEP_INDEX')
    const record = this.host.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    this.host.reserveSession(id)

    try {
      const assistantIndex = messageId
        ? record.messages.findIndex(
            (message) => message.id === messageId && message.role === 'assistant'
          )
        : -1
      if (assistantIndex < 0) throw new Error(messageId ? 'MESSAGE_NOT_FOUND' : 'NOTHING_TO_UNDO')
      const message = record.messages[assistantIndex]
      if (message.status === 'streaming') throw new Error('SESSION_BUSY')
      if (latestSnapshotMessage(record.messages)?.id !== message.id) {
        throw new Error('TURN_NOT_LATEST')
      }

      const steps = messageSteps(message.parts)
      const target = steps.find((step) => step.step === stepIndex)
      if (!target) throw new Error('INVALID_STEP_INDEX')
      if (!target.finish?.snapshot) throw new Error('NOTHING_TO_UNDO')
      // A later step must exist; a trailing run-level snapshot part must not
      // make the final step look rewindable.
      if (!steps.some((step) => step.step > target.step)) throw new Error('NOTHING_TO_UNDO')

      const files = messageChangedFiles(message.parts)
      if (files.length > 0) {
        try {
          await this.host.snapshots.restorePaths(target.finish.snapshot, files)
        } catch {
          throw new Error('SNAPSHOT_RESTORE_FAILED')
        }
      }

      const original = structuredClone(message)
      message.parts = message.parts.slice(0, target.endIndex)
      message.updatedAt = nowIso()
      const session = await this.host.store.stageStepUndo(
        id,
        assistantIndex,
        original,
        messageSnapshotBounds(original.parts).after ?? null,
        files
      )
      if (!session) throw new Error('NOTHING_TO_UNDO')
      this.host.emit({ type: 'session.upsert', session })
      this.host.emit({ type: 'message.upsert', message: structuredClone(message) })
      await this.host.updateContextUsage(id)
      return { session: this.host.store.getSession(id) ?? session, prompt: '' }
    } finally {
      this.host.releaseSession(id)
    }
  }

  async redoSession(id: string): Promise<SessionMeta> {
    if (!this.host.store.get(id)) throw new Error('SESSION_NOT_FOUND')
    this.host.reserveSession(id)

    try {
      const redo = this.host.store.getRedo(id)
      if (!redo) throw new Error('NOTHING_TO_REDO')

      if (redo.snapshotAfter && redo.files.length > 0) {
        try {
          await this.host.snapshots.restorePaths(redo.snapshotAfter, redo.files)
        } catch {
          throw new Error('SNAPSHOT_RESTORE_FAILED')
        }
      }

      const session = await this.host.store.redo(id)
      if (!session) throw new Error('NOTHING_TO_REDO')
      if (redo.target) {
        const restored = this.host.store.get(id)?.messages[redo.target.index]
        if (restored) {
          this.host.emit({ type: 'message.upsert', message: structuredClone(restored) })
        }
      }
      this.host.emit({ type: 'session.upsert', session })
      await this.host.updateContextUsage(id)
      return this.host.store.getSession(id) ?? session
    } finally {
      this.host.releaseSession(id)
    }
  }

  async messageChanges(sessionId: string, messageId?: string): Promise<TurnChanges> {
    const record = this.host.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    const message = messageId
      ? record.messages.find((entry) => entry.id === messageId && entry.role === 'assistant')
      : latestSnapshotMessage(record.messages)
    if (!message) throw new Error(messageId ? 'MESSAGE_NOT_FOUND' : 'NO_CHANGES')
    return buildTurnChanges(
      this.turnChangesHost,
      record,
      message,
      this.host.store.getRevert(sessionId)
    )
  }

  async sessionChanges(sessionId: string): Promise<SessionChangesSummary> {
    const record = this.host.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    return buildSessionChanges(this.turnChangesHost, record)
  }

  async vcsStatus(sessionId: string): Promise<VcsStatus> {
    if (!this.host.store.getSession(sessionId)) throw new Error('SESSION_NOT_FOUND')
    return this.host.vcs(this.host.sessionWorkspace(sessionId)).status()
  }

  async vcsDiff(sessionId: string, options: VcsDiffOptions = {}): Promise<VcsDiffResult> {
    if (!this.host.store.getSession(sessionId)) throw new Error('SESSION_NOT_FOUND')
    return this.host.vcs(this.host.sessionWorkspace(sessionId)).diff(options)
  }

  async revertChangedFiles(
    sessionId: string,
    messageId: string,
    paths: string[] = []
  ): Promise<TurnChanges> {
    const record = this.host.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    if (this.host.sessionBusy(sessionId)) throw new Error('SESSION_BUSY')
    const message = record.messages.find(
      (entry) => entry.id === messageId && entry.role === 'assistant'
    )
    if (!message) throw new Error('MESSAGE_NOT_FOUND')
    const latest = latestSnapshotMessage(record.messages)
    if (latest?.id !== message.id) throw new Error('TURN_NOT_LATEST')
    if (message.status === 'streaming') throw new Error('SESSION_BUSY')
    const before = messageSnapshotBounds(message.parts).before
    if (!before) throw new Error('NO_SNAPSHOT')

    const allowed = await allowedChangePaths(this.turnChangesHost, message)
    const targets = paths.length > 0 ? [...new Set(paths)] : [...allowed]
    for (const target of targets) {
      if (!allowed.has(target)) throw new Error('INVALID_CHANGE_PATH')
    }
    if (targets.length > 0) {
      this.host.reserveSession(sessionId)
      try {
        const existing = this.host.store.getRevert(sessionId)
        let snapshot = existing?.messageId === message.id ? existing.snapshot : undefined
        if (!snapshot) {
          snapshot = await this.host.createRevertSnapshot(
            sessionId,
            this.host.sessionWorkspace(sessionId)
          )
        }
        try {
          await this.host.snapshots.restorePaths(before, targets)
        } catch {
          throw new Error('SNAPSHOT_RESTORE_FAILED')
        }
        const files = [
          ...new Set([...(existing?.messageId === message.id ? existing.files : []), ...targets])
        ]
        await this.host.store.setRevert(sessionId, { snapshot, messageId: message.id, files })
      } finally {
        this.host.releaseSession(sessionId)
      }
    }

    return buildTurnChanges(
      this.turnChangesHost,
      record,
      message,
      this.host.store.getRevert(sessionId)
    )
  }

  async unrevertChangedFiles(sessionId: string, paths: string[] = []): Promise<TurnChanges> {
    const record = this.host.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    if (this.host.sessionBusy(sessionId)) throw new Error('SESSION_BUSY')
    const revert = this.host.store.getRevert(sessionId)
    if (!revert) throw new Error('NOTHING_TO_UNREVERT')
    const message = record.messages.find((entry) => entry.id === revert.messageId)
    if (!message) throw new Error('MESSAGE_NOT_FOUND')
    if (message.status === 'streaming') throw new Error('SESSION_BUSY')

    const targets = paths.length > 0 ? [...new Set(paths)] : [...revert.files]
    if (targets.length === 0) throw new Error('NOTHING_TO_UNREVERT')
    for (const target of targets) {
      if (!revert.files.includes(target)) throw new Error('INVALID_CHANGE_PATH')
    }

    this.host.reserveSession(sessionId)
    try {
      await this.host.snapshots.restorePaths(revert.snapshot, targets)
    } catch {
      throw new Error('SNAPSHOT_RESTORE_FAILED')
    } finally {
      this.host.releaseSession(sessionId)
    }

    const remaining = revert.files.filter((file) => !targets.includes(file))
    if (remaining.length === 0) await this.host.store.clearRevert(sessionId)
    else await this.host.store.setRevert(sessionId, { ...revert, files: remaining })
    return buildTurnChanges(
      this.turnChangesHost,
      record,
      message,
      this.host.store.getRevert(sessionId)
    )
  }

  private get turnChangesHost(): TurnChangesHost {
    return {
      snapshots: this.host.snapshots,
      sessionBusy: (sessionId) => this.host.sessionBusy(sessionId)
    }
  }
}
