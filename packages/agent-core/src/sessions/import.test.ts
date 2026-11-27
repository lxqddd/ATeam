import { describe, expect, it } from 'vitest'
import {
  SESSION_EXPORT_KIND,
  SESSION_EXPORT_SCHEMA_VERSION,
  type ChatMessage,
  type SessionExportEntry,
  type SessionMeta
} from '@ateam/shared'
import {
  makeMessage,
  makeSession,
  makeTextPart,
  makeToolPart,
  type ToolPart
} from '../test/factories'
import { buildSessionExport, SESSION_EXPORT_ATTACHMENT_PLACEHOLDER } from './export'
import { prepareSessionImport } from './import'
import type { SessionRecord } from './storage'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeEntry(
  session: Partial<SessionMeta> = {},
  messages: ChatMessage[] = []
): SessionExportEntry {
  return { session: makeSession({ id: 'old-session', title: 'Old', ...session }), messages }
}

function makeDocument(
  entries: SessionExportEntry[],
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    kind: SESSION_EXPORT_KIND,
    schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
    exportedAt: '2026-11-27T00:00:00.000Z',
    appVersion: '0.0.0',
    redactedPaths: true,
    attachmentsIncluded: false,
    snapshotsIncluded: false,
    sessions: entries,
    ...overrides
  })
}

describe('prepareSessionImport', () => {
  it('remaps session, message and tool call ids', () => {
    const entry = makeEntry({}, [
      makeMessage({
        id: 'old-message',
        parts: [makeTextPart('hello'), makeToolPart({ toolCallId: 'old-call' })]
      })
    ])
    const [record] = prepareSessionImport(makeDocument([entry]))

    expect(record.session.id).toMatch(UUID)
    expect(record.session.id).not.toBe('old-session')
    expect(record.messages).toHaveLength(1)

    const [message] = record.messages
    expect(message.id).toMatch(UUID)
    expect(message.id).not.toBe('old-message')
    expect(message.sessionId).toBe(record.session.id)

    const tool = message.parts.find((part): part is ToolPart => part.type === 'tool')
    expect(tool?.toolCallId).toMatch(UUID)
    expect(tool?.toolCallId).not.toBe('old-call')
  })

  it('drops snapshot bookkeeping and re-ids attachments', () => {
    const entry = makeEntry({}, [
      makeMessage({
        id: 'm1',
        parts: [
          { type: 'snapshot', snapshot: 'snap-1' },
          { type: 'step-start', step: 0 },
          makeTextPart('body'),
          {
            type: 'attachment',
            attachment: {
              id: 'old-attachment',
              name: 'notes.txt',
              mimeType: 'text/plain',
              size: 12,
              kind: 'text',
              path: '/Users/alice/notes.txt'
            }
          }
        ]
      })
    ])
    const [record] = prepareSessionImport(makeDocument([entry]))
    const parts = record.messages[0].parts
    expect(parts.map((part) => part.type)).toEqual(['text', 'attachment'])

    const attachment = parts[1]
    if (attachment.type !== 'attachment') throw new Error('expected an attachment part')
    expect(attachment.attachment.id).toMatch(UUID)
    expect(attachment.attachment.id).not.toBe('old-attachment')
    expect(attachment.attachment.path).toBe(SESSION_EXPORT_ATTACHMENT_PLACEHOLDER)
  })

  it('keeps parent/child links on the new session ids', () => {
    const parent = makeEntry({ id: 'parent-old', title: 'Parent' })
    const child = makeEntry({
      id: 'child-old',
      title: 'Child',
      parentId: 'parent-old',
      hidden: true
    })
    const [importedParent, importedChild] = prepareSessionImport(makeDocument([parent, child]))

    expect(importedChild.session.parentId).toBe(importedParent.session.id)
    expect(importedChild.session.parentId).not.toBe('parent-old')
    expect(importedChild.session.hidden).toBe(true)
  })

  it('promotes an orphaned subagent session to a visible top-level session', () => {
    const entry = makeEntry({ parentId: 'missing-parent', hidden: true })
    const [record] = prepareSessionImport(makeDocument([entry]))

    expect(record.session.parentId).toBeNull()
    expect(record.session.hidden).toBe(false)
  })

  it('produces independent copies when the same file is imported twice', () => {
    const content = makeDocument([
      makeEntry({}, [makeMessage({ id: 'm1', parts: [makeTextPart('hi')] })])
    ])
    const first = prepareSessionImport(content)
    const second = prepareSessionImport(content)

    expect(first[0].session.id).not.toBe(second[0].session.id)
    expect(first[0].messages[0].id).not.toBe(second[0].messages[0].id)
  })

  it('remaps the compaction anchor to the new message id', () => {
    const entry = makeEntry(
      {
        compaction: {
          summary: 'summary',
          throughMessageId: 'old-message',
          createdAt: '2026-11-27T00:00:00.000Z',
          tokensBefore: 1000,
          tokensAfter: 100
        }
      },
      [makeMessage({ id: 'old-message', parts: [makeTextPart('hi')] })]
    )
    const [record] = prepareSessionImport(makeDocument([entry]))

    expect(record.session.compaction?.throughMessageId).toBe(record.messages[0].id)
    expect(record.session.compaction?.throughMessageId).not.toBe('old-message')
  })

  it('drops a compaction anchor that is not part of the file', () => {
    const entry = makeEntry({
      compaction: {
        summary: 'summary',
        throughMessageId: 'missing-message',
        createdAt: '2026-11-27T00:00:00.000Z',
        tokensBefore: 1000,
        tokensAfter: 100
      }
    })
    const [record] = prepareSessionImport(makeDocument([entry]))

    expect(record.session.compaction).toBeNull()
  })

  it('normalizes interrupted run state into an idle copy', () => {
    const entry = makeEntry({ status: 'waiting-permission', redoAvailable: true }, [
      makeMessage({
        id: 'm1',
        status: 'streaming',
        parts: [makeToolPart({ toolCallId: 'call-1', state: 'awaiting-approval' })]
      })
    ])
    const [record] = prepareSessionImport(makeDocument([entry]))

    expect(record.session.status).toBe('idle')
    expect(record.session.redoAvailable).toBe(false)
    expect(record.messages[0].status).toBe('interrupted')

    const tool = record.messages[0].parts.find((part): part is ToolPart => part.type === 'tool')
    expect(tool?.state).toBe('failed')
    expect(tool?.error).toBe('Interrupted by import')
    expect(tool?.finishedAt).toBeTruthy()
  })

  it('keeps a resolvable model reference and directory', () => {
    const entry = makeEntry({
      model: { providerId: 'provider', modelId: 'model', variant: null },
      directory: '/tmp/project'
    })
    const [record] = prepareSessionImport(makeDocument([entry]))

    expect(record.session.model).toEqual({
      providerId: 'provider',
      modelId: 'model',
      variant: null
    })
    expect(record.session.directory).toBe('/tmp/project')
  })

  it('rebuilds todos without reusing exported ids', () => {
    const entry = makeEntry({
      todos: [{ id: 'old-todo', content: 'Ship it', status: 'pending', priority: 'medium' }]
    })
    const [record] = prepareSessionImport(makeDocument([entry]))

    expect(record.session.todos).toHaveLength(1)
    expect(record.session.todos[0].content).toBe('Ship it')
    expect(record.session.todos[0].id).not.toBe('old-todo')
  })

  it('round-trips a record through the JSONL and Markdown export formats', () => {
    const record: SessionRecord = {
      session: makeSession({ id: 'session-a', title: 'Hello' }),
      messages: [makeMessage({ sessionId: 'session-a', parts: [makeTextPart('hi')] })]
    }

    for (const format of ['jsonl', 'markdown'] as const) {
      const payload = buildSessionExport([record], { format, appVersion: '1.0.0' })
      const [imported] = prepareSessionImport(payload.content)

      expect(imported.session.id).toMatch(UUID)
      expect(imported.session.id).not.toBe('session-a')
      expect(imported.messages[0].parts).toEqual([{ type: 'text', text: 'hi' }])
    }
  })
})

describe('prepareSessionImport rejection', () => {
  it('rejects an empty file', () => {
    expect(() => prepareSessionImport('   ')).toThrow('EXPORT_EMPTY')
  })

  it('rejects plain text that is not an export', () => {
    expect(() => prepareSessionImport('# just a note')).toThrow('EXPORT_UNRECOGNIZED_FORMAT')
  })

  it('rejects an unknown document kind', () => {
    expect(() => prepareSessionImport(makeDocument([], { kind: 'other' }))).toThrow(
      'EXPORT_INVALID_DOCUMENT'
    )
  })

  it('rejects schema version 0', () => {
    expect(() => prepareSessionImport(makeDocument([], { schemaVersion: 0 }))).toThrow(
      'EXPORT_INVALID_SCHEMA_VERSION'
    )
  })

  it('rejects a newer schema version', () => {
    expect(() =>
      prepareSessionImport(makeDocument([], { schemaVersion: SESSION_EXPORT_SCHEMA_VERSION + 1 }))
    ).toThrow('EXPORT_NEWER_SCHEMA_VERSION')
  })

  it('rejects an export that repeats a session id', () => {
    const entries = [makeEntry({ id: 'dup' }), makeEntry({ id: 'dup' })]
    expect(() => prepareSessionImport(makeDocument(entries))).toThrow('EXPORT_INVALID_SESSION')
  })

  it('rejects an unknown message role', () => {
    const entry = makeEntry({}, [
      makeMessage({ role: 'system' as never, parts: [makeTextPart('hi')] })
    ])
    expect(() => prepareSessionImport(makeDocument([entry]))).toThrow('EXPORT_INVALID_MESSAGE')
  })

  it('rejects an unknown part type', () => {
    const entry = makeEntry({}, [makeMessage({ parts: [{ type: 'mystery' } as never] })])
    expect(() => prepareSessionImport(makeDocument([entry]))).toThrow('EXPORT_INVALID_MESSAGE')
  })

  it('rejects an invalid tool state', () => {
    const entry = makeEntry({}, [
      makeMessage({ parts: [makeToolPart({ state: 'bogus' as never })] })
    ])
    expect(() => prepareSessionImport(makeDocument([entry]))).toThrow('EXPORT_INVALID_MESSAGE')
  })

  it('rejects a message whose parts are not an array', () => {
    const entry = makeEntry({}, [makeMessage({ parts: 'oops' as never })])
    expect(() => prepareSessionImport(makeDocument([entry]))).toThrow('EXPORT_INVALID_MESSAGE')
  })
})
