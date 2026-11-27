import { randomUUID } from 'node:crypto'
import type {
  AttachmentKind,
  ChatMessage,
  MessageAttachment,
  MessagePart,
  ModelRef,
  SessionCompaction,
  SessionExportEntry,
  SessionMeta,
  SyntheticMessageInfo,
  TokenUsage,
  TodoItem
} from '@ateam/shared'
import { PERMISSION_MODES, REASONING_EFFORTS, isMetadataPart } from '@ateam/shared'
import { normalizeTodos, TODO_PRIORITIES, TODO_STATUSES } from '../todos'
import { readSessionExport, SESSION_EXPORT_ATTACHMENT_PLACEHOLDER } from './export'
import type { SessionRecord } from './storage'

const TOOL_STATES = [
  'pending',
  'awaiting-approval',
  'running',
  'completed',
  'failed',
  'denied'
] as const

const ATTACHMENT_KINDS: readonly AttachmentKind[] = ['text', 'image', 'pdf']

const MESSAGE_STATUSES: readonly ChatMessage['status'][] = ['complete', 'interrupted', 'error']

const BACKGROUND_STATES: readonly SyntheticMessageInfo['state'][] = [
  'completed',
  'failed',
  'cancelled'
]

/**
 * Parses an export document and rebuilds it as new session records.
 *
 * Every session, message, tool call and attachment gets a fresh id, so the same
 * file can be imported repeatedly without touching existing data. Exported
 * parent/child links are mapped onto the new session ids; a link whose parent is
 * not part of the file becomes a top-level session. Parts that point at data
 * which is never exported (snapshots, step bookkeeping) are dropped, and any
 * run state is normalized so the copy starts idle.
 */
export function prepareSessionImport(content: string): SessionRecord[] {
  const document = readSessionExport(content)

  const sessionIds = new Map<string, string>()
  for (const entry of document.sessions) {
    if (sessionIds.has(entry.session.id)) throw new Error('EXPORT_INVALID_SESSION')
    sessionIds.set(entry.session.id, randomUUID())
  }

  return document.sessions.map((entry) => importEntry(entry, sessionIds))
}

function importEntry(entry: SessionExportEntry, sessionIds: Map<string, string>): SessionRecord {
  const sessionId = sessionIds.get(entry.session.id)
  if (!sessionId) throw new Error('EXPORT_INVALID_SESSION')

  const messageIds = new Map<string, string>()
  const messages = entry.messages.map((message) => importMessage(message, sessionId, messageIds))
  return {
    session: importSessionMeta(entry.session, sessionId, messageIds, sessionIds),
    messages
  }
}

function importSessionMeta(
  meta: SessionMeta,
  id: string,
  messageIds: Map<string, string>,
  sessionIds: Map<string, string>
): SessionMeta {
  const parentId =
    typeof meta.parentId === 'string' && meta.parentId !== meta.id
      ? (sessionIds.get(meta.parentId) ?? null)
      : null

  return {
    id,
    title: typeof meta.title === 'string' ? meta.title.slice(0, 120) : '',
    createdAt: dateOrDefault(meta.createdAt),
    // Imported copies surface at the top of the session list.
    updatedAt: nowIso(),
    model: importModel(meta.model),
    status: 'idle',
    reasoningEffort: includes(REASONING_EFFORTS, meta.reasoningEffort)
      ? meta.reasoningEffort
      : null,
    permissionMode: includes(PERMISSION_MODES, meta.permissionMode) ? meta.permissionMode : 'ask',
    compaction: importCompaction(meta.compaction, messageIds),
    redoAvailable: false,
    contextTokens: nonNegativeNumber(meta.contextTokens),
    contextWindow: positiveNumber(meta.contextWindow),
    agent: typeof meta.agent === 'string' ? meta.agent : null,
    parentId,
    // A hidden session without an imported parent would be invisible forever,
    // so it becomes a normal top-level session.
    hidden: meta.hidden === true && parentId !== null,
    todos: importTodos(meta.todos),
    directory: typeof meta.directory === 'string' ? meta.directory : null
  }
}

function importMessage(
  message: ChatMessage,
  sessionId: string,
  messageIds: Map<string, string>
): ChatMessage {
  if (!isRecord(message)) throw new Error('EXPORT_INVALID_MESSAGE')
  if (message.role !== 'user' && message.role !== 'assistant') {
    throw new Error('EXPORT_INVALID_MESSAGE')
  }
  if (!Array.isArray(message.parts)) throw new Error('EXPORT_INVALID_MESSAGE')

  const id = randomUUID()
  if (typeof message.id === 'string' && message.id && !messageIds.has(message.id)) {
    messageIds.set(message.id, id)
  }

  const imported: ChatMessage = {
    id,
    sessionId,
    role: message.role,
    parts: message.parts
      .map((part) => importPart(part))
      .filter((part): part is MessagePart => part !== null),
    createdAt: dateOrDefault(message.createdAt),
    updatedAt: dateOrDefault(message.updatedAt),
    status: includes(MESSAGE_STATUSES, message.status) ? message.status : 'interrupted'
  }
  if (typeof message.error === 'string') imported.error = message.error
  const model = importModel(message.model)
  if (model) imported.model = model
  const usage = importUsage(message.usage)
  if (usage) imported.usage = usage
  const contextUsage = importUsage(message.contextUsage)
  if (contextUsage) imported.contextUsage = contextUsage
  const durationMs = nonNegativeNumber(message.durationMs)
  if (durationMs !== null) imported.durationMs = durationMs
  const costUsd = nonNegativeNumber(message.costUsd)
  if (costUsd !== null) imported.costUsd = costUsd
  const synthetic = importSynthetic(message.synthetic)
  if (synthetic) imported.synthetic = synthetic
  return imported
}

function importPart(part: MessagePart): MessagePart | null {
  if (!isRecord(part) || typeof part.type !== 'string') throw new Error('EXPORT_INVALID_MESSAGE')
  // Snapshot and step bookkeeping reference data that was never exported.
  if (isMetadataPart(part)) return null

  if (part.type === 'text') {
    if (typeof part.text !== 'string') throw new Error('EXPORT_INVALID_MESSAGE')
    return { type: 'text', text: part.text }
  }
  if (part.type === 'reasoning') {
    if (typeof part.text !== 'string') throw new Error('EXPORT_INVALID_MESSAGE')
    const reasoning: Extract<MessagePart, { type: 'reasoning' }> = {
      type: 'reasoning',
      text: part.text
    }
    if (isRecord(part.providerMetadata)) {
      reasoning.providerMetadata = structuredClone(part.providerMetadata)
    }
    return reasoning
  }
  if (part.type === 'attachment') {
    return { type: 'attachment', attachment: importAttachment(part.attachment) }
  }
  if (part.type === 'tool') return importTool(part)
  throw new Error('EXPORT_INVALID_MESSAGE')
}

function importAttachment(attachment: MessageAttachment): MessageAttachment {
  if (!isRecord(attachment)) throw new Error('EXPORT_INVALID_MESSAGE')
  if (
    typeof attachment.name !== 'string' ||
    typeof attachment.mimeType !== 'string' ||
    typeof attachment.size !== 'number' ||
    !Number.isFinite(attachment.size) ||
    !includes(ATTACHMENT_KINDS, attachment.kind)
  ) {
    throw new Error('EXPORT_INVALID_MESSAGE')
  }
  return {
    id: randomUUID(),
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: Math.max(0, attachment.size),
    kind: attachment.kind,
    // Attachment files are never part of an export.
    path: SESSION_EXPORT_ATTACHMENT_PLACEHOLDER
  }
}

function importTool(
  part: Extract<MessagePart, { type: 'tool' }>
): Extract<MessagePart, { type: 'tool' }> {
  if (
    typeof part.toolCallId !== 'string' ||
    !part.toolCallId ||
    typeof part.toolName !== 'string' ||
    !part.toolName ||
    !includes(TOOL_STATES, part.state)
  ) {
    throw new Error('EXPORT_INVALID_MESSAGE')
  }

  const interrupted =
    part.state === 'pending' || part.state === 'running' || part.state === 'awaiting-approval'
  const omittedImages =
    (Array.isArray(part.images) ? part.images.length : 0) +
    (typeof part.imagesOmitted === 'number' && Number.isFinite(part.imagesOmitted)
      ? Math.max(0, part.imagesOmitted)
      : 0)

  const tool: Extract<MessagePart, { type: 'tool' }> = {
    type: 'tool',
    toolCallId: randomUUID(),
    toolName: part.toolName,
    state: interrupted ? 'failed' : part.state
  }
  if (part.input !== undefined) tool.input = structuredClone(part.input)
  if (typeof part.output === 'string') tool.output = part.output
  if (typeof part.startedAt === 'string') tool.startedAt = part.startedAt
  if (interrupted) {
    tool.error = typeof part.error === 'string' && part.error ? part.error : 'Interrupted by import'
    tool.finishedAt = nowIso()
  } else {
    if (typeof part.error === 'string') tool.error = part.error
    if (typeof part.finishedAt === 'string') tool.finishedAt = part.finishedAt
  }
  if (omittedImages > 0) tool.imagesOmitted = omittedImages
  return tool
}

function importCompaction(
  value: SessionCompaction | null,
  messageIds: Map<string, string>
): SessionCompaction | null {
  if (!isRecord(value)) return null
  const throughMessageId =
    typeof value.throughMessageId === 'string' ? messageIds.get(value.throughMessageId) : undefined
  if (
    !throughMessageId ||
    typeof value.summary !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.tokensBefore !== 'number' ||
    typeof value.tokensAfter !== 'number'
  ) {
    return null
  }
  return {
    summary: value.summary,
    throughMessageId,
    createdAt: value.createdAt,
    tokensBefore: value.tokensBefore,
    tokensAfter: value.tokensAfter
  }
}

function importTodos(value: TodoItem[]): TodoItem[] {
  if (!Array.isArray(value)) return []
  const inputs = value
    .filter(isRecord)
    .filter(
      (todo) =>
        typeof todo.content === 'string' &&
        todo.content.trim().length > 0 &&
        includes(TODO_STATUSES, todo.status) &&
        includes(TODO_PRIORITIES, todo.priority)
    )
    .map((todo) => ({
      content: (todo.content as string).trim(),
      status: todo.status as TodoItem['status'],
      priority: todo.priority as TodoItem['priority']
    }))
  return normalizeTodos(inputs)
}

function importModel(value: ModelRef | null | undefined): ModelRef | null {
  if (!isRecord(value)) return null
  if (typeof value.providerId !== 'string' || typeof value.modelId !== 'string') return null
  return {
    providerId: value.providerId,
    modelId: value.modelId,
    variant: typeof value.variant === 'string' ? value.variant : null
  }
}

function importUsage(value: TokenUsage | undefined): TokenUsage | null {
  if (!isRecord(value)) return null
  const usage: TokenUsage = {}
  for (const key of [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'cacheReadTokens',
    'cacheWriteTokens'
  ] as const) {
    const tokenCount = nonNegativeNumber(value[key])
    if (tokenCount !== null) usage[key] = tokenCount
  }
  return Object.keys(usage).length > 0 ? usage : null
}

function importSynthetic(value: SyntheticMessageInfo | undefined): SyntheticMessageInfo | null {
  if (!isRecord(value)) return null
  if (
    value.source !== 'background-task' ||
    typeof value.taskId !== 'string' ||
    (value.kind !== 'shell' && value.kind !== 'subagent') ||
    !includes(BACKGROUND_STATES, value.state) ||
    typeof value.title !== 'string' ||
    typeof value.body !== 'string'
  ) {
    return null
  }
  return {
    source: 'background-task',
    taskId: value.taskId,
    kind: value.kind,
    state: value.state,
    title: value.title,
    body: value.body
  }
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function dateOrDefault(value: unknown): string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : nowIso()
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nowIso(): string {
  return new Date().toISOString()
}
