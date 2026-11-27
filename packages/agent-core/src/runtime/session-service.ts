import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentDefinition,
  AgentEvent,
  MessagesSnapshot,
  ModelRef,
  RuntimeModelsConfig,
  SessionExportPayload,
  SessionExportRequest,
  SessionImportResult,
  SessionMeta,
  SessionSearchResult,
  SessionSettings,
  UsageStats,
  UsageStatsRange
} from '@ateam/shared'
import { PERMISSION_MODES, REASONING_EFFORTS } from '@ateam/shared'
import { loadAgents } from '../config/agents'
import { resolveModelRef } from '../providers'
import { buildSessionExport } from '../sessions/export'
import { prepareSessionImport } from '../sessions/import'
import { computeUsageStats } from '../sessions/usage'
import type { SessionRecord, SessionsStore } from '../sessions/sessions-store'
import { nowIso } from './messages'
import { copyForkAttachments } from './turn-changes'

export interface SessionHost {
  readonly store: SessionsStore
  readonly userDataPath: string
  readonly defaultWorkspacePath: string
  readonly appVersion: string
  models(): RuntimeModelsConfig
  modelsFor(sessionId: string): RuntimeModelsConfig
  emit(event: AgentEvent): void
  currentSeq(): number
  reserveSession(sessionId: string): void
  releaseSession(sessionId: string): void
  sessionBusy(sessionId: string): boolean
  hasRun(sessionId: string): boolean
  sessionWorkspace(sessionId: string): string
  releaseWorkspace(workspace: string): Promise<void>
}

export class SessionService {
  constructor(private readonly host: SessionHost) {}

  listSessions(): SessionMeta[] {
    return this.host.store.list().filter((session) => !session.hidden)
  }

  /** Local usage aggregates; nothing leaves the machine. */
  usageStats(range: UsageStatsRange): UsageStats {
    return computeUsageStats(this.host.store.allRecords(), { range })
  }

  listAgents(workspace?: string): Promise<AgentDefinition[]> {
    return this.agents(workspace)
  }

  agents(workspace?: string): Promise<AgentDefinition[]> {
    return loadAgents({
      userDataPath: this.host.userDataPath,
      workspacePath: workspace ?? this.host.defaultWorkspacePath
    })
  }

  async setSessionAgent(id: string, agentId: string | null): Promise<SessionMeta> {
    const record = this.host.store.get(id)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    if (agentId) {
      const agents = await this.agents(record.session.directory ?? this.host.defaultWorkspacePath)
      const agent = agents.find(
        (candidate) =>
          candidate.id === agentId || candidate.name.toLowerCase() === agentId.toLowerCase()
      )
      if (!agent) throw new Error('AGENT_NOT_FOUND')
      if (agent.mode === 'subagent') throw new Error('AGENT_NOT_PRIMARY')
    }
    const session = await this.host.store.setAgent(id, agentId)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.host.emit({ type: 'session.upsert', session })
    return session
  }

  async createSession(directory?: string | null): Promise<SessionMeta> {
    const target = await this.resolveSessionDirectoryInput(directory)
    const session = await this.host.store.create({ directory: target })
    this.host.emit({ type: 'session.upsert', session })
    return session
  }

  async setSessionDirectory(id: string, directory: string | null): Promise<SessionMeta> {
    if (!this.host.store.get(id)) throw new Error('SESSION_NOT_FOUND')
    if (this.host.sessionBusy(id)) throw new Error('SESSION_BUSY')
    const target = await this.resolveSessionDirectoryInput(directory)
    if (this.host.sessionBusy(id)) throw new Error('SESSION_BUSY')
    const previous = this.host.sessionWorkspace(id)
    const session = await this.host.store.setDirectory(id, target)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.host.emit({ type: 'session.upsert', session })
    void this.host.releaseWorkspace(previous)
    return session
  }

  async renameSession(id: string, title: string): Promise<SessionMeta> {
    const session = await this.host.store.rename(id, title)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.host.emit({ type: 'session.upsert', session })
    return session
  }

  async setSessionModel(id: string, model: ModelRef | null): Promise<SessionMeta> {
    if (model) {
      const resolved = resolveModelRef(this.host.modelsFor(id), model).model
      if (model.variant && !(resolved.variants ?? []).some((item) => item.id === model.variant)) {
        throw new Error('INVALID_VARIANT')
      }
    }
    const session = await this.host.store.setModel(id, model)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.host.emit({ type: 'session.upsert', session })
    return session
  }

  async setSessionSettings(id: string, settings: SessionSettings): Promise<SessionMeta> {
    if (
      settings.reasoningEffort !== null &&
      !REASONING_EFFORTS.includes(settings.reasoningEffort)
    ) {
      throw new Error('INVALID_REASONING_EFFORT')
    }
    if (!PERMISSION_MODES.includes(settings.permissionMode)) {
      throw new Error('INVALID_PERMISSION_MODE')
    }
    const session = await this.host.store.setSettings(id, settings)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    this.host.emit({ type: 'session.upsert', session })
    return session
  }

  async forkSession(id: string, messageId?: string): Promise<SessionMeta> {
    if (!this.host.store.get(id)) throw new Error('SESSION_NOT_FOUND')
    this.host.reserveSession(id)

    try {
      const session = await this.host.store.fork(id, messageId)
      if (!session) throw new Error('SESSION_NOT_FOUND')
      await copyForkAttachments(
        { userDataPath: this.host.userDataPath, store: this.host.store },
        id,
        session.id
      )
      this.host.emit({ type: 'session.upsert', session })
      return session
    } finally {
      this.host.releaseSession(id)
    }
  }

  searchSessions(query: string): SessionSearchResult[] {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    const results: SessionSearchResult[] = []
    for (const session of this.listSessions()) {
      if (session.title.toLowerCase().includes(needle)) {
        results.push({ session, snippet: session.title })
        continue
      }
      const messages = this.host.store.getMessages(session.id) ?? []
      for (const message of messages) {
        const text = message.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(' ')
        const index = text.toLowerCase().indexOf(needle)
        if (index === -1) continue
        const start = Math.max(0, index - 40)
        results.push({
          session,
          snippet: text.slice(start, index + needle.length + 60).trim()
        })
        break
      }
    }
    return results.slice(0, 20)
  }

  /**
   * Serializes one session, or every stored session (including hidden
   * sub-sessions, so parent/child links survive a re-import), into an export
   * payload. Read-only: it never mutates the stored records.
   */
  exportSessions(options: SessionExportRequest): SessionExportPayload {
    const records: SessionRecord[] = []
    if (options.sessionId) {
      const record = this.host.store.get(options.sessionId)
      if (!record) throw new Error('SESSION_NOT_FOUND')
      records.push(record)
    } else {
      for (const session of this.host.store.list()) {
        const record = this.host.store.get(session.id)
        if (record) records.push(record)
      }
    }
    return buildSessionExport(records, {
      format: options.format,
      appVersion: this.host.appVersion,
      redactPaths: options.redactPaths ?? true
    })
  }

  /**
   * Imports an export file as new sessions. Every id is remapped, so repeated
   * imports produce independent copies; existing sessions are never touched.
   */
  async importSessions(content: string): Promise<SessionImportResult> {
    const records = prepareSessionImport(content)
    const imported: SessionMeta[] = []
    let messageCount = 0

    for (const record of records) {
      record.session.directory = await this.resolveImportedDirectory(record.session.directory)
      // A model that is not configured on this machine would block the first
      // message; fall back to the default model instead.
      if (record.session.model) {
        try {
          resolveModelRef(this.host.modelsFor(record.session.id), record.session.model)
        } catch {
          record.session.model = null
        }
      }
      await this.host.store.importRecord(record)
      messageCount += record.messages.length
      if (record.session.hidden) continue
      const session = structuredClone(record.session)
      imported.push(session)
      this.host.emit({ type: 'session.upsert', session: structuredClone(record.session) })
    }

    // Newest first, matching how the session list orders entries.
    imported.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return {
      imported: true,
      sessions: imported,
      sessionCount: records.length,
      messageCount
    }
  }

  /**
   * Imported workspaces are only reused when the exported path is absolute and
   * still exists locally. Redacted placeholders (`~`, `<PATH>`) and paths from
   * another machine fall back to the runtime workspace.
   */
  private async resolveImportedDirectory(directory: string | null): Promise<string | null> {
    if (!directory || !path.isAbsolute(directory)) return null
    const stat = await fs.stat(directory).catch(() => null)
    if (!stat?.isDirectory()) return null
    return fs.realpath(directory).catch(() => path.resolve(directory))
  }

  messages(id: string): MessagesSnapshot {
    const messages = this.host.store.getMessages(id)
    if (!messages) throw new Error('SESSION_NOT_FOUND')
    return {
      sessionId: id,
      seq: this.host.currentSeq(),
      messages,
      running: this.host.hasRun(id)
    }
  }

  setModels(): void {
    for (const session of this.host.store.list()) {
      if (!session.model) continue
      try {
        const resolved = resolveModelRef(this.host.modelsFor(session.id), session.model)
        if (
          session.model.variant &&
          !(resolved.model.variants ?? []).some((variant) => variant.id === session.model?.variant)
        ) {
          const record = this.host.store.get(session.id)
          const fallback = { ...session.model, variant: null }
          if (record) record.session.model = fallback
          void this.host.store.setModel(session.id, fallback)
        }
      } catch {
        const record = this.host.store.get(session.id)
        if (!record) continue
        record.session.model = null
        record.session.updatedAt = nowIso()
        void this.host.store.persist(session.id)
        this.host.emit({ type: 'session.upsert', session: structuredClone(record.session) })
      }
    }
  }

  private async resolveSessionDirectoryInput(directory?: string | null): Promise<string> {
    if (!directory) return this.host.defaultWorkspacePath
    if (!path.isAbsolute(directory)) throw new Error('INVALID_SESSION_DIRECTORY')
    const stat = await fs.stat(directory).catch(() => null)
    if (!stat?.isDirectory()) throw new Error('INVALID_SESSION_DIRECTORY')
    return fs.realpath(directory).catch(() => path.resolve(directory))
  }
}
