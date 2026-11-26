import type {
  MessagePart,
  MetadataPart,
  PatchPart,
  StepFinishPart,
  StepStartPart
} from './agent-types'

/** One model step reconstructed from metadata parts in an assistant message. */
export interface MessageStep {
  step: number
  start?: StepStartPart
  finish?: StepFinishPart
  patch?: PatchPart
  /** End of the previous step's boundary; content for this step starts here. */
  fromIndex: number
  /** Index just past this step's `patch` / `step-finish`; the step's content ends here. */
  endIndex: number
  before?: string
  after?: string
  files: string[]
}

/** True for parts that only describe run bookkeeping and never render as content. */
export function isMetadataPart(part: MessagePart): part is MetadataPart {
  return (
    part.type === 'snapshot' ||
    part.type === 'step-start' ||
    part.type === 'step-finish' ||
    part.type === 'patch'
  )
}

interface StepEntry {
  step: number
  start?: { part: StepStartPart; index: number }
  finish?: { part: StepFinishPart; index: number }
  patch?: { part: PatchPart; index: number }
}

/**
 * Groups metadata parts into steps. `endIndex` comes from the step's own
 * `patch` / `step-finish` rather than the next step's `step-start`: a lazily
 * added start part is appended after the step content, so the next start can
 * sit later than the previous finish.
 */
export function messageSteps(parts: MessagePart[]): MessageStep[] {
  const entries = new Map<number, StepEntry>()
  const entryFor = (step: number): StepEntry => {
    let entry = entries.get(step)
    if (!entry) {
      entry = { step }
      entries.set(step, entry)
    }
    return entry
  }

  parts.forEach((part, index) => {
    if (part.type === 'step-start') {
      const entry = entryFor(part.step)
      if (!entry.start || index < entry.start.index) entry.start = { part, index }
    } else if (part.type === 'step-finish') {
      const entry = entryFor(part.step)
      if (!entry.finish || index > entry.finish.index) entry.finish = { part, index }
    } else if (part.type === 'patch') {
      const entry = entryFor(part.step)
      if (!entry.patch || index > entry.patch.index) entry.patch = { part, index }
    }
  })

  let cursor = 0
  return [...entries.values()]
    .sort((left, right) => left.step - right.step)
    .map((entry): MessageStep => {
      const boundaryIndex = entry.patch?.index ?? entry.finish?.index
      const endIndex = boundaryIndex === undefined ? parts.length : boundaryIndex + 1
      const step: MessageStep = {
        step: entry.step,
        start: entry.start?.part,
        finish: entry.finish?.part,
        patch: entry.patch?.part,
        fromIndex: cursor,
        endIndex,
        before: entry.start?.part.snapshot,
        after: entry.patch?.part.snapshot ?? entry.finish?.part.snapshot,
        files: entry.patch?.part.files ?? []
      }
      cursor = endIndex
      return step
    })
}

/** Snapshot paths changed during the turn, in first-seen order. */
export function messageChangedFiles(parts: MessagePart[]): string[] {
  const files: string[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    if (part.type !== 'patch' && part.type !== 'snapshot') continue
    for (const file of part.files ?? []) {
      if (seen.has(file)) continue
      seen.add(file)
      files.push(file)
    }
  }
  return files
}

/** The turn's first and last snapshot checkpoints. */
export function messageSnapshotBounds(parts: MessagePart[]): {
  before?: string
  after?: string
} {
  let before: string | undefined
  let after: string | undefined
  for (const part of parts) {
    if (part.type === 'snapshot') {
      before ??= part.snapshot
      after = part.snapshot
    } else if (part.type === 'step-start') {
      before ??= part.snapshot
    } else if ((part.type === 'step-finish' || part.type === 'patch') && part.snapshot) {
      after = part.snapshot
    }
  }
  return { before, after }
}

/** Latest snapshot checkpoint in the parts, used as the next step's `before`. */
export function messageCheckpoint(parts: MessagePart[]): string | undefined {
  let checkpoint: string | undefined
  for (const part of parts) {
    if (isMetadataPart(part) && part.snapshot) checkpoint = part.snapshot
  }
  return checkpoint
}

/** The most recent `step-start` that has no matching `step-finish`. */
export function messageOpenStep(
  parts: MessagePart[]
): { step: number; part: StepStartPart; index: number } | undefined {
  const open = new Map<number, { part: StepStartPart; index: number }>()
  parts.forEach((part, index) => {
    if (part.type === 'step-start') {
      open.set(part.step, { part, index })
    } else if (part.type === 'step-finish') {
      open.delete(part.step)
    }
  })

  let latest: { step: number; part: StepStartPart; index: number } | undefined
  for (const [step, entry] of open) {
    if (!latest || entry.index > latest.index) latest = { step, ...entry }
  }
  return latest
}
