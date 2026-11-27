import os from 'node:os'
import type {
  ChatMessage,
  MessageAttachment,
  MessagePart,
  SessionExportDocument,
  SessionExportEntry,
  SessionExportFormat,
  SessionExportPayload,
  SessionMeta
} from '@ateam/shared'
import {
  SESSION_EXPORT_EXTENSIONS,
  SESSION_EXPORT_KIND,
  SESSION_EXPORT_SCHEMA_VERSION
} from '@ateam/shared'
import type { SessionRecord } from './storage'

/** Replacement for credential-like values. */
export const SESSION_EXPORT_REDACTED = '[REDACTED]'

/** Replacement for absolute paths when path redaction is enabled. */
export const SESSION_EXPORT_PATH_PLACEHOLDER = '<PATH>'

/** Replacement for attachment paths; attachment files are never packaged. */
export const SESSION_EXPORT_ATTACHMENT_PLACEHOLDER = '<ATTACHMENT>'

const MARKDOWN_JSON_BEGIN = '<!-- ateam-session-export:json'
const MARKDOWN_JSON_END = '-->'

/**
 * Keys whose string values are always redacted. Keys are compared after
 * lowercasing and stripping punctuation, so `apiKey`, `api_key` and `API-KEY`
 * all match. Numeric token counters (`inputTokens`, `maxTokens`) stay intact.
 */
const SENSITIVE_KEYS = new Set([
  'apikey',
  'apisecret',
  'secret',
  'secrets',
  'secretkey',
  'clientsecret',
  'password',
  'passwd',
  'authorization',
  'credentials',
  'credential',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'bearertoken',
  'sessiontoken',
  'privatekey',
  'xapikey',
  'cookie',
  'setcookie'
])

const SENSITIVE_KEY_SUFFIXES = ['password', 'apikey', 'secretkey', 'accesstoken', 'refreshtoken']

/** Well-known provider credential shapes found in free-form text. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{15,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi
]

interface RedactionContext {
  redactPaths: boolean
  homeDir: string | null
}

/**
 * Redacts credential-like keys and values in a JSON-like structure.
 *
 * Shared by the session export and the Server API resource routes. Values under
 * a credential-like key are replaced wholesale, and free-form strings lose
 * known provider token shapes.
 */
export function redactSecrets<T>(value: T): T {
  return deepRedact(value, { redactPaths: false, homeDir: null }) as T
}

/** Options for {@link buildSessionExport}. */
export interface SessionExportBuildOptions {
  format: SessionExportFormat
  appVersion: string
  /** Defaults to the current time. */
  exportedAt?: string
  /** Replace absolute paths with placeholders; defaults to true. */
  redactPaths?: boolean
  /** Home directory replaced with `~`; defaults to the current user's home. */
  homeDir?: string
}

/**
 * Serializes session records into a self-contained export payload.
 *
 * Credentials are always redacted. Attachment files, tool images and file
 * snapshot contents are never embedded; absolute paths are replaced with
 * placeholders unless `redactPaths` is false.
 */
export function buildSessionExport(
  records: readonly SessionRecord[],
  options: SessionExportBuildOptions
): SessionExportPayload {
  const exportedAt = options.exportedAt ?? new Date().toISOString()
  const redactPaths = options.redactPaths ?? true
  const context: RedactionContext = {
    redactPaths,
    homeDir: redactPaths ? (options.homeDir ?? os.homedir()) : null
  }

  const entries = records.map((record) => sanitizeSessionRecord(record, context))
  const document: SessionExportDocument = {
    kind: SESSION_EXPORT_KIND,
    schemaVersion: SESSION_EXPORT_SCHEMA_VERSION,
    exportedAt,
    appVersion: options.appVersion,
    redactedPaths: redactPaths,
    attachmentsIncluded: false,
    snapshotsIncluded: false,
    sessions: entries
  }

  const content =
    options.format === 'json'
      ? `${JSON.stringify(document, null, 2)}\n`
      : options.format === 'jsonl'
        ? serializeJsonLines(document)
        : serializeMarkdown(document)

  return {
    content,
    suggestedName: suggestedFileName(document, options.format, exportedAt),
    format: options.format,
    sessionCount: entries.length,
    messageCount: entries.reduce((sum, entry) => sum + entry.messages.length, 0)
  }
}

/**
 * Parses an export produced by {@link buildSessionExport} in any format and
 * validates its structure. Used by the import flow and by round-trip tests.
 */
export function readSessionExport(content: string): SessionExportDocument {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('EXPORT_EMPTY')

  // Use the last marker: user text in the transcript may contain the same string.
  const begin = trimmed.lastIndexOf(MARKDOWN_JSON_BEGIN)
  if (begin !== -1) {
    const end = trimmed.indexOf(MARKDOWN_JSON_END, begin + MARKDOWN_JSON_BEGIN.length)
    if (end === -1) throw new Error('EXPORT_INVALID_MARKDOWN')
    const payload = trimmed.slice(begin + MARKDOWN_JSON_BEGIN.length, end).trim()
    return validateSessionExport(parseJson(payload, 'EXPORT_INVALID_MARKDOWN'))
  }

  if (trimmed.startsWith('{')) {
    try {
      return validateSessionExport(JSON.parse(trimmed))
    } catch (error) {
      // A valid single JSON document that fails validation must not be retried as JSONL.
      if (error instanceof SyntaxError) {
        return readJsonLines(trimmed)
      }
      throw error
    }
  }

  throw new Error('EXPORT_UNRECOGNIZED_FORMAT')
}

function readJsonLines(content: string): SessionExportDocument {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) throw new Error('EXPORT_INVALID_JSONL')
  const header = parseJson(lines[0], 'EXPORT_INVALID_JSONL')
  if (!isRecord(header) || header.type !== 'header') throw new Error('EXPORT_INVALID_JSONL')

  const sessions: SessionExportEntry[] = []
  for (const line of lines.slice(1)) {
    const parsed = parseJson(line, 'EXPORT_INVALID_JSONL')
    if (!isRecord(parsed) || parsed.type !== 'session') throw new Error('EXPORT_INVALID_JSONL')
    sessions.push({
      session: parsed.session as SessionMeta,
      messages: parsed.messages as ChatMessage[]
    })
  }
  return validateSessionExport({ ...header, sessions })
}

function validateSessionExport(value: unknown): SessionExportDocument {
  if (!isRecord(value)) throw new Error('EXPORT_INVALID_DOCUMENT')
  if (value.kind !== SESSION_EXPORT_KIND) throw new Error('EXPORT_INVALID_DOCUMENT')
  const version = value.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('EXPORT_INVALID_SCHEMA_VERSION')
  }
  if (version > SESSION_EXPORT_SCHEMA_VERSION) throw new Error('EXPORT_NEWER_SCHEMA_VERSION')
  if (!Array.isArray(value.sessions)) throw new Error('EXPORT_INVALID_DOCUMENT')

  return {
    kind: SESSION_EXPORT_KIND,
    schemaVersion: version,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    appVersion: typeof value.appVersion === 'string' ? value.appVersion : '0.0.0',
    redactedPaths: value.redactedPaths !== false,
    attachmentsIncluded: value.attachmentsIncluded === true,
    snapshotsIncluded: value.snapshotsIncluded === true,
    sessions: value.sessions.map((entry) => validateEntry(entry))
  }
}

function validateEntry(value: unknown): SessionExportEntry {
  if (!isRecord(value)) throw new Error('EXPORT_INVALID_SESSION')
  const session = value.session
  if (!isRecord(session) || typeof session.id !== 'string' || session.id.length === 0) {
    throw new Error('EXPORT_INVALID_SESSION')
  }
  if (typeof session.title !== 'string') throw new Error('EXPORT_INVALID_SESSION')
  if (!Array.isArray(value.messages)) throw new Error('EXPORT_INVALID_SESSION')
  for (const message of value.messages) {
    if (
      !isRecord(message) ||
      typeof message.id !== 'string' ||
      typeof message.role !== 'string' ||
      !Array.isArray(message.parts)
    ) {
      throw new Error('EXPORT_INVALID_MESSAGE')
    }
  }
  return { session: session as unknown as SessionMeta, messages: value.messages as ChatMessage[] }
}

function sanitizeSessionRecord(
  record: SessionRecord,
  context: RedactionContext
): SessionExportEntry {
  const session = deepRedact(structuredClone(record.session), context) as unknown as SessionMeta
  // A persisted run state cannot resume after import; normalize it the same way
  // the store repairs interrupted runs on startup.
  if (session.status === 'running' || session.status === 'waiting-permission') {
    session.status = 'idle'
  }
  const messages = (record.messages ?? []).map((message) => sanitizeMessage(message, context))
  return { session, messages }
}

function sanitizeMessage(message: ChatMessage, context: RedactionContext): ChatMessage {
  const { parts, ...rest } = structuredClone(message)
  const sanitized = deepRedact(rest, context) as unknown as Omit<ChatMessage, 'parts'>
  if (sanitized.status === 'streaming') sanitized.status = 'interrupted'
  return { ...sanitized, parts: parts.map((part) => sanitizePart(part, context)) }
}

function sanitizePart(part: MessagePart, context: RedactionContext): MessagePart {
  if (part.type === 'attachment') {
    const attachment: MessageAttachment = {
      ...part.attachment,
      path: SESSION_EXPORT_ATTACHMENT_PLACEHOLDER
    }
    return {
      type: 'attachment',
      attachment: deepRedact(attachment, context) as unknown as MessageAttachment
    }
  }
  if (part.type === 'tool') {
    const { images, ...rest } = structuredClone(part)
    const sanitized = deepRedact(rest, context) as unknown as Omit<
      Extract<MessagePart, { type: 'tool' }>,
      'images'
    >
    // Base64 tool images are attachment data; keep only their count.
    return images && images.length > 0 ? { ...sanitized, imagesOmitted: images.length } : sanitized
  }
  return deepRedact(structuredClone(part), context) as unknown as MessagePart
}

function deepRedact(value: unknown, context: RedactionContext, key?: string): unknown {
  if (typeof value === 'string') {
    if (key && isSensitiveKey(key)) return SESSION_EXPORT_REDACTED
    return redactText(value, context)
  }
  if (key && isSensitiveKey(key) && Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'string' ? SESSION_EXPORT_REDACTED : deepRedact(item, context)
    )
  }
  if (Array.isArray(value)) return value.map((item) => deepRedact(item, context))
  if (isRecord(value)) {
    const result: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = deepRedact(childValue, context, childKey)
    }
    return result
  }
  return value
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!normalized) return false
  if (SENSITIVE_KEYS.has(normalized)) return true
  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

function redactText(text: string, context: RedactionContext): string {
  let result = text
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, SESSION_EXPORT_REDACTED)
  if (context.redactPaths) result = redactAbsolutePaths(result, context.homeDir)
  return result
}

function redactAbsolutePaths(text: string, homeDir: string | null): string {
  let result = text
  if (homeDir) result = result.split(homeDir).join('~')
  result = result.replace(
    /\b[A-Za-z]:\\(?:[^\\\s"'`<>|*]+\\)*[^\\\s"'`<>|*]*/g,
    SESSION_EXPORT_PATH_PLACEHOLDER
  )
  result = result.replace(
    /(?<![\w:/.~-])\/(?:[^/\s"'`<>()[\]{}|*]+\/)*[^/\s"'`<>()[\]{}|*]+/g,
    SESSION_EXPORT_PATH_PLACEHOLDER
  )
  return result
}

function serializeJsonLines(document: SessionExportDocument): string {
  const header = {
    type: 'header' as const,
    kind: document.kind,
    schemaVersion: document.schemaVersion,
    exportedAt: document.exportedAt,
    appVersion: document.appVersion,
    redactedPaths: document.redactedPaths,
    attachmentsIncluded: document.attachmentsIncluded,
    snapshotsIncluded: document.snapshotsIncluded
  }
  const lines = [JSON.stringify(header)]
  for (const entry of document.sessions) {
    lines.push(
      JSON.stringify({ type: 'session', session: entry.session, messages: entry.messages })
    )
  }
  return `${lines.join('\n')}\n`
}

function serializeMarkdown(document: SessionExportDocument): string {
  const lines: string[] = [
    '---',
    `kind: ${document.kind}`,
    `schemaVersion: ${document.schemaVersion}`,
    `exportedAt: ${document.exportedAt}`,
    `appVersion: ${document.appVersion}`,
    `sessions: ${document.sessions.length}`,
    `redactedPaths: ${document.redactedPaths}`,
    `attachmentsIncluded: ${document.attachmentsIncluded}`,
    `snapshotsIncluded: ${document.snapshotsIncluded}`,
    '---',
    '',
    '# ATeam 会话导出',
    '',
    `> 导出时间 ${document.exportedAt} · schema v${document.schemaVersion} · 附件与文件快照未打包 · 凭据已脱敏。`,
    ''
  ]

  document.sessions.forEach((entry, index) => renderSessionMarkdown(lines, entry, index + 1))

  // Machine-readable mirror so the Markdown export can be re-imported. `<` and
  // `>` are escaped so the JSON cannot terminate the surrounding HTML comment.
  const embedded = JSON.stringify(document).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  lines.push(MARKDOWN_JSON_BEGIN, embedded, MARKDOWN_JSON_END, '')
  return lines.join('\n')
}

function renderSessionMarkdown(lines: string[], entry: SessionExportEntry, index: number): void {
  const { session, messages } = entry
  lines.push(`## ${index}. ${session.title || session.id}`, '')
  lines.push(`- 会话 ID：\`${session.id}\``)
  lines.push(`- 创建时间：${session.createdAt}`)
  lines.push(`- 更新时间：${session.updatedAt}`)
  if (session.model) {
    const variant = session.model.variant ? ` · ${session.model.variant}` : ''
    lines.push(`- 模型：\`${session.model.providerId}/${session.model.modelId}\`${variant}`)
  }
  if (session.directory) lines.push(`- 工作目录：\`${session.directory}\``)
  if (session.agent) lines.push(`- Agent：\`${session.agent}\``)
  lines.push('')

  if (messages.length === 0) {
    lines.push('_（该会话没有消息）_', '')
    return
  }

  for (const message of messages) {
    const role = message.role === 'user' ? '用户' : '助手'
    const status =
      message.status === 'interrupted' ? ' · 已中断' : message.status === 'error' ? ' · 出错' : ''
    lines.push(`### ${role} · ${message.createdAt}${status}`, '')
    if (message.parts.length === 0) lines.push('_（消息无内容）_', '')
    for (const part of message.parts) renderPartMarkdown(lines, part)
  }
}

function renderPartMarkdown(lines: string[], part: MessagePart): void {
  if (part.type === 'text') {
    if (part.text.trim()) lines.push(part.text.trim(), '')
    return
  }
  if (part.type === 'reasoning') {
    if (!part.text.trim()) return
    lines.push(
      '<details>',
      '<summary>思考过程</summary>',
      '',
      part.text.trim(),
      '',
      '</details>',
      ''
    )
    return
  }
  if (part.type === 'attachment') {
    const attachment = part.attachment
    lines.push(
      `> 附件 \`${attachment.name}\`（${attachment.mimeType}）未打包，导出文件中不包含附件内容。`,
      ''
    )
    return
  }
  if (part.type === 'tool') {
    lines.push(`#### 工具调用 \`${part.toolName}\` · ${part.state}`, '')
    if (part.input !== undefined) {
      lines.push('输入：', '', ...fenced(jsonText(part.input), 'json'), '')
    }
    if (part.output) lines.push('输出：', '', ...fenced(part.output, 'text'), '')
    if (part.error) lines.push(`错误：${part.error}`, '')
    if (part.imagesOmitted) lines.push(`> 已省略 ${part.imagesOmitted} 张工具图片。`, '')
    return
  }
  // Snapshot/step bookkeeping parts carry no user-visible transcript content.
}

function fenced(content: string, language: string): string[] {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(content) + 1))
  return [`${fence}${language}`, content, fence]
}

function longestBacktickRun(content: string): number {
  let longest = 0
  for (const match of content.match(/`+/g) ?? []) longest = Math.max(longest, match.length)
  return longest
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function suggestedFileName(
  document: SessionExportDocument,
  format: SessionExportFormat,
  exportedAt: string
): string {
  const extension = SESSION_EXPORT_EXTENSIONS[format]
  const stamp = compactTimestamp(exportedAt)
  const single = document.sessions.length === 1 ? document.sessions[0] : null
  const base = single
    ? `ateam-session-${slugify(single.session.title || single.session.id)}`
    : 'ateam-sessions'
  return `${base}-${stamp}.${extension}`
}

function compactTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'export'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  ].join('-')
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40)
  return slug || 'session'
}

function parseJson(text: string, errorCode: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(errorCode)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
