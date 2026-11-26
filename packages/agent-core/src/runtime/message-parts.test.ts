import { describe, expect, it } from 'vitest'
import {
  isMetadataPart,
  messageChangedFiles,
  messageCheckpoint,
  messageOpenStep,
  messageSnapshotBounds,
  messageSteps,
  type MessagePart
} from '@ateam/shared'

describe('message-parts helpers', () => {
  it('groups steps and anchors boundaries on finish/patch, not the next start', () => {
    const parts: MessagePart[] = [
      { type: 'snapshot', snapshot: 's0' },
      { type: 'step-start', step: 0, snapshot: 's0' },
      { type: 'text', text: 'first' },
      { type: 'step-finish', step: 0, snapshot: 's1' },
      { type: 'patch', step: 0, snapshot: 's1', files: ['a.ts'] },
      // Step 1 content starts before its (lazily appended) start part.
      { type: 'text', text: 'second' },
      { type: 'step-start', step: 1, snapshot: 's1' },
      { type: 'step-finish', step: 1, snapshot: 's2' }
    ]

    const steps = messageSteps(parts)
    expect(steps).toHaveLength(2)
    expect(steps[0]).toMatchObject({
      step: 0,
      fromIndex: 0,
      endIndex: 5,
      before: 's0',
      after: 's1',
      files: ['a.ts']
    })
    expect(steps[1]).toMatchObject({
      step: 1,
      fromIndex: 5,
      endIndex: 8,
      before: 's1',
      after: 's2',
      files: []
    })
  })

  it('keeps an open step open until parts end', () => {
    const parts: MessagePart[] = [
      { type: 'snapshot', snapshot: 's0' },
      { type: 'step-start', step: 0, snapshot: 's0' },
      { type: 'text', text: 'working' }
    ]

    expect(messageSteps(parts)).toEqual([
      {
        step: 0,
        start: { type: 'step-start', step: 0, snapshot: 's0' },
        finish: undefined,
        patch: undefined,
        fromIndex: 0,
        endIndex: 3,
        before: 's0',
        after: undefined,
        files: []
      }
    ])
    expect(messageOpenStep(parts)).toMatchObject({ step: 0, index: 1 })
  })

  it('reports the latest unclosed step', () => {
    const parts: MessagePart[] = [
      { type: 'step-start', step: 0, snapshot: 's0' },
      { type: 'text', text: 'a' },
      { type: 'step-start', step: 1, snapshot: 's1' },
      { type: 'text', text: 'b' }
    ]

    const open = messageOpenStep(parts)
    expect(open?.step).toBe(1)
    expect(open?.index).toBe(2)
  })

  it('collects changed files from patches and terminal snapshots', () => {
    const parts: MessagePart[] = [
      { type: 'snapshot', snapshot: 's0' },
      { type: 'patch', step: 0, snapshot: 's1', files: ['a.ts', 'b.ts'] },
      { type: 'patch', step: 1, snapshot: 's2', files: ['b.ts', 'c.ts'] },
      { type: 'snapshot', snapshot: 's2', files: ['c.ts', 'd.ts'] }
    ]

    expect(messageChangedFiles(parts)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
  })

  it('derives the turn snapshot bounds and latest checkpoint', () => {
    const parts: MessagePart[] = [
      { type: 'snapshot', snapshot: 's0' },
      { type: 'step-start', step: 0, snapshot: 's0' },
      { type: 'text', text: 'a' },
      { type: 'step-finish', step: 0, snapshot: 's1' },
      { type: 'step-start', step: 1, snapshot: 's1' },
      { type: 'patch', step: 1, snapshot: 's2', files: ['a.ts'] }
    ]

    expect(messageSnapshotBounds(parts)).toEqual({ before: 's0', after: 's2' })
    expect(messageCheckpoint(parts)).toBe('s2')
  })

  it('falls back to the first step-start snapshot when no head snapshot exists', () => {
    const parts: MessagePart[] = [
      { type: 'step-start', step: 0, snapshot: 's0' },
      { type: 'step-finish', step: 0, snapshot: 's1' }
    ]

    expect(messageSnapshotBounds(parts)).toEqual({ before: 's0', after: 's1' })
    expect(messageCheckpoint(parts)).toBe('s1')
  })

  it('classifies metadata parts only', () => {
    const metadata: MessagePart[] = [
      { type: 'snapshot', snapshot: 's0' },
      { type: 'step-start', step: 0 },
      { type: 'step-finish', step: 0 },
      { type: 'patch', step: 0, snapshot: 's1', files: [] }
    ]
    expect(metadata.every((part) => isMetadataPart(part))).toBe(true)
    expect(isMetadataPart({ type: 'text', text: 'hi' })).toBe(false)
    expect(
      isMetadataPart({
        type: 'tool',
        toolCallId: 'call',
        toolName: 'read',
        state: 'completed'
      })
    ).toBe(false)
  })
})
