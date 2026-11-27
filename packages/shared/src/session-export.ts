import type { ChatMessage, SessionMeta } from './agent-types'

/** Marker written into every session export so the import flow can recognize the file. */
export const SESSION_EXPORT_KIND = 'ateam-session-export'

/** Version of the export document structure. Bump when a field's meaning changes. */
export const SESSION_EXPORT_SCHEMA_VERSION = 1

export const SESSION_EXPORT_FORMATS = ['json', 'jsonl', 'markdown'] as const

export type SessionExportFormat = (typeof SESSION_EXPORT_FORMATS)[number]

/** File extension (without the dot) used for each export format. */
export const SESSION_EXPORT_EXTENSIONS: Record<SessionExportFormat, string> = {
  json: 'json',
  jsonl: 'jsonl',
  markdown: 'md'
}

/** One exported session with its full message history. */
export interface SessionExportEntry {
  session: SessionMeta
  messages: ChatMessage[]
}

/** Fields shared by the JSON document and the JSONL header line. */
export interface SessionExportHeader {
  kind: typeof SESSION_EXPORT_KIND
  schemaVersion: number
  exportedAt: string
  /** App version that produced the export. */
  appVersion: string
  /** True when absolute paths were replaced with placeholders. */
  redactedPaths: boolean
  /** Attachment files are never embedded; metadata may still reference them. */
  attachmentsIncluded: boolean
  /** File snapshot contents are never embedded. */
  snapshotsIncluded: boolean
}

/** Machine-readable JSON export: one document holding every session. */
export interface SessionExportDocument extends SessionExportHeader {
  sessions: SessionExportEntry[]
}

/** First line of a JSONL export. */
export interface SessionExportLineHeader extends SessionExportHeader {
  type: 'header'
}

/** One line per session in a JSONL export. */
export interface SessionExportSessionLine extends SessionExportEntry {
  type: 'session'
}

/** Renderer → main request to export one session or all visible sessions. */
export interface SessionExportRequest {
  /** Target session; null or omitted exports every visible session. */
  sessionId?: string | null
  format: SessionExportFormat
  /** Replace absolute paths with placeholders; defaults to true. */
  redactPaths?: boolean
}

/** Serialized export produced by the agent worker, before it is written to disk. */
export interface SessionExportPayload {
  content: string
  /** Filename the save dialog starts from. */
  suggestedName: string
  format: SessionExportFormat
  sessionCount: number
  messageCount: number
}

/** Outcome of the main-process save flow. */
export interface SessionExportResult {
  /** False when the user cancelled the save dialog. */
  saved: boolean
  path: string | null
  sessionCount: number
  messageCount: number
}
