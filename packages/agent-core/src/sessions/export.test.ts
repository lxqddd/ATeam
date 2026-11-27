import { describe, expect, it } from 'vitest'
import {
  SESSION_EXPORT_SCHEMA_VERSION,
  type SessionExportDocument,
  type SessionExportFormat
} from '@ateam/shared'
import { makeMessage, makeSession, makeTextPart, makeToolPart } from '../test/factories'
import {
  buildSessionExport,
  readSessionExport,
  SESSION_EXPORT_ATTACHMENT_PLACEHOLDER,
  SESSION_EXPORT_PATH_PLACEHOLDER,
  SESSION_EXPORT_REDACTED
} from './export'
import type { SessionRecord } from './storage'

const EXPORTED_AT = '2026-11-27T03:15:00.000Z'
const HOME = '/Users/alice'

function buildOptions(
  format: SessionExportFormat,
  redactPaths = true
): Parameters<typeof buildSessionExport>[1] {
  return {
    format,
    appVersion: '9.9.9',
    exportedAt: EXPORTED_AT,
    redactPaths,
    homeDir: HOME
  }
}

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    session: makeSession({ id: 'session-a', title: 'Hello world' }),
    messages: [],
    ...overrides
  }
}

function makeSecretRecord(): SessionRecord {
  return {
    session: makeSession({
      id: 'session-secret',
      title: 'Debug /Users/alice/proj',
      directory: '/Users/alice/proj',
      status: 'running'
    }),
    messages: [
      makeMessage({
        id: 'message-1',
        sessionId: 'session-secret',
        role: 'user',
        status: 'streaming',
        parts: [
          makeTextPart(
            'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 and Bearer abcdefghijklmnop'
          ),
          makeToolPart({
            toolName: 'read',
            input: {
              apiKey: 'plain-secret',
              path: '/Users/alice/proj/src/app.ts',
              note: 'not a secret'
            },
            output: 'opened /etc/hosts with token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
            images: [{ mimeType: 'image/png', data: 'AAAA' }]
          })
        ]
      }),
      makeMessage({
        id: 'message-2',
        sessionId: 'session-secret',
        usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 40 }
      })
    ]
  }
}

describe('buildSessionExport', () => {
  it('writes a versioned JSON document with the header fields', () => {
    const payload = buildSessionExport([makeRecord()], buildOptions('json'))
    const document = JSON.parse(payload.content) as SessionExportDocument

    expect(document.kind).toBe('ateam-session-export')
    expect(document.schemaVersion).toBe(SESSION_EXPORT_SCHEMA_VERSION)
    expect(document.exportedAt).toBe(EXPORTED_AT)
    expect(document.appVersion).toBe('9.9.9')
    expect(document.redactedPaths).toBe(true)
    expect(document.attachmentsIncluded).toBe(false)
    expect(document.snapshotsIncluded).toBe(false)
    expect(document.sessions).toHaveLength(1)
    expect(document.sessions[0].session.id).toBe('session-a')
    expect(payload.sessionCount).toBe(1)
    expect(payload.messageCount).toBe(0)
    expect(payload.suggestedName).toBe('ateam-session-Hello-world-20261127-031500.json')
  })

  it('writes JSONL with a header line and one line per session', () => {
    const payload = buildSessionExport(
      [makeRecord(), makeRecord({ session: makeSession({ id: 'session-b', title: 'Other' }) })],
      buildOptions('jsonl')
    )
    const lines = payload.content.trim().split('\n')

    expect(lines).toHaveLength(3)
    const header = JSON.parse(lines[0]) as Record<string, unknown>
    expect(header.type).toBe('header')
    expect(header.schemaVersion).toBe(SESSION_EXPORT_SCHEMA_VERSION)
    const first = JSON.parse(lines[1]) as Record<string, unknown>
    expect(first.type).toBe('session')
    expect((first.session as { id: string }).id).toBe('session-a')
    expect(payload.sessionCount).toBe(2)
    expect(payload.suggestedName).toBe('ateam-sessions-20261127-031500.jsonl')
  })

  it('writes Markdown with a versioned front matter and a readable transcript', () => {
    const record = makeRecord({
      messages: [makeMessage({ role: 'user', parts: [makeTextPart('Please fix the bug')] })]
    })
    const payload = buildSessionExport([record], buildOptions('markdown'))

    expect(payload.content).toContain(`schemaVersion: ${SESSION_EXPORT_SCHEMA_VERSION}`)
    expect(payload.content).toContain('# ATeam 会话导出')
    expect(payload.content).toContain('## 1. Hello world')
    expect(payload.content).toContain('### 用户')
    expect(payload.content).toContain('Please fix the bug')
    expect(payload.suggestedName).toBe('ateam-session-Hello-world-20261127-031500.md')
  })

  it('exports an empty session and an empty session list', () => {
    const empty = buildSessionExport([makeRecord()], buildOptions('json'))
    expect(readSessionExport(empty.content).sessions[0].messages).toEqual([])

    const none = buildSessionExport([], buildOptions('json'))
    const document = readSessionExport(none.content)
    expect(document.sessions).toEqual([])
    expect(none.messageCount).toBe(0)
    expect(none.suggestedName).toContain('ateam-sessions')
  })
})

describe('readSessionExport', () => {
  it('round-trips every format to the same document', () => {
    const records = [makeRecord(), makeSecretRecord()]
    const documents = (['json', 'jsonl', 'markdown'] as const).map((format) =>
      readSessionExport(buildSessionExport(records, buildOptions(format)).content)
    )

    expect(documents[1]).toEqual(documents[0])
    expect(documents[2]).toEqual(documents[0])
    expect(documents[0].sessions.map((entry) => entry.session.id)).toEqual([
      'session-a',
      'session-secret'
    ])
  })

  it('rejects malformed documents and unsupported schema versions', () => {
    expect(() => readSessionExport('')).toThrow('EXPORT_EMPTY')
    expect(() => readSessionExport('{"kind":"other","schemaVersion":1,"sessions":[]}')).toThrow(
      'EXPORT_INVALID_DOCUMENT'
    )
    expect(() =>
      readSessionExport('{"kind":"ateam-session-export","schemaVersion":0,"sessions":[]}')
    ).toThrow('EXPORT_INVALID_SCHEMA_VERSION')
    expect(() =>
      readSessionExport(
        `{"kind":"ateam-session-export","schemaVersion":${SESSION_EXPORT_SCHEMA_VERSION + 1},"sessions":[]}`
      )
    ).toThrow('EXPORT_NEWER_SCHEMA_VERSION')
    expect(() =>
      readSessionExport(
        '{"kind":"ateam-session-export","schemaVersion":1,"sessions":[{"session":{"id":"a","title":"t"},"messages":[{"id":"m","role":"user","parts":"nope"}]}]}'
      )
    ).toThrow('EXPORT_INVALID_MESSAGE')
    expect(() => readSessionExport('not an export')).toThrow('EXPORT_UNRECOGNIZED_FORMAT')
  })

  it('rejects Markdown with a truncated embedded payload', () => {
    const payload = buildSessionExport([makeRecord()], buildOptions('markdown'))
    const truncated = payload.content.slice(0, payload.content.lastIndexOf('-->'))

    expect(() => readSessionExport(truncated)).toThrow('EXPORT_INVALID_MARKDOWN')
  })
})

describe('session export redaction', () => {
  function exportDocument(redactPaths: boolean): SessionExportDocument {
    return readSessionExport(
      buildSessionExport([makeSecretRecord()], buildOptions('json', redactPaths)).content
    )
  }

  it('redacts credentials in keys, text, tool input and tool output', () => {
    const document = exportDocument(true)
    const [entry] = document.sessions
    const userMessage = entry.messages[0]
    const text = userMessage.parts[0]

    expect(text.type).toBe('text')
    if (text.type === 'text') {
      expect(text.text).not.toContain('sk-ant-api03')
      expect(text.text).not.toContain('Bearer abcdefghijklmnop')
      expect(text.text).toContain(SESSION_EXPORT_REDACTED)
    }

    const tool = userMessage.parts[1]
    expect(tool.type).toBe('tool')
    if (tool.type === 'tool') {
      expect(tool.input).toEqual({
        apiKey: SESSION_EXPORT_REDACTED,
        path: '~/proj/src/app.ts',
        note: 'not a secret'
      })
      expect(tool.output).toContain(SESSION_EXPORT_REDACTED)
      expect(tool.output).not.toContain('ghp_')
      expect(tool.images).toBeUndefined()
      expect(tool.imagesOmitted).toBe(1)
    }

    // Numeric token counters must survive key-based redaction.
    expect(entry.messages[1].usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 40
    })
  })

  it('replaces home directories with ~ and other absolute paths with placeholders', () => {
    const document = exportDocument(true)
    const [entry] = document.sessions

    expect(entry.session.directory).toBe('~/proj')
    expect(entry.session.title).toBe('Debug ~/proj')
    const tool = entry.messages[0].parts[1]
    if (tool.type === 'tool') expect(tool.output).toContain(SESSION_EXPORT_PATH_PLACEHOLDER)
  })

  it('keeps absolute paths when path redaction is disabled', () => {
    const document = exportDocument(false)
    const [entry] = document.sessions

    expect(entry.session.directory).toBe('/Users/alice/proj')
    const tool = entry.messages[0].parts[1]
    if (tool.type === 'tool') {
      expect(tool.input).toMatchObject({ path: '/Users/alice/proj/src/app.ts' })
      expect(tool.output).toContain('/etc/hosts')
      // Credentials are still redacted even without path redaction.
      expect(tool.input).toMatchObject({ apiKey: SESSION_EXPORT_REDACTED })
    }
  })

  it('keeps attachment metadata but removes the local path', () => {
    const record = makeRecord({
      messages: [
        makeMessage({
          parts: [
            {
              type: 'attachment',
              attachment: {
                id: 'attachment-1',
                name: 'notes.txt',
                mimeType: 'text/plain',
                size: 12,
                kind: 'text',
                path: '/Users/alice/.ateam/attachments/notes.txt'
              }
            }
          ]
        })
      ]
    })
    const document = readSessionExport(buildSessionExport([record], buildOptions('json')).content)
    const part = document.sessions[0].messages[0].parts[0]

    expect(part).toEqual({
      type: 'attachment',
      attachment: {
        id: 'attachment-1',
        name: 'notes.txt',
        mimeType: 'text/plain',
        size: 12,
        kind: 'text',
        path: SESSION_EXPORT_ATTACHMENT_PLACEHOLDER
      }
    })
  })

  it('normalizes persisted run states so an imported session starts idle', () => {
    const document = exportDocument(true)
    const [entry] = document.sessions

    expect(entry.session.status).toBe('idle')
    expect(entry.messages[0].status).toBe('interrupted')
    expect(entry.messages[1].status).toBe('complete')
  })
})
