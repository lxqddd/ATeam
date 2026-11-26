import { describe, expect, it } from 'vitest'
import type { ChatMessage, MessagePart } from '@ateam/shared'
import { migrateMessageParts, migrateRecordMessageParts } from './migrate-message-parts'
import type { SessionRecord } from './storage/types'
import { makeMessage, makeSession, makeTextPart } from '../test/factories'

function types(parts: MessagePart[]): string[] {
  return parts.map((part) => part.type)
}

interface LegacyOverrides extends Partial<ChatMessage> {
  snapshotBefore?: string
  snapshotAfter?: string
  snapshotSteps?: Array<{ before: string; after: string; files: string[]; partIndex?: number }>
  changedFiles?: string[]
}

function legacyMessage(overrides: LegacyOverrides = {}): ChatMessage {
  return makeMessage({ role: 'assistant', status: 'complete', ...overrides })
}

describe('migrateMessageParts', () => {
  it('weaves legacy steps into snapshot, step and patch parts', () => {
    const message = legacyMessage({
      parts: [makeTextPart('one'), makeTextPart('two'), makeTextPart('three')],
      snapshotBefore: 's0',
      snapshotAfter: 's2',
      snapshotSteps: [
        { before: 's0', after: 's1', files: ['a.ts'], partIndex: 2 },
        { before: 's1', after: 's2', files: ['b.ts'], partIndex: 3 }
      ],
      changedFiles: ['a.ts', 'b.ts']
    })

    expect(migrateMessageParts(message)).toBe(true)
    expect(types(message.parts)).toEqual([
      'snapshot',
      'step-start',
      'text',
      'text',
      'step-finish',
      'patch',
      'step-start',
      'text',
      'step-finish',
      'patch'
    ])
    expect(message.parts[0]).toEqual({ type: 'snapshot', snapshot: 's0' })
    expect(message.parts[5]).toEqual({
      type: 'patch',
      step: 0,
      snapshot: 's1',
      files: ['a.ts']
    })
    expect(message.parts[9]).toEqual({
      type: 'patch',
      step: 1,
      snapshot: 's2',
      files: ['b.ts']
    })
    expect('snapshotBefore' in message).toBe(false)
    expect('snapshotSteps' in message).toBe(false)
    expect('changedFiles' in message).toBe(false)
  })

  it('sorts by boundary, fills missing indices and keeps them monotonic', () => {
    const message = legacyMessage({
      parts: [makeTextPart('a'), makeTextPart('b'), makeTextPart('c'), makeTextPart('d')],
      snapshotBefore: 's0',
      snapshotSteps: [
        { before: 's0', after: 's1', files: [] },
        { before: 's1', after: 's2', files: [], partIndex: 2 }
      ]
    })

    migrateMessageParts(message)
    expect(types(message.parts)).toEqual([
      'snapshot',
      'step-start',
      'text',
      'text',
      'step-finish',
      'step-start',
      'text',
      'text',
      'step-finish'
    ])
    expect(message.parts[5]).toMatchObject({ type: 'step-start', step: 1, snapshot: 's0' })
  })

  it('keeps a step-less turn as head and tail snapshots', () => {
    const message = legacyMessage({
      parts: [makeTextPart('done')],
      snapshotBefore: 's0',
      snapshotAfter: 's1',
      changedFiles: ['x.ts']
    })

    migrateMessageParts(message)
    expect(message.parts).toEqual([
      { type: 'snapshot', snapshot: 's0' },
      { type: 'text', text: 'done' },
      { type: 'snapshot', snapshot: 's1', files: ['x.ts'] }
    ])
  })

  it('drops an orphan snapshot without changes', () => {
    const message = legacyMessage({
      parts: [makeTextPart('done')],
      snapshotBefore: 's0',
      snapshotAfter: 's0'
    })

    migrateMessageParts(message)
    expect(types(message.parts)).toEqual(['snapshot', 'text'])
  })

  it('only clears legacy fields when parts already carry metadata', () => {
    const parts: MessagePart[] = [
      { type: 'snapshot', snapshot: 's0' },
      { type: 'step-start', step: 0, snapshot: 's0' },
      { type: 'text', text: 'hi' },
      { type: 'step-finish', step: 0, snapshot: 's1' }
    ]
    const message = legacyMessage({
      parts,
      snapshotBefore: 'old',
      snapshotSteps: [{ before: 'old', after: 'older', files: [] }]
    })

    expect(migrateMessageParts(message)).toBe(true)
    expect(message.parts).toHaveLength(4)
    expect('snapshotBefore' in message).toBe(false)
    expect('snapshotSteps' in message).toBe(false)
  })

  it('is idempotent', () => {
    const message = legacyMessage({
      parts: [makeTextPart('done')],
      snapshotBefore: 's0',
      snapshotAfter: 's1'
    })

    expect(migrateMessageParts(message)).toBe(true)
    const snapshot = JSON.stringify(message)
    expect(migrateMessageParts(message)).toBe(false)
    expect(JSON.stringify(message)).toBe(snapshot)
  })

  it('closes an interrupted open step with a derived reason', () => {
    const message = legacyMessage({
      status: 'interrupted',
      parts: [
        { type: 'snapshot', snapshot: 's0' },
        { type: 'step-start', step: 0, snapshot: 's0' },
        { type: 'text', text: 'partial' }
      ]
    })

    expect(migrateMessageParts(message)).toBe(true)
    expect(message.parts.at(-1)).toEqual({
      type: 'step-finish',
      step: 0,
      reason: 'interrupted',
      finishedAt: message.updatedAt
    })
    expect(migrateMessageParts(message)).toBe(false)
  })

  it('migrates redo messages and the redo target', () => {
    const redoMessage = legacyMessage({
      id: 'redo-1',
      parts: [makeTextPart('redo')],
      snapshotBefore: 'r0',
      snapshotAfter: 'r1'
    })
    const targetMessage = legacyMessage({
      id: 'target-1',
      parts: [makeTextPart('target')],
      snapshotBefore: 't0',
      snapshotAfter: 't1'
    })
    const record: SessionRecord = {
      session: makeSession(),
      messages: [],
      redo: {
        messages: [redoMessage],
        snapshotAfter: 'r1',
        files: [],
        prompt: '',
        target: { index: 0, message: targetMessage }
      }
    }

    expect(migrateRecordMessageParts(record)).toBe(true)
    expect(types(redoMessage.parts)).toEqual(['snapshot', 'text', 'snapshot'])
    expect(types(targetMessage.parts)).toEqual(['snapshot', 'text', 'snapshot'])
    expect('snapshotBefore' in (record.redo?.messages[0] ?? {})).toBe(false)
  })
})
