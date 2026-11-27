import { randomUUID } from 'node:crypto'
import type {
  ChatMessage,
  ModelRef,
  PermissionMode,
  ReasoningEffort,
  SessionCompaction,
  SessionMeta,
  SessionSettings,
  TodoInput,
  TodoItem,
  TodoPriority,
  TodoStatus
} from '@ateam/shared'
import { PERMISSION_MODES, REASONING_EFFORTS, isMetadataPart } from '@ateam/shared'
import { normalizeTodos, TODO_PRIORITIES, TODO_STATUSES } from '../todos'
import { migrateRecordMessageParts } from './migrate-message-parts'
import {
  createSessionStorage,
  type PreparedCompaction,
  type RedoState,
  type RevertState,
  type SessionBackend,
  type SessionRecord,
  type SessionStorage
} from './storage'

export type { PreparedCompaction, RedoState, RevertState, SessionRecord }

function nowIso(): string {
  return new Date().toISOString()
}

function isSessionCompaction(value: unknown): value is SessionCompaction {
  if (!value || typeof value !== 'object') return false
  const compaction = value as Partial<SessionCompaction>
  return (
    typeof compaction.summary === 'string' &&
    typeof compaction.throughMessageId === 'string' &&
    typeof compaction.createdAt === 'string' &&
    typeof compaction.tokensBefore === 'number' &&
    typeof compaction.tokensAfter === 'number'
  )
}

function isRevertState(value: unknown): value is RevertState {
  if (!value) return true
  if (typeof value !== 'object') return false
  const revert = value as Partial<RevertState>
  return (
    typeof revert.snapshot === 'string' &&
    typeof revert.messageId === 'string' &&
    Array.isArray(revert.files) &&
    revert.files.every((file) => typeof file === 'string')
  )
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function repairTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) return []
  const inputs: TodoInput[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Partial<TodoItem>
    if (typeof raw.content !== 'string' || !raw.content.trim()) continue
    if (!TODO_STATUSES.includes(raw.status as TodoStatus)) continue
    if (!TODO_PRIORITIES.includes(raw.priority as TodoPriority)) continue
    inputs.push({
      content: raw.content,
      status: raw.status as TodoStatus,
      priority: raw.priority as TodoPriority
    })
  }
  return normalizeTodos(inputs)
}

export function makeTitle(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? line.slice(0, 60) : line
}

function repairRecord(record: SessionRecord): boolean {
  let changed = false
  if (record.session.status === 'running' || record.session.status === 'waiting-permission') {
    record.session.status = 'idle'
    changed = true
  }

  if (!PERMISSION_MODES.includes(record.session.permissionMode as PermissionMode)) {
    record.session.permissionMode = 'ask'
    changed = true
  }
  if (
    record.session.reasoningEffort !== null &&
    !REASONING_EFFORTS.includes(record.session.reasoningEffort as ReasoningEffort)
  ) {
    record.session.reasoningEffort = null
    changed = true
  }
  if (!isSessionCompaction(record.session.compaction)) {
    record.session.compaction = null
    changed = true
  }
  if (record.session.directory !== null && typeof record.session.directory !== 'string') {
    record.session.directory = null
    changed = true
  }
  if (!isRevertState(record.revert)) {
    if (record.revert) {
      delete record.revert
      changed = true
    }
  }
  const redoAvailable = Boolean(record.redo)
  if (record.session.redoAvailable !== redoAvailable) {
    record.session.redoAvailable = redoAvailable
    changed = true
  }
  if (
    record.session.contextTokens !== null &&
    (typeof record.session.contextTokens !== 'number' || record.session.contextTokens < 0)
  ) {
    record.session.contextTokens = null
    changed = true
  }
  if (
    record.session.contextWindow !== null &&
    (typeof record.session.contextWindow !== 'number' || record.session.contextWindow < 1)
  ) {
    record.session.contextWindow = null
    changed = true
  }
  if (record.session.contextTokens === undefined) {
    record.session.contextTokens = null
    changed = true
  }
  if (record.session.contextWindow === undefined) {
    record.session.contextWindow = null
    changed = true
  }
  if (typeof record.session.agent !== 'string') {
    record.session.agent = null
    changed = true
  }
  if (typeof record.session.parentId !== 'string') {
    record.session.parentId = null
    changed = true
  }
  if (typeof record.session.hidden !== 'boolean') {
    record.session.hidden = false
    changed = true
  }
  const todos = repairTodos(record.session.todos)
  if (JSON.stringify(todos) !== JSON.stringify(record.session.todos)) {
    record.session.todos = todos
    changed = true
  }

  for (const message of record.messages) {
    if (message.role === 'assistant' && !message.model && record.session.model) {
      // Messages written before model metadata existed inherit the session model.
      message.model = { ...record.session.model }
      changed = true
    }
    if (message.status === 'streaming') {
      message.status = 'interrupted'
      changed = true
    }
    for (const part of message.parts) {
      if (
        part.type === 'tool' &&
        (part.state === 'pending' || part.state === 'running' || part.state === 'awaiting-approval')
      ) {
        part.state = 'failed'
        part.error = 'Interrupted by app restart'
        part.finishedAt = nowIso()
        changed = true
      }
    }
  }

  if (migrateRecordMessageParts(record)) changed = true

  if (changed) record.session.updatedAt = nowIso()
  return changed
}

export class SessionsStore {
  private readonly storage: SessionStorage
  private records = new Map<string, SessionRecord>()
  private writeQueues = new Map<string, Promise<void>>()

  constructor(userDataPath: string, options: { backend?: SessionBackend } = {}) {
    this.storage = createSessionStorage(userDataPath, options.backend)
  }

  async init(): Promise<void> {
    const records = await this.storage.init()
    this.records.clear()

    for (const record of records) {
      const changed = repairRecord(record)
      this.records.set(record.session.id, record)
      if (changed) await this.persist(record.session.id)
    }
  }

  list(): SessionMeta[] {
    return [...this.records.values()]
      .map((record) => clone(record.session))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  get(id: string): SessionRecord | undefined {
    return this.records.get(id)
  }

  getSession(id: string): SessionMeta | undefined {
    const record = this.records.get(id)
    return record ? clone(record.session) : undefined
  }

  getMessages(id: string): ChatMessage[] | undefined {
    const record = this.records.get(id)
    return record ? clone(record.messages) : undefined
  }

  async create(
    options: {
      hidden?: boolean
      parentId?: string | null
      agent?: string | null
      permissionMode?: PermissionMode
      directory?: string | null
    } = {}
  ): Promise<SessionMeta> {
    const timestamp = nowIso()
    const session: SessionMeta = {
      id: randomUUID(),
      title: '',
      createdAt: timestamp,
      updatedAt: timestamp,
      model: null,
      status: 'idle',
      reasoningEffort: null,
      permissionMode: options.permissionMode ?? 'ask',
      compaction: null,
      redoAvailable: false,
      contextTokens: null,
      contextWindow: null,
      agent: options.agent ?? null,
      parentId: options.parentId ?? null,
      hidden: options.hidden ?? false,
      todos: [],
      directory: options.directory ?? null
    }
    this.records.set(session.id, { session, messages: [] })
    await this.persist(session.id)
    return clone(session)
  }

  /** Inserts a fully remapped record, e.g. one produced by an import. */
  async importRecord(record: SessionRecord): Promise<SessionMeta> {
    if (this.records.has(record.session.id)) throw new Error('SESSION_EXISTS')
    this.records.set(record.session.id, record)
    await this.persist(record.session.id)
    return clone(record.session)
  }

  async setAgent(id: string, agent: string | null): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    record.session.agent = agent
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return clone(record.session)
  }

  async setDirectory(id: string, directory: string | null): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    record.session.directory = directory
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return clone(record.session)
  }

  async setTodos(id: string, todos: TodoItem[]): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    record.session.todos = clone(todos)
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return clone(record.session)
  }

  async fork(id: string, messageId?: string): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    let messages = clone(record.messages)
      .filter((message) => message.status !== 'streaming')
      .map((message) => ({
        ...message,
        // Forked sessions keep the conversation but must not point at the
        // parent's snapshots, so step/patch/snapshot parts are dropped.
        parts: message.parts.filter((part) => !isMetadataPart(part))
      }))
    if (messageId) {
      const index = messages.findIndex((message) => message.id === messageId)
      if (index === -1) return undefined
      messages = messages.slice(0, index + 1)
    }

    const timestamp = nowIso()
    const session: SessionMeta = {
      ...clone(record.session),
      id: randomUUID(),
      title: `${record.session.title || 'Chat'} (fork)`.slice(0, 120),
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'idle',
      compaction: null,
      redoAvailable: false,
      contextTokens: null,
      contextWindow: null,
      hidden: false,
      parentId: null,
      todos: []
    }
    this.records.set(session.id, { session, messages })
    await this.persist(session.id)
    return clone(session)
  }

  async rewriteAttachmentPaths(id: string, rewrite: (path: string) => string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return
    let changed = false
    for (const message of record.messages) {
      for (const part of message.parts) {
        if (part.type !== 'attachment') continue
        const next = rewrite(part.attachment.path)
        if (next === part.attachment.path) continue
        part.attachment.path = next
        changed = true
      }
    }
    if (changed) await this.persist(id)
  }

  async rename(id: string, title: string): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    record.session.title = title.trim().slice(0, 120)
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return clone(record.session)
  }

  async setModel(id: string, model: ModelRef | null): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    record.session.model = model
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return clone(record.session)
  }

  async setSettings(id: string, settings: SessionSettings): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    record.session.reasoningEffort = settings.reasoningEffort
    record.session.permissionMode = settings.permissionMode
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return clone(record.session)
  }

  async setCompaction(
    id: string,
    compaction: SessionCompaction | null
  ): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    record.session.compaction = compaction ? clone(compaction) : null
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return clone(record.session)
  }

  async setStatus(id: string, status: SessionMeta['status']): Promise<void> {
    const record = this.records.get(id)
    if (!record) return
    record.session.status = status
    record.session.updatedAt = nowIso()
    await this.persist(id)
  }

  async setContextUsage(
    id: string,
    tokens: number,
    window: number
  ): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    record.session.contextTokens = tokens
    record.session.contextWindow = window
    await this.persist(id)
    return clone(record.session)
  }

  async appendMessage(id: string, message: ChatMessage): Promise<void> {
    const record = this.records.get(id)
    if (!record) return
    record.messages.push(message)
    if (record.redo) {
      delete record.redo
      record.session.redoAvailable = false
    }
    if (record.revert) delete record.revert
    record.session.updatedAt = nowIso()
    if (!record.session.title && message.role === 'user') {
      const text = message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(' ')
      record.session.title = makeTitle(text)
    }
    await this.persist(id)
  }

  getRedo(id: string): RedoState | undefined {
    const record = this.records.get(id)
    return record?.redo ? clone(record.redo) : undefined
  }

  getRevert(id: string): RevertState | undefined {
    const record = this.records.get(id)
    return record?.revert ? clone(record.revert) : undefined
  }

  async setRevert(id: string, revert: RevertState): Promise<void> {
    const record = this.records.get(id)
    if (!record) return
    record.revert = clone(revert)
    await this.persist(id)
  }

  async clearRevert(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record?.revert) return
    delete record.revert
    await this.persist(id)
  }

  getPreparedCompaction(id: string): PreparedCompaction | undefined {
    const record = this.records.get(id)
    return record?.preparedCompaction ? clone(record.preparedCompaction) : undefined
  }

  async setPreparedCompaction(id: string, prepared: PreparedCompaction): Promise<void> {
    const record = this.records.get(id)
    if (!record) return
    record.preparedCompaction = clone(prepared)
    await this.persist(id)
  }

  async clearPreparedCompaction(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record?.preparedCompaction) return
    delete record.preparedCompaction
    await this.persist(id)
  }

  async stageUndo(
    id: string,
    fromIndex: number,
    snapshotAfter: string | null,
    prompt: string,
    files: string[]
  ): Promise<{ session: SessionMeta; removed: ChatMessage[] } | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= record.messages.length) {
      return undefined
    }
    const removed = record.messages.splice(fromIndex)
    if (
      record.session.compaction &&
      removed.some((message) => message.id === record.session.compaction?.throughMessageId)
    ) {
      record.session.compaction = null
    }
    if (
      record.preparedCompaction &&
      removed.some((message) => message.id === record.preparedCompaction?.throughMessageId)
    ) {
      delete record.preparedCompaction
    }
    record.redo = {
      messages: clone(removed),
      snapshotAfter,
      files: [...files],
      prompt
    }
    if (record.revert) delete record.revert
    record.session.redoAvailable = true
    record.session.status = 'idle'
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return { session: clone(record.session), removed: clone(removed) }
  }

  async stageStepUndo(
    id: string,
    index: number,
    original: ChatMessage,
    snapshotAfter: string | null,
    files: string[]
  ): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    if (!Number.isInteger(index) || index < 0 || index >= record.messages.length) {
      return undefined
    }
    if (record.revert) delete record.revert
    record.redo = {
      messages: [],
      snapshotAfter,
      files: [...files],
      prompt: '',
      target: { index, message: clone(original) }
    }
    record.session.redoAvailable = true
    record.session.status = 'idle'
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return clone(record.session)
  }

  async redo(id: string): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record?.redo) return undefined
    if (record.redo.target) {
      const { index, message } = record.redo.target
      if (index >= 0 && index < record.messages.length) {
        record.messages[index] = clone(message)
      } else {
        record.messages.push(clone(message))
      }
    } else {
      record.messages.push(...clone(record.redo.messages))
    }
    delete record.redo
    record.session.redoAvailable = false
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return clone(record.session)
  }

  async clearRedo(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record?.redo) return
    delete record.redo
    record.session.redoAvailable = false
    record.session.updatedAt = nowIso()
    await this.persist(id)
  }

  async persist(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return
    const previous = this.writeQueues.get(id) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const current = this.records.get(id)
        if (!current) return
        await this.storage.persist(structuredClone(current))
      })
    this.writeQueues.set(id, next)
    await next
  }

  async delete(id: string): Promise<boolean> {
    if (!this.records.delete(id)) return false
    await this.writeQueues.get(id)?.catch(() => undefined)
    await this.storage.remove(id)
    return true
  }

  async flush(): Promise<void> {
    await Promise.all([...this.writeQueues.values()])
    await this.storage.flush()
  }

  async close(): Promise<void> {
    await this.flush()
    await this.storage.close()
  }
}
