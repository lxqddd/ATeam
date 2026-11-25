import type {
  BackgroundTaskInfo,
  BackgroundTaskKind,
  BackgroundTaskState,
  ChatMessage
} from '@ateam/shared'
import { makeUserMessage, nowIso } from './messages'

/** Finished tasks kept per session for listing; running tasks are never trimmed. */
export const MAX_FINISHED_BACKGROUND_TASKS = 20

/** Characters of task output injected into the parent conversation. */
export const MAX_BACKGROUND_RESULT_CHARS = 4_000

/** Deterministic id tying a background task to the tool call that started it. */
export function backgroundTaskId(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`
}

export interface BackgroundTaskStartInput {
  /** Tool call that started the task. */
  id: string
  kind: BackgroundTaskKind
  sessionId: string
  toolCallId: string
  ownerMessageId: string
  title: string
  outputPath?: string | null
  childSessionId?: string
  /** Stops the process or child run. Synchronous; completion follows separately. */
  cancel?: () => void
}

export interface BackgroundTaskFinishInput {
  state: Exclude<BackgroundTaskState, 'running'>
  exitCode?: number | null
  result?: string
  error?: string
}

export interface BackgroundTaskRecord extends BackgroundTaskInfo {
  ownerMessageId: string
  /** True once a tool consumed the result, so no synthetic message is injected. */
  consumed: boolean
  /** True once a user or tool asked to cancel the task. */
  cancelRequested: boolean
  cancel?: () => void
}

interface Waiter {
  resolve: (task: BackgroundTaskInfo | null) => void
  timer: NodeJS.Timeout
  signal?: AbortSignal
  onAbort?: () => void
}

function toInfo(task: BackgroundTaskRecord): BackgroundTaskInfo {
  return structuredClone({
    id: task.id,
    kind: task.kind,
    sessionId: task.sessionId,
    toolCallId: task.toolCallId,
    title: task.title,
    state: task.state,
    startedAt: task.startedAt,
    ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
    ...(task.exitCode !== undefined ? { exitCode: task.exitCode } : {}),
    ...(task.outputPath !== undefined ? { outputPath: task.outputPath } : {}),
    ...(task.result !== undefined ? { result: task.result } : {}),
    ...(task.error !== undefined ? { error: task.error } : {}),
    ...(task.childSessionId ? { childSessionId: task.childSessionId } : {})
  } satisfies BackgroundTaskInfo)
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Registry for background work started by tools. Shell commands and background
 * subagents share one lifecycle so the runtime, tools and UI can list, wait on
 * and cancel them uniformly.
 */
export class BackgroundTaskRegistry {
  private readonly tasks = new Map<string, BackgroundTaskRecord>()
  private readonly order = new Map<string, string[]>()
  private readonly waiters = new Map<string, Set<Waiter>>()

  start(input: BackgroundTaskStartInput): BackgroundTaskInfo {
    const record: BackgroundTaskRecord = {
      id: input.id,
      kind: input.kind,
      sessionId: input.sessionId,
      toolCallId: input.toolCallId,
      title: input.title,
      state: 'running',
      startedAt: nowIso(),
      ...(input.outputPath !== undefined ? { outputPath: input.outputPath } : {}),
      ...(input.childSessionId ? { childSessionId: input.childSessionId } : {}),
      ownerMessageId: input.ownerMessageId,
      consumed: false,
      cancelRequested: false,
      ...(input.cancel ? { cancel: input.cancel } : {})
    }
    this.tasks.set(record.id, record)
    const ids = this.order.get(record.sessionId) ?? []
    ids.push(record.id)
    this.order.set(record.sessionId, ids)
    this.trim(record.sessionId)
    return toInfo(record)
  }

  get(id: string): BackgroundTaskInfo | undefined {
    const task = this.tasks.get(id)
    return task ? toInfo(task) : undefined
  }

  record(id: string): BackgroundTaskRecord | undefined {
    return this.tasks.get(id)
  }

  list(sessionId?: string): BackgroundTaskInfo[] {
    const ids = sessionId ? (this.order.get(sessionId) ?? []) : [...this.order.values()].flat()
    return ids
      .map((id) => this.tasks.get(id))
      .filter((task): task is BackgroundTaskRecord => task !== undefined)
      .map(toInfo)
  }

  running(sessionId?: string): BackgroundTaskInfo[] {
    return this.list(sessionId).filter((task) => task.state === 'running')
  }

  isConsumed(id: string): boolean {
    return this.tasks.get(id)?.consumed ?? false
  }

  /** Marks a result as already returned through a tool so it is not injected twice. */
  consume(id: string): void {
    const task = this.tasks.get(id)
    if (task) task.consumed = true
  }

  complete(id: string, input: BackgroundTaskFinishInput): BackgroundTaskInfo | null {
    const record = this.tasks.get(id)
    if (!record || record.state !== 'running') return null
    const state = record.cancelRequested && input.state !== 'completed' ? 'cancelled' : input.state
    record.state = state
    record.finishedAt = nowIso()
    if (input.exitCode !== undefined) record.exitCode = input.exitCode
    if (input.result !== undefined) record.result = input.result
    if (input.error !== undefined) record.error = input.error
    if (this.waiters.has(id)) record.consumed = true
    const info = toInfo(record)
    this.resolveWaiters(id, info)
    this.trim(record.sessionId)
    return info
  }

  /**
   * Requests cancellation. The task is marked cancelled immediately so waiters
   * resolve and no result is injected; the cancel handler stops the work.
   */
  cancel(id: string): boolean {
    const record = this.tasks.get(id)
    if (!record || record.state !== 'running') return false
    record.cancelRequested = true
    record.state = 'cancelled'
    record.finishedAt = nowIso()
    const info = toInfo(record)
    this.resolveWaiters(id, info)
    this.trim(record.sessionId)
    try {
      record.cancel?.()
    } catch {
      /* the work is already gone */
    }
    return true
  }

  /** Resolves with the finished task, or null on timeout, abort or unknown id. */
  wait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<BackgroundTaskInfo | null> {
    const record = this.tasks.get(id)
    if (!record) return Promise.resolve(null)
    if (record.state !== 'running') return Promise.resolve(toInfo(record))
    if (signal?.aborted) return Promise.resolve(null)
    return new Promise((resolve) => {
      const waiter: Waiter = {
        resolve,
        timer: setTimeout(
          () => {
            this.removeWaiter(id, waiter)
            resolve(null)
          },
          Math.max(1, timeoutMs)
        ),
        signal
      }
      if (signal) {
        waiter.onAbort = () => {
          this.removeWaiter(id, waiter)
          clearTimeout(waiter.timer)
          resolve(null)
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      const waiters = this.waiters.get(id) ?? new Set<Waiter>()
      waiters.add(waiter)
      this.waiters.set(id, waiters)
    })
  }

  remove(id: string): void {
    this.tasks.delete(id)
    for (const [sessionId, ids] of this.order) {
      const next = ids.filter((candidate) => candidate !== id)
      if (next.length === ids.length) continue
      if (next.length === 0) this.order.delete(sessionId)
      else this.order.set(sessionId, next)
    }
  }

  clearSession(sessionId: string): void {
    for (const id of this.order.get(sessionId) ?? []) this.resolveWaiters(id, null)
    for (const id of this.order.get(sessionId) ?? []) this.tasks.delete(id)
    this.order.delete(sessionId)
  }

  cancelAll(): void {
    for (const task of this.tasks.values()) {
      if (task.state === 'running') this.cancel(task.id)
    }
  }

  private removeWaiter(id: string, waiter: Waiter): void {
    const waiters = this.waiters.get(id)
    if (!waiters) return
    waiters.delete(waiter)
    if (waiters.size === 0) this.waiters.delete(id)
  }

  private resolveWaiters(id: string, task: BackgroundTaskInfo | null): void {
    const waiters = this.waiters.get(id)
    if (!waiters) return
    this.waiters.delete(id)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort)
      waiter.resolve(task)
    }
  }

  private trim(sessionId: string): void {
    const ids = this.order.get(sessionId)
    if (!ids) return
    const finished = ids.filter((id) => this.tasks.get(id)?.state !== 'running')
    const excess = finished.length - MAX_FINISHED_BACKGROUND_TASKS
    if (excess <= 0) return
    const removed = new Set(finished.slice(0, excess))
    for (const id of removed) {
      this.tasks.delete(id)
      this.resolveWaiters(id, null)
    }
    this.order.set(
      sessionId,
      ids.filter((id) => !removed.has(id))
    )
  }
}

export function truncateBackgroundResult(
  text: string,
  limit = MAX_BACKGROUND_RESULT_CHARS
): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, limit)}\n[truncated after ${limit} characters]`
}

/** Human-readable result body used by tools and injected messages. */
export function backgroundTaskBody(task: BackgroundTaskInfo): string {
  const parts: string[] = []
  if (task.result?.trim()) parts.push(truncateBackgroundResult(task.result))
  if (task.error?.trim()) parts.push(task.error.trim())
  if (task.kind === 'shell') {
    if (task.exitCode !== undefined && task.exitCode !== null) {
      parts.push(`Exit code: ${task.exitCode}`)
    } else if (task.state === 'failed') {
      parts.push('The command did not report an exit code.')
    }
    if (task.outputPath) parts.push(`Full output: ${task.outputPath}`)
  }
  if (parts.length === 0) {
    parts.push(task.state === 'cancelled' ? 'Background task cancelled.' : '(no output)')
  }
  return parts.join('\n')
}

/** Structured block injected into the parent conversation. */
export function formatBackgroundResult(task: BackgroundTaskInfo): string {
  const attributes = [
    `kind="${task.kind}"`,
    `id="${escapeAttribute(task.id)}"`,
    `state="${task.state}"`,
    ...(task.kind === 'shell' ? [`command="${escapeAttribute(task.title)}"`] : []),
    ...(task.kind === 'subagent' ? [`description="${escapeAttribute(task.title)}"`] : []),
    ...(task.childSessionId ? [`sessionID="${escapeAttribute(task.childSessionId)}"`] : []),
    ...(task.exitCode !== undefined && task.exitCode !== null ? [`exit="${task.exitCode}"`] : [])
  ].join(' ')
  const guidance =
    task.state === 'completed'
      ? 'The background task finished. Continue the task using this result when it is relevant, and do not repeat work it already completed.'
      : task.state === 'cancelled'
        ? 'The background task was cancelled. Do not wait for it again.'
        : 'The background task failed. Decide whether to retry it or continue without its result.'
  return [
    `<background-result ${attributes}>`,
    backgroundTaskBody(task),
    '</background-result>',
    '',
    guidance
  ].join('\n')
}

/** Builds the synthetic user message that wakes the parent conversation. */
export function makeBackgroundResultMessage(task: BackgroundTaskInfo): ChatMessage {
  const message = makeUserMessage(task.sessionId, formatBackgroundResult(task))
  message.synthetic = {
    source: 'background-task',
    taskId: task.id,
    kind: task.kind,
    state: task.state === 'running' ? 'failed' : task.state,
    title: task.title,
    body: backgroundTaskBody(task)
  }
  return message
}

/** One-line list entry for the background_tasks tool. */
export function formatBackgroundTaskList(tasks: BackgroundTaskInfo[]): string {
  if (tasks.length === 0) return 'No background tasks.'
  const lines = tasks.map((task) => {
    const status =
      task.state === 'running'
        ? 'running'
        : task.kind === 'shell' && task.exitCode !== undefined && task.exitCode !== null
          ? `${task.state} (exit ${task.exitCode})`
          : task.state
    return `- ${task.id} · ${task.kind} · ${status} · ${task.title}`
  })
  return ['Background tasks:', ...lines].join('\n')
}
