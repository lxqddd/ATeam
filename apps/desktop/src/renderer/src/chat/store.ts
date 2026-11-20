import { useSyncExternalStore } from 'react'
import type {
  AgentEvent,
  AgentEventEnvelope,
  AgentInfo,
  AgentStatus,
  ChatMessage,
  MessagesSnapshot,
  ModelRef,
  ModelsConfigPublic,
  PermissionDecision,
  PermissionRequest,
  RunOutcome,
  SessionMeta
} from '@ateam/shared'

export interface ChatStoreState {
  status: AgentStatus
  info: AgentInfo | null
  models: ModelsConfigPublic | null
  sessions: SessionMeta[]
  selectedSessionId: string | null
  messagesBySession: Record<string, ChatMessage[] | undefined>
  loadedBySession: Record<string, boolean>
  permissions: PermissionRequest[]
  runOutcomes: Record<string, RunOutcome>
  actionError: string | null
  restarting: boolean
}

const INITIAL_STATUS: AgentStatus = { status: 'stopped' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sortSessions(sessions: SessionMeta[]): SessionMeta[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function eventSessionId(event: AgentEvent): string | null {
  switch (event.type) {
    case 'message.upsert':
      return event.message.sessionId
    case 'message.part.delta':
    case 'message.part.upsert':
    case 'permission.replied':
    case 'run.started':
    case 'run.finished':
      return event.sessionId
    case 'permission.asked':
      return event.permission.sessionId
    default:
      return null
  }
}

export class ChatStore {
  private state: ChatStoreState = {
    status: INITIAL_STATUS,
    info: null,
    models: null,
    sessions: [],
    selectedSessionId: null,
    messagesBySession: {},
    loadedBySession: {},
    permissions: [],
    runOutcomes: {},
    actionError: null,
    restarting: false
  }

  private listeners = new Set<() => void>()
  private initialized = false
  private initPromise: Promise<void> | null = null
  private loadingSessions: Promise<void> | null = null
  private reloadPromise: Promise<void> | null = null
  private snapshotting = new Set<string>()
  private buffered = new Map<string, AgentEventEnvelope[]>()
  private unsubscribe: (() => void) | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): ChatStoreState => this.state

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    this.unsubscribe = window.api.agent.onEvent((envelope) => {
      this.handleEnvelope(envelope)
    })

    try {
      const status = await window.api.agent.status()
      this.setState({ status })
    } catch (error) {
      this.setState({ status: { status: 'error', error: errorMessage(error) } })
    }

    try {
      const info = await window.api.agent.info()
      this.setState({ info })
    } catch {
      /* the info panel is optional */
    }

    await this.refreshModels()
    await this.loadSessions()

    try {
      const permissions = await window.api.agent.permissions.list()
      this.setState({ permissions })
    } catch {
      /* permissions are unavailable until the agent is ready */
    }

    this.initialized = true
    if (this.state.status.status === 'ready' && this.state.sessions.length === 0) {
      await this.loadSessions()
    }
  }

  async refreshModels(): Promise<void> {
    try {
      const models = await window.api.models.get()
      this.setState({ models })
    } catch {
      /* the composer will show the missing configuration */
    }
  }

  async loadSessions(): Promise<void> {
    if (this.loadingSessions) return this.loadingSessions
    this.loadingSessions = this.doLoadSessions()
    try {
      await this.loadingSessions
    } finally {
      this.loadingSessions = null
    }
  }

  private async doLoadSessions(): Promise<void> {
    try {
      const sessions = sortSessions(await window.api.agent.sessions.list())
      const current = this.state.selectedSessionId
      const stillExists = Boolean(current && sessions.some((session) => session.id === current))
      const selected = stillExists ? current : (sessions[0]?.id ?? null)
      this.setState({ sessions, selectedSessionId: selected })
      if (selected && !this.state.loadedBySession[selected]) {
        await this.loadMessages(selected)
      }
    } catch (error) {
      if (this.state.status.status === 'ready') {
        this.setState({ actionError: errorMessage(error) })
      }
    }
  }

  async loadMessages(sessionId: string): Promise<void> {
    if (this.snapshotting.has(sessionId)) return
    this.snapshotting.add(sessionId)
    let snapshot: MessagesSnapshot | null = null
    try {
      snapshot = await window.api.agent.messages.list(sessionId)
      this.setState({
        messagesBySession: { ...this.state.messagesBySession, [sessionId]: snapshot.messages },
        loadedBySession: { ...this.state.loadedBySession, [sessionId]: true }
      })
    } catch (error) {
      this.setState({ actionError: errorMessage(error) })
    } finally {
      const pending = this.buffered.get(sessionId) ?? []
      this.buffered.delete(sessionId)
      this.snapshotting.delete(sessionId)
      for (const envelope of pending) {
        if (!snapshot || envelope.seq > snapshot.seq) {
          this.applyEvent(envelope.event)
        }
      }
    }
  }

  selectSession(sessionId: string): void {
    this.setState({ selectedSessionId: sessionId })
    if (!this.state.loadedBySession[sessionId]) {
      void this.loadMessages(sessionId)
    }
  }

  async createSession(): Promise<SessionMeta> {
    const session = await window.api.agent.sessions.create()
    this.upsertSession(session)
    this.setState({
      selectedSessionId: session.id,
      messagesBySession: { ...this.state.messagesBySession, [session.id]: [] },
      loadedBySession: { ...this.state.loadedBySession, [session.id]: true },
      actionError: null
    })
    return session
  }

  async ensureSession(): Promise<SessionMeta> {
    const selected = this.state.sessions.find(
      (session) => session.id === this.state.selectedSessionId
    )
    if (selected) return selected
    return this.createSession()
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const session = await window.api.agent.sessions.rename(sessionId, title)
    this.upsertSession(session)
  }

  async deleteSession(sessionId: string): Promise<void> {
    await window.api.agent.sessions.remove(sessionId)
    this.applySessionDeleted(sessionId)
  }

  async setSessionModel(sessionId: string, model: ModelRef): Promise<void> {
    const session = await window.api.agent.sessions.setModel(sessionId, model)
    this.upsertSession(session)
  }

  async send(text: string): Promise<void> {
    const content = text.trim()
    if (!content) return
    if (this.state.status.status !== 'ready') {
      throw new Error('AGENT_NOT_READY')
    }
    const session = await this.ensureSession()
    await window.api.agent.chat.send({ sessionId: session.id, text: content })
  }

  async stop(): Promise<void> {
    const sessionId = this.state.selectedSessionId
    if (!sessionId) return
    await window.api.agent.chat.stop(sessionId)
  }

  async retry(): Promise<void> {
    const sessionId = this.state.selectedSessionId
    if (!sessionId) return
    await window.api.agent.chat.retry(sessionId)
  }

  async replyPermission(requestId: string, decision: PermissionDecision): Promise<void> {
    await window.api.agent.permissions.reply(requestId, decision)
  }

  async restartAgent(): Promise<void> {
    if (this.state.restarting) return
    this.setState({ restarting: true, actionError: null })
    try {
      const status = await window.api.agent.restart()
      this.setState({ status })
      if (status.status === 'ready') {
        await this.reloadAfterReady()
      }
    } catch (error) {
      this.setState({ actionError: errorMessage(error) })
    } finally {
      this.setState({ restarting: false })
    }
  }

  clearActionError(): void {
    this.setState({ actionError: null })
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.listeners.clear()
  }

  private async reloadAfterReady(): Promise<void> {
    if (this.reloadPromise) return this.reloadPromise
    this.reloadPromise = (async () => {
      this.setState({
        messagesBySession: {},
        loadedBySession: {},
        permissions: [],
        runOutcomes: {}
      })
      await this.loadSessions()
      try {
        const permissions = await window.api.agent.permissions.list()
        this.setState({ permissions })
      } catch {
        /* ignore */
      }
      await this.refreshModels()
    })()
    try {
      await this.reloadPromise
    } finally {
      this.reloadPromise = null
    }
  }

  private handleEnvelope(envelope: AgentEventEnvelope): void {
    const event = envelope.event
    if (event.type === 'agent.status') {
      this.applyStatus(event.status)
      return
    }

    const sessionId = eventSessionId(event)
    if (sessionId && this.snapshotting.has(sessionId)) {
      const pending = this.buffered.get(sessionId) ?? []
      pending.push(envelope)
      this.buffered.set(sessionId, pending)
      return
    }

    this.applyEvent(event)
  }

  private applyStatus(status: AgentStatus): void {
    const wasReady = this.state.status.status === 'ready'
    this.setState({ status })
    if (!wasReady && status.status === 'ready' && this.initialized) {
      void this.reloadAfterReady()
    }
  }

  private applyEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent.status':
        this.applyStatus(event.status)
        break
      case 'session.upsert':
        this.upsertSession(event.session)
        break
      case 'session.deleted':
        this.applySessionDeleted(event.sessionId)
        break
      case 'message.upsert':
        this.upsertMessage(event.message)
        break
      case 'message.part.upsert': {
        const messages = this.state.messagesBySession[event.sessionId]
        if (!messages) break
        const index = messages.findIndex((message) => message.id === event.messageId)
        if (index < 0) break
        const message = messages[index]
        const parts = [...message.parts]
        if (event.partIndex < parts.length) {
          parts[event.partIndex] = event.part
        } else if (event.partIndex === parts.length) {
          parts.push(event.part)
        } else {
          break
        }
        this.replaceMessage(event.sessionId, index, {
          ...message,
          parts,
          updatedAt: new Date().toISOString()
        })
        break
      }
      case 'message.part.delta': {
        const messages = this.state.messagesBySession[event.sessionId]
        if (!messages) break
        const index = messages.findIndex((message) => message.id === event.messageId)
        if (index < 0) break
        const message = messages[index]
        const parts = [...message.parts]
        const current = parts[event.partIndex]
        if (event.kind === 'text') {
          if (current?.type === 'text') {
            parts[event.partIndex] = { ...current, text: current.text + event.delta }
          } else if (!current) {
            parts[event.partIndex] = { type: 'text', text: event.delta }
          } else {
            break
          }
        } else {
          if (current?.type === 'reasoning') {
            parts[event.partIndex] = { ...current, text: current.text + event.delta }
          } else if (!current) {
            parts[event.partIndex] = { type: 'reasoning', text: event.delta }
          } else {
            break
          }
        }
        this.replaceMessage(event.sessionId, index, {
          ...message,
          parts,
          updatedAt: new Date().toISOString()
        })
        break
      }
      case 'permission.asked': {
        const exists = this.state.permissions.some(
          (permission) => permission.id === event.permission.id
        )
        this.setState({
          permissions: exists
            ? this.state.permissions.map((permission) =>
                permission.id === event.permission.id ? event.permission : permission
              )
            : [...this.state.permissions, event.permission]
        })
        break
      }
      case 'permission.replied':
        this.setState({
          permissions: this.state.permissions.filter(
            (permission) => permission.id !== event.requestId
          )
        })
        break
      case 'run.started': {
        const runOutcomes = { ...this.state.runOutcomes }
        delete runOutcomes[event.messageId]
        this.setState({ runOutcomes })
        break
      }
      case 'run.finished':
        this.setState({
          runOutcomes: { ...this.state.runOutcomes, [event.messageId]: event.status },
          permissions: this.state.permissions.filter(
            (permission) => permission.sessionId !== event.sessionId
          )
        })
        break
      default:
        break
    }
  }

  private upsertSession(session: SessionMeta): void {
    const sessions = sortSessions([
      session,
      ...this.state.sessions.filter((candidate) => candidate.id !== session.id)
    ])
    this.setState({ sessions })
  }

  private applySessionDeleted(sessionId: string): void {
    const previousSelected = this.state.selectedSessionId
    const sessions = this.state.sessions.filter((session) => session.id !== sessionId)
    if (sessions.length === this.state.sessions.length) return
    const selected = previousSelected === sessionId ? (sessions[0]?.id ?? null) : previousSelected
    const messagesBySession = { ...this.state.messagesBySession }
    const loadedBySession = { ...this.state.loadedBySession }
    delete messagesBySession[sessionId]
    delete loadedBySession[sessionId]
    this.setState({ sessions, selectedSessionId: selected, messagesBySession, loadedBySession })
    if (selected && selected !== previousSelected && !loadedBySession[selected]) {
      void this.loadMessages(selected)
    }
  }

  private upsertMessage(message: ChatMessage): void {
    const messages = this.state.messagesBySession[message.sessionId]
    if (!messages) return
    const index = messages.findIndex((candidate) => candidate.id === message.id)
    if (index < 0) {
      this.setState({
        messagesBySession: {
          ...this.state.messagesBySession,
          [message.sessionId]: [...messages, message]
        }
      })
      return
    }
    this.replaceMessage(message.sessionId, index, message)
  }

  private replaceMessage(sessionId: string, index: number, message: ChatMessage): void {
    const messages = this.state.messagesBySession[sessionId]
    if (!messages) return
    const next = [...messages]
    next[index] = message
    this.setState({
      messagesBySession: { ...this.state.messagesBySession, [sessionId]: next }
    })
  }

  private setState(partial: Partial<ChatStoreState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const chatStore = new ChatStore()

export function useChatStore(): ChatStoreState {
  return useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getSnapshot)
}
