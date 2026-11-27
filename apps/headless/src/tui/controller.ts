import type {
  AgentEvent,
  ChatMessage,
  MessagePart,
  ModelRef,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  ReasoningEffort,
  SessionMeta
} from '@ateam/shared'
import type { TuiBackend } from './backend'

export type TuiFocus = 'sessions' | 'input'
export type TuiOverlay = 'help' | 'permission' | 'question' | null

/** Key object produced by Node's readline `keypress` event. */
export interface TuiKey {
  sequence?: string
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

export interface TuiState {
  mode: 'local' | 'attach'
  /** Model id (local) or server URL (attach). */
  label: string
  workspace: string
  sessions: SessionMeta[]
  currentId: string | null
  messages: ChatMessage[]
  running: boolean
  queued: number
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  focus: TuiFocus
  sessionIndex: number
  overlay: TuiOverlay
  permissionIndex: number
  questionIndex: number
  questionSelected: number[]
  /** Non-null while typing a custom question answer. */
  questionCustom: string | null
  questionCursor: number
  input: string
  cursor: number
  /** Lines scrolled up from the bottom of the transcript. */
  scroll: number
  /** Scroll ceiling reported by the renderer. */
  scrollLimit: number
  notice: string | null
  error: string | null
  quitting: boolean
  permissionMode: PermissionMode
  reasoningEffort: ReasoningEffort | null
  agent: string | null
  rows: number
  columns: number
}

export interface TuiStateOptions {
  mode: 'local' | 'attach'
  label: string
  workspace: string
  permissionMode: PermissionMode
  reasoningEffort: ReasoningEffort | null
  agent: string | null
  rows?: number
  columns?: number
}

/** Initial controller state; exported so renderer tests can build fixtures. */
export function createTuiState(options: TuiStateOptions): TuiState {
  return {
    mode: options.mode,
    label: options.label,
    workspace: options.workspace,
    sessions: [],
    currentId: null,
    messages: [],
    running: false,
    queued: 0,
    permissions: [],
    questions: [],
    focus: 'input',
    sessionIndex: 0,
    overlay: null,
    permissionIndex: 0,
    questionIndex: 0,
    questionSelected: [],
    questionCustom: null,
    questionCursor: 0,
    input: '',
    cursor: 0,
    scroll: 0,
    scrollLimit: 0,
    notice: null,
    error: null,
    quitting: false,
    permissionMode: options.permissionMode,
    reasoningEffort: options.reasoningEffort,
    agent: options.agent,
    rows: options.rows ?? 24,
    columns: options.columns ?? 80
  }
}

export interface TuiControllerOptions {
  backend: TuiBackend
  sessionId?: string | null
  permissionMode: PermissionMode
  reasoningEffort: ReasoningEffort | null
  agent: string | null
  model: ModelRef | null
  label: string
  workspace: string
  rows?: number
  columns?: number
  onChange?: () => void
  onQuit?: () => void
}

export const PERMISSION_CHOICES: readonly {
  label: string
  hint: string
  decision: PermissionDecision
}[] = [
  { label: '允许一次', hint: 'y', decision: 'once' },
  { label: '始终允许', hint: 'a', decision: 'always' },
  { label: '拒绝', hint: 'n', decision: 'reject' }
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function insertMessage(messages: ChatMessage[], message: ChatMessage): void {
  const index = messages.findIndex((candidate) => candidate.id === message.id)
  if (index >= 0) {
    messages[index] = message
    return
  }
  messages.push(message)
  for (let position = messages.length - 1; position > 0; position -= 1) {
    if (messages[position - 1].createdAt <= messages[position].createdAt) break
    ;[messages[position - 1], messages[position]] = [messages[position], messages[position - 1]]
  }
}

function sortSessions(sessions: SessionMeta[]): SessionMeta[] {
  return [...sessions].sort((a, b) => {
    const byUpdated = b.updatedAt.localeCompare(a.updatedAt)
    return byUpdated || a.id.localeCompare(b.id)
  })
}

function isEnter(key: TuiKey): boolean {
  return key.name === 'return' || key.name === 'enter'
}

function isPrintable(key: TuiKey): boolean {
  if (key.ctrl || key.meta) return false
  const sequence = key.sequence
  if (!sequence) return false
  if (sequence.startsWith('\x1b')) return false
  for (const char of sequence) {
    const code = char.codePointAt(0) ?? 0
    if (code < 32 || code === 127) return false
  }
  return true
}

function applyTextEdit(
  value: string,
  cursor: number,
  key: TuiKey
): { value: string; cursor: number } | null {
  if (key.name === 'left') return { value, cursor: Math.max(0, cursor - 1) }
  if (key.name === 'right') return { value, cursor: Math.min(value.length, cursor + 1) }
  if (key.name === 'home') return { value, cursor: 0 }
  if (key.name === 'end') return { value, cursor: value.length }
  if (key.name === 'backspace') {
    if (cursor === 0) return { value, cursor }
    return { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 }
  }
  if (key.name === 'delete') {
    return { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor }
  }
  if (key.ctrl && key.name === 'u') {
    return { value: value.slice(cursor), cursor: 0 }
  }
  if (key.ctrl && key.name === 'k') {
    return { value: value.slice(0, cursor), cursor }
  }
  if (key.ctrl && key.name === 'w') {
    const before = value.slice(0, cursor)
    const trimmed = before.replace(/\s*\S*$/, '')
    return { value: trimmed + value.slice(cursor), cursor: trimmed.length }
  }
  if (isPrintable(key)) {
    const sequence = key.sequence ?? ''
    return {
      value: value.slice(0, cursor) + sequence + value.slice(cursor),
      cursor: cursor + sequence.length
    }
  }
  return null
}

/**
 * Owns every piece of TUI state. Rendering and terminal handling stay outside,
 * so the whole interaction model is testable without a pty.
 */
export class TuiController {
  readonly state: TuiState
  private unsubscribe: (() => void) | null = null
  private started = false
  private creating = false
  private shutDown = false

  constructor(private readonly options: TuiControllerOptions) {
    this.state = createTuiState({
      mode: options.backend.mode,
      label: options.label,
      workspace: options.workspace,
      permissionMode: options.permissionMode,
      reasoningEffort: options.reasoningEffort,
      agent: options.agent,
      rows: options.rows,
      columns: options.columns
    })
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.options.backend.init()
    this.unsubscribe = this.options.backend.subscribe({
      event: (event) => this.applyEvent(event),
      resync: () => void this.resync()
    })
    const [sessions, permissions, questions] = await Promise.all([
      this.options.backend.listSessions(),
      this.options.backend.permissions(),
      this.options.backend.questions()
    ])
    this.state.sessions = sortSessions(sessions)
    this.state.permissions = permissions
    this.state.questions = questions

    const requested = this.options.sessionId
    if (requested && !sessions.some((session) => session.id === requested)) {
      this.state.notice = `未找到会话 ${requested}，已打开最近的会话`
    }
    const target =
      (requested && sessions.find((session) => session.id === requested)?.id) ??
      this.state.sessions[0]?.id ??
      null
    if (target) {
      await this.openSession(target)
    } else {
      await this.newSession()
    }
    this.maybeOpenPending()
    this.changed()
  }

  setViewport(rows: number, columns: number): void {
    this.state.rows = rows
    this.state.columns = columns
  }

  setScrollLimit(limit: number): void {
    this.state.scrollLimit = Math.max(0, limit)
    if (this.state.scroll > this.state.scrollLimit) this.state.scroll = this.state.scrollLimit
  }

  handleKey(key: TuiKey): void {
    if (this.state.quitting) return
    if (this.state.overlay) {
      this.handleOverlayKey(key)
      return
    }
    if (key.ctrl) {
      this.handleCtrlKey(key)
      return
    }
    if (this.state.focus === 'sessions') {
      this.handleSessionKey(key)
      return
    }
    this.handleInputKey(key)
  }

  async shutdown(): Promise<void> {
    if (this.shutDown) return
    this.shutDown = true
    this.unsubscribe?.()
    this.unsubscribe = null
    await this.options.backend.shutdown()
  }

  /** Pending permission for the visible session, if any. */
  currentPermission(): PermissionRequest | null {
    return (
      this.state.permissions.find((request) => request.sessionId === this.state.currentId) ?? null
    )
  }

  currentQuestion(): QuestionRequest | null {
    return (
      this.state.questions.find((request) => request.sessionId === this.state.currentId) ?? null
    )
  }

  // ---------------------------------------------------------------- sessions

  private async openSession(id: string): Promise<void> {
    this.state.currentId = id
    this.state.messages = []
    this.state.running = false
    this.state.queued = 0
    this.state.scroll = 0
    this.state.error = null
    this.state.focus = 'input'
    this.state.sessionIndex = Math.max(
      0,
      this.state.sessions.findIndex((session) => session.id === id)
    )
    this.maybeOpenPending()
    this.changed()
    try {
      const snapshot = await this.options.backend.messages(id)
      if (this.state.currentId !== id) return
      this.state.messages = snapshot.messages
      this.state.running = snapshot.running
      this.state.queued = snapshot.queued?.length ?? 0
      this.maybeOpenPending()
    } catch (error) {
      this.fail(error)
    }
    this.changed()
  }

  private async newSession(): Promise<void> {
    if (this.creating) return
    this.creating = true
    this.state.error = null
    try {
      const session = await this.options.backend.createSession({
        permissionMode: this.state.permissionMode,
        reasoningEffort: this.state.reasoningEffort,
        agent: this.state.agent,
        model: this.options.model
      })
      this.upsertSession(session)
      this.state.notice = null
      this.changed()
      await this.openSession(session.id)
    } catch (error) {
      this.fail(error)
      this.changed()
    } finally {
      this.creating = false
    }
  }

  private cycleSession(delta: number): void {
    if (this.state.sessions.length === 0) {
      void this.newSession()
      return
    }
    const current = this.state.sessions.findIndex((session) => session.id === this.state.currentId)
    const index =
      (Math.max(0, current) + delta + this.state.sessions.length) % this.state.sessions.length
    this.state.sessionIndex = index
    void this.openSession(this.state.sessions[index].id)
  }

  private upsertSession(session: SessionMeta): void {
    const index = this.state.sessions.findIndex((candidate) => candidate.id === session.id)
    if (index >= 0) this.state.sessions[index] = session
    else this.state.sessions.push(session)
    this.state.sessions = sortSessions(this.state.sessions)
    if (this.state.currentId === session.id) {
      this.state.sessionIndex = Math.max(
        0,
        this.state.sessions.findIndex((candidate) => candidate.id === session.id)
      )
    }
  }

  private async resync(): Promise<void> {
    try {
      const [sessions, permissions, questions] = await Promise.all([
        this.options.backend.listSessions(),
        this.options.backend.permissions(),
        this.options.backend.questions()
      ])
      this.state.sessions = sortSessions(sessions)
      this.state.permissions = permissions
      this.state.questions = questions
      const id = this.state.currentId
      if (!id) return
      const snapshot = await this.options.backend.messages(id)
      if (this.state.currentId !== id) return
      this.state.messages = snapshot.messages
      this.state.running = snapshot.running
      this.state.queued = snapshot.queued?.length ?? 0
      this.state.notice = '连接已恢复'
      this.maybeOpenPending()
      this.changed()
    } catch (error) {
      this.fail(error)
      this.changed()
    }
  }

  // ------------------------------------------------------------------ events

  private applyEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'session.upsert':
        this.upsertSession(event.session)
        break
      case 'session.deleted':
        this.state.sessions = this.state.sessions.filter(
          (session) => session.id !== event.sessionId
        )
        if (this.state.currentId === event.sessionId) {
          this.state.currentId = null
          this.state.messages = []
          const next = this.state.sessions[0]
          if (next) void this.openSession(next.id)
          else void this.newSession()
        }
        break
      case 'message.upsert':
        if (event.message.sessionId === this.state.currentId) {
          const isNewUser = event.message.role === 'user'
          insertMessage(this.state.messages, event.message)
          if (isNewUser) this.state.scroll = 0
        }
        break
      case 'message.part.delta':
        if (event.sessionId === this.state.currentId) {
          this.applyDelta(event.messageId, event.partIndex, event.kind, event.delta)
        }
        break
      case 'message.part.upsert':
        if (event.sessionId === this.state.currentId) {
          const message = this.state.messages.find((candidate) => candidate.id === event.messageId)
          if (message) {
            while (message.parts.length < event.partIndex) {
              message.parts.push({ type: 'text', text: '' })
            }
            message.parts[event.partIndex] = event.part
          }
        }
        break
      case 'run.started':
        if (event.sessionId === this.state.currentId) {
          this.state.running = true
          this.state.error = null
          this.state.scroll = 0
        }
        break
      case 'run.finished':
        if (event.sessionId === this.state.currentId) {
          this.state.running = false
          if (event.status === 'failed') {
            this.state.error = event.error ?? '运行失败'
          } else if (event.status === 'interrupted') {
            this.state.notice = '已停止'
          }
        }
        break
      case 'chat.queue':
        if (event.sessionId === this.state.currentId) this.state.queued = event.items.length
        break
      case 'permission.asked':
        if (!this.state.permissions.some((request) => request.id === event.permission.id)) {
          this.state.permissions.push(event.permission)
        }
        this.maybeOpenPending()
        break
      case 'permission.replied':
        this.state.permissions = this.state.permissions.filter(
          (request) => request.id !== event.requestId
        )
        this.maybeOpenPending()
        break
      case 'question.asked':
        if (!this.state.questions.some((request) => request.id === event.question.id)) {
          this.state.questions.push(event.question)
        }
        this.maybeOpenPending()
        break
      case 'question.replied':
        this.state.questions = this.state.questions.filter(
          (request) => request.id !== event.questionId
        )
        this.maybeOpenPending()
        break
      default:
        break
    }
    this.changed()
  }

  private applyDelta(
    messageId: string,
    partIndex: number,
    kind: 'text' | 'reasoning' | 'tool-output',
    delta: string
  ): void {
    const message = this.state.messages.find((candidate) => candidate.id === messageId)
    if (!message) return
    const part: MessagePart | undefined = message.parts[partIndex]
    if (kind === 'text' && part?.type === 'text') part.text += delta
    else if (kind === 'reasoning' && part?.type === 'reasoning') part.text += delta
    else if (kind === 'tool-output' && part?.type === 'tool') {
      part.output = (part.output ?? '') + delta
    }
  }

  private maybeOpenPending(): void {
    if (this.state.overlay === 'help') return
    const permission = this.currentPermission()
    if (permission) {
      if (this.state.overlay !== 'permission') {
        this.state.overlay = 'permission'
        this.state.permissionIndex = 0
      }
      return
    }
    const question = this.currentQuestion()
    if (question) {
      if (this.state.overlay !== 'question') {
        this.state.overlay = 'question'
        this.state.questionIndex = 0
        this.state.questionSelected = []
        this.state.questionCustom = null
        this.state.questionCursor = 0
      }
      return
    }
    if (this.state.overlay === 'permission' || this.state.overlay === 'question') {
      this.state.overlay = null
    }
  }

  // ------------------------------------------------------------------- keys

  private handleCtrlKey(key: TuiKey): void {
    switch (key.name) {
      case 'c':
        if (this.state.running && this.state.currentId) {
          this.stop()
        } else if (this.state.input) {
          this.state.input = ''
          this.state.cursor = 0
          this.changed()
        } else {
          this.quit()
        }
        break
      case 'd':
        this.quit()
        break
      case 't':
        void this.newSession()
        break
      case 'n':
        this.cycleSession(1)
        break
      case 'p':
        this.cycleSession(-1)
        break
      case 'r':
        this.retry()
        break
      default:
        break
    }
  }

  private handleSessionKey(key: TuiKey): void {
    switch (key.name) {
      case 'up':
      case 'k':
        this.moveSessionCursor(-1)
        break
      case 'down':
      case 'j':
        this.moveSessionCursor(1)
        break
      case 'return':
      case 'enter': {
        const session = this.state.sessions[this.state.sessionIndex]
        if (session) void this.openSession(session.id)
        break
      }
      case 'tab':
      case 'escape':
        this.state.focus = 'input'
        this.changed()
        break
      case 'n':
        void this.newSession()
        break
      default:
        break
    }
  }

  private handleInputKey(key: TuiKey): void {
    if (isEnter(key)) {
      this.submit()
      return
    }
    if (key.name === 'tab') {
      this.state.focus = 'sessions'
      this.state.sessionIndex = Math.max(
        0,
        this.state.sessions.findIndex((session) => session.id === this.state.currentId)
      )
      this.changed()
      return
    }
    if (key.name === 'up') {
      this.scrollBy(1)
      return
    }
    if (key.name === 'down') {
      this.scrollBy(-1)
      return
    }
    if (key.name === 'pageup') {
      this.scrollBy(this.pageSize())
      return
    }
    if (key.name === 'pagedown') {
      this.scrollBy(-this.pageSize())
      return
    }
    if (key.name === 'escape') {
      if (this.state.scroll !== 0) this.scrollBy(-this.state.scroll)
      return
    }
    if (key.sequence === '?') {
      if (!this.state.input) {
        this.state.overlay = 'help'
        this.changed()
        return
      }
    }
    const edited = applyTextEdit(this.state.input, this.state.cursor, key)
    if (edited) {
      this.state.input = edited.value
      this.state.cursor = edited.cursor
      this.changed()
    }
  }

  private handleOverlayKey(key: TuiKey): void {
    if (key.ctrl && key.name === 'd') {
      this.quit()
      return
    }
    if (key.ctrl && key.name === 'c') {
      // Ctrl-C stays a safe stop even while a prompt owns the keyboard.
      if (this.state.running) {
        this.stop()
        return
      }
      const permission = this.currentPermission()
      if (this.state.overlay === 'permission' && permission) {
        void this.replyPermission(permission, 'reject')
        return
      }
      const question = this.currentQuestion()
      if (this.state.overlay === 'question' && question) {
        void this.replyQuestion(question, { selected: [], custom: null, cancelled: true })
        return
      }
      this.state.overlay = null
      this.changed()
      return
    }
    if (this.state.overlay === 'help') {
      this.state.overlay = null
      this.changed()
      return
    }
    if (this.state.overlay === 'permission') this.handlePermissionKey(key)
    else if (this.state.overlay === 'question') this.handleQuestionKey(key)
  }

  private handlePermissionKey(key: TuiKey): void {
    const request = this.currentPermission()
    if (!request) {
      this.maybeOpenPending()
      this.changed()
      return
    }
    if (key.name === 'up' || key.name === 'k') {
      this.state.permissionIndex =
        (this.state.permissionIndex + PERMISSION_CHOICES.length - 1) % PERMISSION_CHOICES.length
      this.changed()
      return
    }
    if (key.name === 'down' || key.name === 'j') {
      this.state.permissionIndex = (this.state.permissionIndex + 1) % PERMISSION_CHOICES.length
      this.changed()
      return
    }
    let decision: PermissionDecision | null = null
    if (key.name === 'y') decision = 'once'
    else if (key.name === 'a') decision = 'always'
    else if (key.name === 'n' || key.name === 'escape') decision = 'reject'
    else if (isEnter(key)) decision = PERMISSION_CHOICES[this.state.permissionIndex].decision
    if (decision) void this.replyPermission(request, decision)
  }

  private handleQuestionKey(key: TuiKey): void {
    const request = this.currentQuestion()
    if (!request) {
      this.maybeOpenPending()
      this.changed()
      return
    }
    if (this.state.questionCustom !== null) {
      this.handleQuestionCustomKey(request, key)
      return
    }
    if (key.name === 'up' || key.name === 'k') {
      this.state.questionIndex = Math.max(0, this.state.questionIndex - 1)
      this.changed()
      return
    }
    if (key.name === 'down' || key.name === 'j') {
      this.state.questionIndex = Math.min(
        Math.max(0, request.options.length - 1),
        this.state.questionIndex + 1
      )
      this.changed()
      return
    }
    if (key.name === 'space' || key.sequence === ' ') {
      this.toggleQuestionOption()
      return
    }
    if (key.name === 'e' && request.allowCustom) {
      this.state.questionCustom = ''
      this.state.questionCursor = 0
      this.changed()
      return
    }
    if (key.name === 'escape') {
      this.replyQuestion(request, { selected: [], custom: null, cancelled: true })
      return
    }
    const numeric = key.sequence && /^[1-9]$/.test(key.sequence) ? Number(key.sequence) - 1 : -1
    if (numeric >= 0 && numeric < request.options.length) {
      this.state.questionIndex = numeric
      if (request.multiple) this.toggleQuestionOption()
      else this.replyQuestion(request, this.questionAnswer(request))
      return
    }
    if (isEnter(key)) {
      const selected = this.questionAnswer(request).selected
      if (selected.length === 0) {
        if (request.options.length > 0) {
          this.replyQuestion(request, {
            selected: [request.options[this.state.questionIndex].label],
            custom: null
          })
        } else if (request.allowCustom) {
          this.state.questionCustom = ''
          this.state.questionCursor = 0
          this.changed()
        } else {
          this.state.notice = '请选择至少一项'
          this.changed()
        }
        return
      }
      this.replyQuestion(request, { selected, custom: null })
    }
  }

  private handleQuestionCustomKey(request: QuestionRequest, key: TuiKey): void {
    if (key.name === 'escape') {
      this.state.questionCustom = null
      this.state.questionCursor = 0
      this.changed()
      return
    }
    if (isEnter(key)) {
      const custom = this.state.questionCustom?.trim()
      if (custom) this.replyQuestion(request, { selected: [], custom })
      else {
        this.state.notice = '自定义答案不能为空'
        this.changed()
      }
      return
    }
    const custom = this.state.questionCustom ?? ''
    const edited = applyTextEdit(custom, this.state.questionCursor, key)
    if (edited) {
      this.state.questionCustom = edited.value
      this.state.questionCursor = edited.cursor
      this.changed()
    }
  }

  private toggleQuestionOption(): void {
    const request = this.currentQuestion()
    if (!request) return
    if (!request.multiple) {
      this.changed()
      return
    }
    const index = this.state.questionIndex
    const existing = this.state.questionSelected.indexOf(index)
    if (existing >= 0) this.state.questionSelected.splice(existing, 1)
    else this.state.questionSelected.push(index)
    this.changed()
  }

  private questionAnswer(request: QuestionRequest): { selected: string[]; custom: null } {
    const indexes = request.multiple
      ? [...this.state.questionSelected].sort((a, b) => a - b)
      : [this.state.questionIndex]
    return {
      selected: indexes
        .filter((index) => index >= 0 && index < request.options.length)
        .map((index) => request.options[index].label),
      custom: null
    }
  }

  private moveSessionCursor(delta: number): void {
    const count = this.state.sessions.length
    if (count === 0) return
    this.state.sessionIndex = (this.state.sessionIndex + delta + count) % count
    this.changed()
  }

  // ---------------------------------------------------------------- actions

  private submit(): void {
    const text = this.state.input.trim()
    if (!text) return
    const id = this.state.currentId
    if (!id) {
      this.state.notice = '正在创建会话…'
      this.changed()
      return
    }
    this.state.input = ''
    this.state.cursor = 0
    this.state.scroll = 0
    this.state.error = null
    this.changed()
    void this.send(id, text)
  }

  private async send(id: string, text: string): Promise<void> {
    try {
      const result = await this.options.backend.sendChat(id, text)
      if (result === 'steered') this.state.notice = '会话正忙，消息已排队'
      else this.state.notice = null
    } catch (error) {
      this.fail(error)
      if (this.state.currentId === id) {
        this.state.input = text
        this.state.cursor = text.length
      }
    }
    this.changed()
  }

  private stop(): void {
    const id = this.state.currentId
    if (!id) return
    this.state.notice = '正在停止…'
    this.changed()
    void this.options.backend.stopChat(id).catch((error: unknown) => {
      this.fail(error)
      this.changed()
    })
  }

  private retry(): void {
    const id = this.state.currentId
    if (!id) return
    const last = this.state.messages[this.state.messages.length - 1]
    if (
      !last ||
      last.role !== 'assistant' ||
      (last.status !== 'error' && last.status !== 'interrupted')
    ) {
      this.state.notice = '没有可重试的失败消息'
      this.changed()
      return
    }
    this.state.error = null
    this.state.scroll = 0
    this.state.notice = '正在重试…'
    this.changed()
    void this.options.backend.retryChat(id).catch((error: unknown) => {
      this.fail(error)
      this.changed()
    })
  }

  private async replyPermission(
    request: PermissionRequest,
    decision: PermissionDecision
  ): Promise<void> {
    try {
      await this.options.backend.replyPermission(request.id, decision)
      this.state.permissions = this.state.permissions.filter(
        (candidate) => candidate.id !== request.id
      )
      this.state.notice =
        decision === 'reject' ? '已拒绝该操作' : decision === 'always' ? '已始终允许' : '已允许一次'
      this.maybeOpenPending()
    } catch (error) {
      this.fail(error)
    }
    this.changed()
  }

  private async replyQuestion(request: QuestionRequest, answer: QuestionAnswer): Promise<void> {
    try {
      await this.options.backend.replyQuestion(request.id, answer)
      this.state.questions = this.state.questions.filter((candidate) => candidate.id !== request.id)
      this.state.questionCustom = null
      this.state.questionCursor = 0
      this.state.questionSelected = []
      this.state.notice = answer.cancelled ? '已取消提问' : '已提交回答'
      this.maybeOpenPending()
    } catch (error) {
      this.fail(error)
    }
    this.changed()
  }

  private quit(): void {
    if (this.state.quitting) return
    this.state.quitting = true
    this.changed()
    this.options.onQuit?.()
  }

  private scrollBy(delta: number): void {
    this.state.scroll = Math.max(0, Math.min(this.state.scrollLimit, this.state.scroll + delta))
    this.changed()
  }

  private pageSize(): number {
    return Math.max(1, this.state.rows - 8)
  }

  private fail(error: unknown): void {
    this.state.error = errorMessage(error)
  }

  private changed(): void {
    this.options.onChange?.()
  }
}
