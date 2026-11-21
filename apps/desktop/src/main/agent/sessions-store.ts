import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  ChatMessage,
  ModelRef,
  PermissionMode,
  ReasoningEffort,
  SessionCompaction,
  SessionMeta,
  SessionSettings
} from '@ateam/shared'
import { PERMISSION_MODES, REASONING_EFFORTS } from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from './atomic-json'

interface SessionIndex {
  version: 1
  sessions: SessionMeta[]
}

interface SessionFile {
  version: 1
  session: SessionMeta
  messages: ChatMessage[]
  redo?: RedoState
}

export interface RedoState {
  messages: ChatMessage[]
  snapshotAfter: string | null
  prompt: string
}

export interface SessionRecord {
  session: SessionMeta
  messages: ChatMessage[]
  redo?: RedoState
}

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

function clone<T>(value: T): T {
  return structuredClone(value)
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
  const redoAvailable = Boolean(record.redo)
  if (record.session.redoAvailable !== redoAvailable) {
    record.session.redoAvailable = redoAvailable
    changed = true
  }

  for (const message of record.messages) {
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

  if (changed) record.session.updatedAt = nowIso()
  return changed
}

export class SessionsStore {
  private readonly root: string
  private readonly indexFile: string
  private records = new Map<string, SessionRecord>()
  private writeQueues = new Map<string, Promise<void>>()
  private indexQueue: Promise<void> | null = null

  constructor(userDataPath: string) {
    this.root = path.join(userDataPath, 'agent', 'sessions')
    this.indexFile = path.join(this.root, 'index.json')
  }

  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    const index = await readJsonFile<SessionIndex>(this.indexFile)
    const entries = index?.sessions ?? (await this.scanSessions())
    this.records.clear()

    for (const entry of entries) {
      const record = await this.loadRecord(entry.id)
      if (!record) continue
      const changed = repairRecord(record)
      this.records.set(record.session.id, record)
      if (changed) await this.persist(record.session.id)
    }

    await this.writeIndex()
  }

  private async scanSessions(): Promise<SessionMeta[]> {
    const sessions: SessionMeta[] = []
    let files: string[] = []
    try {
      files = await fs.readdir(this.root)
    } catch {
      return sessions
    }

    for (const file of files) {
      if (!file.endsWith('.json') || file === 'index.json') continue
      const record = await this.loadRecord(file.slice(0, -5))
      if (record) sessions.push(record.session)
    }
    return sessions
  }

  private async loadRecord(id: string): Promise<SessionRecord | null> {
    const filePath = this.sessionFile(id)
    const data = await readJsonFile<SessionFile>(filePath)
    if (!data || !data.session || !Array.isArray(data.messages)) {
      try {
        await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
      return null
    }
    return { session: data.session, messages: data.messages, redo: data.redo }
  }

  private sessionFile(id: string): string {
    return path.join(this.root, `${id}.json`)
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

  async create(): Promise<SessionMeta> {
    const timestamp = nowIso()
    const session: SessionMeta = {
      id: randomUUID(),
      title: '',
      createdAt: timestamp,
      updatedAt: timestamp,
      model: null,
      status: 'idle',
      reasoningEffort: null,
      permissionMode: 'ask',
      compaction: null,
      redoAvailable: false
    }
    this.records.set(session.id, { session, messages: [] })
    await this.persist(session.id)
    return clone(session)
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

  async appendMessage(id: string, message: ChatMessage): Promise<void> {
    const record = this.records.get(id)
    if (!record) return
    record.messages.push(message)
    if (record.redo) {
      delete record.redo
      record.session.redoAvailable = false
    }
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

  async stageUndo(
    id: string,
    fromIndex: number,
    snapshotAfter: string | null,
    prompt: string
  ): Promise<{ session: SessionMeta; removed: ChatMessage[] } | undefined> {
    const record = this.records.get(id)
    if (!record) return undefined
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= record.messages.length) {
      return undefined
    }
    const removed = record.messages.splice(fromIndex)
    record.redo = {
      messages: clone(removed),
      snapshotAfter,
      prompt
    }
    record.session.redoAvailable = true
    record.session.status = 'idle'
    record.session.updatedAt = nowIso()
    await this.persist(id)
    return { session: clone(record.session), removed: clone(removed) }
  }

  async redo(id: string): Promise<SessionMeta | undefined> {
    const record = this.records.get(id)
    if (!record?.redo) return undefined
    record.messages.push(...clone(record.redo.messages))
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
        const data: SessionFile = {
          version: 1,
          session: clone(current.session),
          messages: clone(current.messages),
          redo: current.redo ? clone(current.redo) : undefined
        }
        await writeJsonAtomic(this.sessionFile(id), data)
        await this.writeIndex()
      })
    this.writeQueues.set(id, next)
    await next
  }

  private async writeIndex(): Promise<void> {
    const previous = this.indexQueue ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const data: SessionIndex = {
          version: 1,
          sessions: [...this.records.values()].map((record) => clone(record.session))
        }
        await writeJsonAtomic(this.indexFile, data)
      })
    this.indexQueue = next
    await next
  }

  async delete(id: string): Promise<boolean> {
    if (!this.records.delete(id)) return false
    await this.writeIndex()
    try {
      await fs.rm(this.sessionFile(id), { force: true })
    } catch {
      /* ignore */
    }
    return true
  }

  async flush(): Promise<void> {
    await Promise.all([...this.writeQueues.values(), this.indexQueue ?? Promise.resolve()])
  }
}
