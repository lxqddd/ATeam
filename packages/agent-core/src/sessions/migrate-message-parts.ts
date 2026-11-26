import type { ChatMessage, MessagePart } from '@ateam/shared'
import { isMetadataPart, messageOpenStep } from '@ateam/shared'
import type { SessionRecord } from './storage/types'

/** Snapshot step written by runtimes before message parts carried steps. */
interface LegacySnapshotStep {
  before: string
  after: string
  files: string[]
  partIndex?: number
}

/** Snapshot bookkeeping written by runtimes before message parts carried steps. */
interface LegacySnapshotFields {
  snapshotBefore?: string
  snapshotAfter?: string
  snapshotSteps?: LegacySnapshotStep[]
  changedFiles?: string[]
}

interface LegacyStep {
  before: string
  after: string
  files: string[]
  index?: number
}

const LEGACY_KEYS = [
  'snapshotBefore',
  'snapshotAfter',
  'snapshotSteps',
  'changedFiles'
] as const satisfies ReadonlyArray<keyof LegacySnapshotFields>

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function hasLegacyFields(message: LegacyMessage): boolean {
  return LEGACY_KEYS.some((key) => key in message)
}

type LegacyMessage = ChatMessage & LegacySnapshotFields

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/**
 * Normalizes legacy step boundaries into stable, monotonic insert positions.
 * Missing indices inherit the next defined one (or the end of the parts), and
 * later values never move backwards.
 */
function normalizeLegacySteps(parts: MessagePart[], steps: LegacyStep[]): LegacyStep[] {
  const total = parts.length
  const ordered = steps
    .map((step, order) => ({ step, order }))
    .sort((left, right) => {
      const leftIndex = left.step.index ?? Number.POSITIVE_INFINITY
      const rightIndex = right.step.index ?? Number.POSITIVE_INFINITY
      return leftIndex - rightIndex || left.order - right.order
    })
    .map((entry) => entry.step)

  let next = total
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const step = ordered[index]
    step.index = step.index === undefined ? next : clamp(step.index, 0, total)
    next = step.index
  }

  let cursor = 0
  for (const step of ordered) {
    step.index = clamp(Math.max(step.index ?? 0, cursor), 0, total)
    cursor = step.index
  }
  return ordered
}

function readLegacySteps(value: unknown): LegacyStep[] {
  if (!Array.isArray(value)) return []
  const steps: LegacyStep[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const step = entry as Partial<LegacySnapshotStep>
    if (typeof step.before !== 'string' || typeof step.after !== 'string') continue
    steps.push({
      before: step.before,
      after: step.after,
      files: stringList(step.files),
      index:
        typeof step.partIndex === 'number' && Number.isFinite(step.partIndex)
          ? step.partIndex
          : undefined
    })
  }
  return steps
}

function snapshotPart(snapshot: string, files: string[]): MessagePart {
  return files.length > 0 ? { type: 'snapshot', snapshot, files } : { type: 'snapshot', snapshot }
}

/** Weaves legacy bypass fields into snapshot / step / patch parts. */
function weaveLegacyParts(message: LegacyMessage): MessagePart[] {
  const parts = message.parts
  const steps = normalizeLegacySteps(parts, readLegacySteps(message.snapshotSteps))
  const before =
    typeof message.snapshotBefore === 'string' ? message.snapshotBefore : steps[0]?.before
  const woven: MessagePart[] = []

  if (before) woven.push({ type: 'snapshot', snapshot: before })

  let cursor = 0
  steps.forEach((step, index) => {
    const boundary = step.index ?? parts.length
    woven.push({ type: 'step-start', step: index, snapshot: step.before })
    woven.push(...parts.slice(cursor, boundary))
    cursor = boundary
    woven.push({ type: 'step-finish', step: index, snapshot: step.after })
    if (step.files.length > 0) {
      woven.push({ type: 'patch', step: index, snapshot: step.after, files: step.files })
    }
  })
  woven.push(...parts.slice(cursor))

  const after = typeof message.snapshotAfter === 'string' ? message.snapshotAfter : undefined
  if (after) {
    const files = stringList(message.changedFiles)
    const lastStep = steps[steps.length - 1]
    // The trailing snapshot only matters when it differs from the last step or
    // carries extra changed files; otherwise it would duplicate existing data.
    if (
      (lastStep && lastStep.after !== after) ||
      (!lastStep && (after !== before || files.length > 0))
    ) {
      woven.push(snapshotPart(after, files))
    }
  }
  return woven
}

function closeReason(message: ChatMessage): string {
  if (message.status === 'interrupted') return 'interrupted'
  if (message.status === 'error') return 'error'
  return 'stop'
}

/** One-time migration of a single message; idempotent and safe to retry. */
export function migrateMessageParts(message: ChatMessage): boolean {
  const legacy = message as LegacyMessage
  let changed = false

  if (hasLegacyFields(legacy)) {
    if (!message.parts.some(isMetadataPart)) {
      message.parts = weaveLegacyParts(legacy)
    }
    for (const key of LEGACY_KEYS) {
      if (key in legacy) {
        delete legacy[key]
        changed = true
      }
    }
  }

  // A crash can leave a step without its finish part. The message status is
  // already repaired by the store, so derive the terminal reason from it.
  const open = messageOpenStep(message.parts)
  if (open) {
    message.parts.push({
      type: 'step-finish',
      step: open.step,
      reason: closeReason(message),
      finishedAt: message.updatedAt
    })
    changed = true
  }
  return changed
}

/** Migrates live messages plus the messages parked in redo state. */
export function migrateRecordMessageParts(record: SessionRecord): boolean {
  let changed = false
  const migrate = (message: ChatMessage): void => {
    try {
      if (migrateMessageParts(message)) changed = true
    } catch {
      // Keep the legacy fields and retry on the next load rather than
      // blocking the whole session.
    }
  }

  for (const message of record.messages) migrate(message)
  if (record.redo) {
    for (const message of record.redo.messages) migrate(message)
    if (record.redo.target?.message) migrate(record.redo.target.message)
  }
  return changed
}
