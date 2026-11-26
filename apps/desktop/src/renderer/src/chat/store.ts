import { errorMessage } from '../lib/errors'
import { useSyncExternalStore } from 'react'
import type {
  AgentDefinition,
  AgentEvent,
  AgentEventEnvelope,
  AgentInfo,
  AgentStatus,
  BackgroundTaskInfo,
  ChatMessage,
  CommandDefinition,
  MessagesSnapshot,
  ModelRef,
  ModelsConfigPublic,
  MessageAttachment,
  PermissionDecision,
  PermissionRequest,
  QueuedMessage,
  QuestionAnswer,
  QuestionRequest,
  RunOutcome,
  SessionMeta,
  SessionSettings,
  SteerStrategy,
  SubagentResult
} from '@ateam/shared'

export interface ChatStoreState {
  status: AgentStatus
  info: AgentInfo | null
  models: ModelsConfigPublic | null
  agents: AgentDefinition[]
  commands: CommandDefinition[]
  sessions: SessionMeta[]
  selectedSessionId: string | null
  configRevision: number
  messagesBySession: Record<string, ChatMessage[] | undefined>
  loadedBySession: Record<string, boolean>
  loadErrorsBySession?: Record<string, string>
  queuesBySession: Record<string, QueuedMessage[] | undefined>
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  runOutcomes: Record<string, RunOutcome>
  backgroundTasksBySession: Record<string, BackgroundTaskInfo[] | undefined>
  subagentResults: SubagentResult[]
  actionError: string | null
  restarting: boolean
  revertPrompt: string | null
  changesPanel: { sessionId: string; messageId: string | null; tab: ChangesTab } | null
}

/** Which diff source the changes panel shows. */
export type ChangesTab = 'session' | 'git'

const INITIAL_STATUS: AgentStatus = { status: 'stopped' }

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
    case 'chat.queue':
    case 'background.finished':
    case 'background.updated':
      return event.sessionId
    case 'permission.asked':
      return event.permission.sessionId
    case 'question.asked':
      return event.question.sessionId
    case 'question.replied':
      return event.sessionId
    case 'subagent.finished':
      return event.parentSessionId
    default:
      return null
  }
}

export class ChatStore {
  private state: ChatStoreState = {
    status: INITIAL_STATUS,
    info: null,
    models: null,
    agents: [],
    commands: [],
    sessions: [],
    selectedSessionId: null,
    configRevision: 0,
    messagesBySession: {},
    loadedBySession: {},
    loadErrorsBySession: {},
    queuesBySession: {},
    permissions: [],
    questions: [],
    runOutcomes: {},
    backgroundTasksBySession: {},
    subagentResults: [],
    actionError: null,
    restarting: false,
    revertPrompt: null,
    changesPanel: null
  }

  private listeners = new Set<() => void>()
  private initialized = false
  private initPromise: Promise<void> | null = null
  private loadingSessions: Promise<void> | null = null
  private reloadPromise: Promise<void> | null = null
  private commandsDirectory: string | null = null
  private commandsRequest = 0
  private agentsDirectory: string | null = null
  private agentsRequest = 0
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
    const selected = this.state.sessions.find(
      (session) => session.id === this.state.selectedSessionId
    )
    await this.refreshAgents(selected?.directory ?? undefined)
    await this.refreshCommands(selected?.directory ?? undefined)

    try {
      const permissions = await window.api.agent.permissions.list()
      this.setState({ permissions })
    } catch {
      /* permissions are unavailable until the agent is ready */
    }
    try {
      this.setState({ questions: await window.api.agent.questions.list() })
    } catch {
      /* questions are unavailable until the agent is ready */
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

  async refreshAgents(directory?: string | null, force = false): Promise<void> {
    const key = directory ?? ''
    if (!force && this.agentsDirectory === key && this.state.agents.length > 0) return
    this.agentsDirectory = key
    const request = ++this.agentsRequest
    try {
      const agents = await window.api.agent.agents(directory ?? undefined)
      if (request === this.agentsRequest) this.setState({ agents })
    } catch {
      /* agent discovery is best effort */
    }
  }

  async refreshCommands(directory?: string | null, force = false): Promise<void> {
    const key = directory ?? ''
    if (!force && this.commandsDirectory === key && this.state.commands.length > 0) return
    this.commandsDirectory = key
    const request = ++this.commandsRequest
    try {
      const commands = await window.api.agent.commands.list(directory ?? undefined)
      if (request === this.commandsRequest) this.setState({ commands })
    } catch {
      if (request === this.commandsRequest) this.setState({ commands: [] })
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
      if (selected && selected !== current) {
        const session = sessions.find((candidate) => candidate.id === selected)
        void this.refreshAgents(session?.directory ?? undefined)
        void this.refreshCommands(session?.directory ?? undefined)
      }
      if (selected) void this.loadBackgroundTasks(selected)
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
      const loadErrors = { ...(this.state.loadErrorsBySession ?? {}) }
      delete loadErrors[sessionId]
      this.setState({
        messagesBySession: { ...this.state.messagesBySession, [sessionId]: snapshot.messages },
        loadedBySession: { ...this.state.loadedBySession, [sessionId]: true },
        loadErrorsBySession: loadErrors,
        queuesBySession: {
          ...this.state.queuesBySession,
          [sessionId]: snapshot.queued ?? []
        }
      })
    } catch (error) {
      this.setState({
        messagesBySession: {
          ...this.state.messagesBySession,
          [sessionId]: this.state.messagesBySession[sessionId] ?? []
        },
        loadedBySession: { ...this.state.loadedBySession, [sessionId]: true },
        loadErrorsBySession: {
          ...(this.state.loadErrorsBySession ?? {}),
          [sessionId]: errorMessage(error)
        }
      })
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
    this.setState({ selectedSessionId: sessionId, changesPanel: null })
    const session = this.state.sessions.find((candidate) => candidate.id === sessionId)
    void this.refreshAgents(session?.directory ?? undefined)
    void this.refreshCommands(session?.directory ?? undefined)
    void this.loadBackgroundTasks(sessionId)
    if (!this.state.loadedBySession[sessionId]) {
      void this.loadMessages(sessionId)
    }
  }

  async loadBackgroundTasks(sessionId: string): Promise<void> {
    try {
      const tasks = await window.api.agent.background.list(sessionId)
      const current = this.state.backgroundTasksBySession[sessionId] ?? []
      const merged = [...tasks]
      for (const task of current) {
        const index = merged.findIndex((candidate) => candidate.id === task.id)
        if (index < 0) merged.push(task)
        else merged[index] = task
      }
      this.setState({
        backgroundTasksBySession: {
          ...this.state.backgroundTasksBySession,
          [sessionId]: merged
        }
      })
    } catch {
      /* background tasks are unavailable until the agent is ready */
    }
  }

  async cancelBackgroundTask(taskId: string): Promise<void> {
    await window.api.agent.background.cancel(taskId)
  }

  async createSession(directory?: string | null): Promise<SessionMeta> {
    const session = await window.api.agent.sessions.create(directory)
    this.upsertSession(session)
    this.setState({
      selectedSessionId: session.id,
      messagesBySession: { ...this.state.messagesBySession, [session.id]: [] },
      loadedBySession: { ...this.state.loadedBySession, [session.id]: true },
      backgroundTasksBySession: { ...this.state.backgroundTasksBySession, [session.id]: [] },
      actionError: null,
      changesPanel: null
    })
    void this.refreshAgents(session.directory ?? undefined)
    void this.refreshCommands(session.directory ?? undefined)
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

  async setSessionDirectory(sessionId: string, directory: string | null): Promise<void> {
    const session = await window.api.agent.sessions.setDirectory(sessionId, directory)
    this.upsertSession(session)
  }

  async setSessionSettings(sessionId: string, settings: SessionSettings): Promise<void> {
    const session = await window.api.agent.sessions.setSettings(sessionId, settings)
    this.upsertSession(session)
  }

  async setSessionAgent(sessionId: string, agent: string | null): Promise<void> {
    const session = await window.api.agent.sessions.setAgent(sessionId, agent)
    this.upsertSession(session)
  }

  async forkSession(messageId?: string): Promise<SessionMeta> {
    const sessionId = this.state.selectedSessionId
    if (!sessionId) throw new Error('NO_SESSION')
    const session = await window.api.agent.sessions.fork(sessionId, messageId)
    this.upsertSession(session)
    this.selectSession(session.id)
    await this.loadMessages(session.id)
    return session
  }

  async compactSession(): Promise<void> {
    const sessionId = this.state.selectedSessionId
    if (!sessionId) return
    const session = await window.api.agent.sessions.compact(sessionId)
    this.upsertSession(session)
  }

  async undoSession(messageId?: string, stepIndex?: number): Promise<string | null> {
    const sessionId = this.state.selectedSessionId
    if (!sessionId) return null
    const result =
      stepIndex !== undefined
        ? await window.api.agent.sessions.undo(sessionId, messageId, stepIndex)
        : messageId
          ? await window.api.agent.sessions.undo(sessionId, messageId)
          : await window.api.agent.sessions.undo(sessionId)
    this.upsertSession(result.session)
    await this.loadMessages(sessionId)
    const prompt = result.prompt || null
    this.setState({ revertPrompt: prompt })
    return prompt
  }

  /** Rewinds the latest assistant turn to the end of one recorded step. */
  async undoToStep(messageId: string, stepIndex: number): Promise<void> {
    await this.undoSession(messageId, stepIndex)
  }

  async redoSession(): Promise<void> {
    const sessionId = this.state.selectedSessionId
    if (!sessionId) return
    const session = await window.api.agent.sessions.redo(sessionId)
    this.upsertSession(session)
    await this.loadMessages(sessionId)
  }

  clearRevertPrompt(): void {
    this.setState({ revertPrompt: null })
  }

  openChanges(sessionId: string, messageId: string): void {
    this.setState({ changesPanel: { sessionId, messageId, tab: 'session' } })
  }

  /** Opens the read-only summary of every turn that changed files. */
  openSessionChanges(sessionId: string): void {
    this.setState({ changesPanel: { sessionId, messageId: null, tab: 'session' } })
  }

  /** Opens the read-only Git working tree view. */
  openGitChanges(sessionId: string): void {
    this.setState({ changesPanel: { sessionId, messageId: null, tab: 'git' } })
  }

  setChangesTab(tab: ChangesTab): void {
    if (!this.state.changesPanel) return
    this.setState({ changesPanel: { ...this.state.changesPanel, tab } })
  }

  closeChanges(): void {
    this.setState({ changesPanel: null })
  }

  dismissSubagentResult(toolCallId: string): void {
    this.setState({
      subagentResults: this.state.subagentResults.filter(
        (result) => result.toolCallId !== toolCallId
      )
    })
  }

  async send(text: string, attachments: MessageAttachment[] = []): Promise<void> {
    const content = text.trim()
    if (!content && attachments.length === 0) return
    if (this.state.status.status !== 'ready') {
      throw new Error('AGENT_NOT_READY')
    }
    const session = await this.ensureSession()
    await window.api.agent.chat.send({
      sessionId: session.id,
      text: content,
      ...(attachments.length > 0 ? { attachments } : {})
    })
  }

  /** Runs a subtask command in a hidden child session of the selected session. */
  async runCommand(name: string, args?: string): Promise<void> {
    const session = await this.ensureSession()
    const value = args?.trim() ?? ''
    await window.api.agent.commands.run({
      sessionId: session.id,
      name,
      ...(value ? { args: value } : {})
    })
    void this.loadBackgroundTasks(session.id)
  }

  async stop(): Promise<void> {
    const sessionId = this.state.selectedSessionId
    if (!sessionId) return
    await window.api.agent.chat.stop(sessionId)
  }

  async steer(
    text: string,
    strategy: SteerStrategy,
    attachments: MessageAttachment[] = []
  ): Promise<QueuedMessage> {
    const content = text.trim()
    const session = await this.ensureSession()
    // The runtime emits `chat.queue` for every queue mutation, including the
    // immediate drain when the run already finished; no optimistic merge here
    // so a message that was sent right away is not left showing as queued.
    return window.api.agent.chat.steer({
      sessionId: session.id,
      text: content,
      strategy,
      ...(attachments.length > 0 ? { attachments } : {})
    })
  }

  async removeQueued(sessionId: string, id: string): Promise<void> {
    await window.api.agent.chat.removeQueued(sessionId, id)
  }

  async retry(): Promise<void> {
    const sessionId = this.state.selectedSessionId
    if (!sessionId) return
    await window.api.agent.chat.retry(sessionId)
  }

  async replyPermission(requestId: string, decision: PermissionDecision): Promise<void> {
    await window.api.agent.permissions.reply(requestId, decision)
  }

  async replyQuestion(questionId: string, answer: QuestionAnswer): Promise<void> {
    await window.api.agent.questions.reply(questionId, answer)
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
        questions: [],
        runOutcomes: {},
        queuesBySession: {},
        backgroundTasksBySession: {},
        subagentResults: [],
        revertPrompt: null
      })
      await this.loadSessions()
      try {
        const permissions = await window.api.agent.permissions.list()
        this.setState({ permissions })
      } catch {
        /* ignore */
      }
      try {
        this.setState({ questions: await window.api.agent.questions.list() })
      } catch {
        /* questions are unavailable until the agent is ready */
      }
      await this.refreshModels()
      const selected = this.state.sessions.find(
        (session) => session.id === this.state.selectedSessionId
      )
      await this.refreshAgents(selected?.directory ?? undefined, true)
      await this.refreshCommands(selected?.directory ?? undefined, true)
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
    const isMessageEvent =
      event.type === 'message.upsert' ||
      event.type === 'message.part.upsert' ||
      event.type === 'message.part.delta'
    if (sessionId && isMessageEvent && this.snapshotting.has(sessionId)) {
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
      case 'config.changed':
        this.setState({ configRevision: this.state.configRevision + 1 })
        break
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
        } else if (event.kind === 'tool-output') {
          if (current?.type === 'tool') {
            parts[event.partIndex] = {
              ...current,
              output: (current.output ?? '') + event.delta
            }
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
      case 'question.asked': {
        const exists = this.state.questions.some((question) => question.id === event.question.id)
        this.setState({
          questions: exists
            ? this.state.questions.map((question) =>
                question.id === event.question.id ? event.question : question
              )
            : [...this.state.questions, event.question]
        })
        break
      }
      case 'question.replied':
        this.setState({
          questions: this.state.questions.filter((question) => question.id !== event.questionId)
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
      case 'chat.queue':
        this.setState({
          queuesBySession: { ...this.state.queuesBySession, [event.sessionId]: event.items }
        })
        break
      case 'subagent.finished': {
        const result: SubagentResult = {
          sessionId: event.sessionId,
          parentSessionId: event.parentSessionId,
          toolCallId: event.toolCallId,
          agentId: event.agentId,
          status: event.status,
          result: event.result
        }
        this.setState({
          subagentResults: [...this.state.subagentResults, result].slice(-15)
        })
        break
      }
      case 'background.updated': {
        const tasks = this.state.backgroundTasksBySession[event.sessionId] ?? []
        const next = [...tasks.filter((task) => task.id !== event.task.id), event.task]
        this.setState({
          backgroundTasksBySession: {
            ...this.state.backgroundTasksBySession,
            [event.sessionId]: next
          }
        })
        break
      }
      default:
        break
    }
  }

  private upsertSession(session: SessionMeta): void {
    const previous = this.state.sessions.find((candidate) => candidate.id === session.id)
    const sessions = sortSessions([
      session,
      ...this.state.sessions.filter((candidate) => candidate.id !== session.id)
    ])
    this.setState({ sessions })
    if (
      previous &&
      previous.directory !== session.directory &&
      session.id === this.state.selectedSessionId
    ) {
      void this.refreshAgents(session.directory ?? undefined)
      void this.refreshCommands(session.directory ?? undefined)
    }
  }

  private applySessionDeleted(sessionId: string): void {
    const previousSelected = this.state.selectedSessionId
    const sessions = this.state.sessions.filter((session) => session.id !== sessionId)
    if (sessions.length === this.state.sessions.length) return
    const selected = previousSelected === sessionId ? (sessions[0]?.id ?? null) : previousSelected
    const messagesBySession = { ...this.state.messagesBySession }
    const loadedBySession = { ...this.state.loadedBySession }
    const queuesBySession = { ...this.state.queuesBySession }
    const backgroundTasksBySession = { ...this.state.backgroundTasksBySession }
    delete messagesBySession[sessionId]
    delete loadedBySession[sessionId]
    delete queuesBySession[sessionId]
    delete backgroundTasksBySession[sessionId]
    this.setState({
      sessions,
      selectedSessionId: selected,
      messagesBySession,
      loadedBySession,
      queuesBySession,
      backgroundTasksBySession,
      changesPanel: null
    })
    if (selected && selected !== previousSelected) {
      const fallback = sessions.find((session) => session.id === selected)
      void this.refreshAgents(fallback?.directory ?? undefined)
      void this.refreshCommands(fallback?.directory ?? undefined)
      if (!loadedBySession[selected]) void this.loadMessages(selected)
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
