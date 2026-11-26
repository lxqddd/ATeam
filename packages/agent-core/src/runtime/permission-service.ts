import { randomUUID } from 'node:crypto'
import type {
  AgentPermissionRule,
  ChatMessage,
  PermissionAction,
  PermissionDecision,
  PermissionEffect,
  PermissionRequest,
  PermissionRule,
  PermissionRuleInput,
  QuestionAnswer,
  QuestionInput,
  QuestionRequest
} from '@ateam/shared'
import {
  alwaysPermissionResource,
  evaluatePermissionRules,
  scanShellCommand
} from '../config/permissions'
import type { PermissionsStore } from '../config/permissions-store'
import { isInsideReferences } from '../references'
import type { SessionsStore } from '../sessions/sessions-store'
import { formatQuestionAnswer } from './helpers'
import { nowIso } from './messages'
import { modePermissionRules } from './policy'
import { emitPart, ensureToolPart, findToolPart } from './run-messages'
import type { EventSink } from './runtime-events'
import {
  PERMISSION_TIMEOUT_MS,
  type PendingPermission,
  type PendingQuestion,
  type Run
} from './types'

export interface PermissionHost {
  readonly store: SessionsStore
  readonly permissionRules: PermissionsStore
  readonly events: EventSink
  assistantFor(run: Run): ChatMessage
  planFilePath(run: Run): string
  emitSession(sessionId: string): void
}

export class PermissionService {
  private readonly pending = new Map<string, PendingPermission>()
  private readonly pendingQuestions = new Map<string, PendingQuestion>()

  constructor(private readonly host: PermissionHost) {}

  permissions(): PermissionRequest[] {
    return [...this.pending.values()].map((entry) => structuredClone(entry.request))
  }

  questions(): QuestionRequest[] {
    return [...this.pendingQuestions.values()].map((entry) => structuredClone(entry.request))
  }

  replyQuestion(questionId: string, answer: QuestionAnswer): void {
    if (!this.pendingQuestions.has(questionId)) throw new Error('QUESTION_NOT_FOUND')
    this.settleQuestion(questionId, answer)
  }

  replyPermission(requestId: string, decision: PermissionDecision): void {
    const entry = this.pending.get(requestId)
    if (!entry) throw new Error('PERMISSION_NOT_FOUND')
    entry.resolve(decision)

    if (decision === 'always') {
      const siblings = [...this.pending.values()].filter(
        (other) =>
          other !== entry &&
          other.run === entry.run &&
          other.request.action === entry.request.action
      )
      for (const sibling of siblings) {
        sibling.resolve('always')
      }
    }
  }

  listPermissionRules(sessionId?: string): PermissionRule[] {
    return this.host.permissionRules.list(sessionId)
  }

  addPermissionRule(input: PermissionRuleInput): Promise<PermissionRule> {
    return this.host.permissionRules.add(input)
  }

  removePermissionRule(id: string): Promise<boolean> {
    return this.host.permissionRules.remove(id)
  }

  askQuestion(run: Run, input: QuestionInput, toolCallId: string): Promise<string> {
    const id = randomUUID()
    const request: QuestionRequest = {
      id,
      sessionId: run.parentSessionId ?? run.sessionId,
      messageId: run.messageId,
      toolCallId,
      header: input.header,
      question: input.question,
      options: input.options,
      multiple: input.multiple ?? false,
      allowCustom: input.allowCustom ?? false,
      createdAt: nowIso()
    }
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        this.settleQuestion(id, { selected: [], custom: null, timedOut: true })
      }, PERMISSION_TIMEOUT_MS)
      this.pendingQuestions.set(id, {
        request,
        run,
        resolve: (answer) => {
          clearTimeout(timer)
          resolve(formatQuestionAnswer(answer))
        },
        timer
      })
      this.host.events.emit({ type: 'question.asked', question: request })
    })
  }

  settleQuestion(id: string, answer: QuestionAnswer): void {
    const entry = this.pendingQuestions.get(id)
    if (!entry) return
    this.pendingQuestions.delete(id)
    clearTimeout(entry.timer)
    entry.resolve(answer)
    this.host.events.emit({
      type: 'question.replied',
      sessionId: entry.request.sessionId,
      questionId: id
    })
  }

  async askPermission(
    run: Run,
    action: PermissionAction,
    resource: string,
    toolName: string,
    toolCallId: string,
    agentRulesOverride?: AgentPermissionRule[]
  ): Promise<boolean> {
    if (run.permissionDelegate) {
      return run.permissionDelegate(
        action,
        resource,
        toolName,
        toolCallId,
        run.agent?.permissions ?? []
      )
    }
    if (
      action === 'external_directory' &&
      isInsideReferences(resource, run.references ?? [], run.workspace)
    ) {
      return true
    }
    // Delegated child runs (subagents, command subtasks) ask on behalf of the
    // parent session so prompts, rules and "always" decisions land there.
    const permissionSessionId = run.parentSessionId ?? run.sessionId
    const mode = this.host.store.get(run.sessionId)?.session.permissionMode ?? 'ask'
    const scan = action === 'shell' ? scanShellCommand(resource, run.workspace) : null
    const resources = scan && scan.segments.length > 0 ? scan.segments : [resource]
    const storedRules = this.host.permissionRules.list(permissionSessionId)
    const globalRules = storedRules.filter((rule) => rule.sessionId === null)
    const sessionRules = storedRules.filter((rule) => rule.sessionId !== null)
    const agentRules = agentRulesOverride ?? run.agent?.permissions ?? []
    const modeRules = modePermissionRules(mode, { planPath: this.host.planFilePath(run) })
    const rules = [
      ...modeRules,
      ...globalRules,
      ...(run.config.permissionRules ?? []).map((rule, index) => ({
        id: `project-${permissionSessionId}-${index}`,
        action: rule.action,
        resource: rule.resource,
        effect: rule.effect,
        sessionId: null,
        createdAt: ''
      })),
      ...agentRules.map((rule, index) => ({
        id: `agent-${permissionSessionId}-${index}`,
        action: rule.action,
        resource: rule.resource,
        effect: rule.effect,
        sessionId: null,
        createdAt: ''
      })),
      ...sessionRules,
      ...(run.agent?.id === 'plan'
        ? [
            {
              id: `plan-file-write-${run.sessionId}`,
              action: 'write' as const,
              resource: this.host.planFilePath(run),
              effect: 'allow' as const,
              sessionId: null,
              createdAt: ''
            },
            {
              id: `plan-file-edit-${run.sessionId}`,
              action: 'edit' as const,
              resource: this.host.planFilePath(run),
              effect: 'allow' as const,
              sessionId: null,
              createdAt: ''
            }
          ]
        : []),
      ...(run.policyRules ?? [])
    ]
    let effect = evaluatePermissionRules(rules, {
      action,
      resources,
      sessionId: permissionSessionId
    })
    if (effect === 'deny') return false
    if (scan?.risky && mode === 'auto' && effect === 'allow') {
      // Risky commands need an explicit allow rule even in auto mode.
      const configured = evaluatePermissionRules(rules.slice(modeRules.length), {
        action,
        resources,
        sessionId: permissionSessionId
      })
      if (configured !== 'allow') effect = 'ask'
    }

    let externalEffect: PermissionEffect = 'allow'
    const externalPaths = (scan?.externalPaths ?? []).filter(
      (externalPath) => !isInsideReferences(externalPath, run.references ?? [], run.workspace)
    )
    if (externalPaths.length > 0) {
      externalEffect =
        evaluatePermissionRules(rules, {
          action: 'external_directory',
          resources: externalPaths,
          sessionId: permissionSessionId
        }) ?? 'ask'
      if (externalEffect === 'deny') return false
    }

    const initialAllow = effect === 'allow' && externalEffect === 'allow'
    if (initialAllow && !run.plugins) return true
    if (run.plugins) {
      // Plugins may tighten a permission decision, never grant an approval
      // that the configured rules left as ask or deny.
      const status = { status: (initialAllow ? 'allow' : 'ask') as 'allow' | 'ask' | 'deny' }
      await run.plugins.permissionAsk({ action, resource, toolName }, status)
      if (status.status === 'deny') return false
      if (initialAllow && status.status === 'allow') return true
    }

    const message = this.host.assistantFor(run)
    const part = ensureToolPart(message, toolCallId, toolName)
    part.state = 'awaiting-approval'
    emitPart(this.host.events, run, part, message.parts.indexOf(part))
    await this.host.store.setStatus(run.sessionId, 'waiting-permission')
    this.host.emitSession(run.sessionId)

    const request: PermissionRequest = {
      id: randomUUID(),
      sessionId: permissionSessionId,
      messageId: run.messageId,
      toolCallId,
      action,
      resource,
      toolName,
      createdAt: nowIso()
    }

    const decision = await new Promise<PermissionDecision>((resolve) => {
      let settled = false
      const finish = (value: PermissionDecision): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        run.abort.signal.removeEventListener('abort', onAbort)
        this.pending.delete(request.id)
        resolve(value)
      }
      const onAbort = (): void => finish('reject')
      const timeout = setTimeout(() => finish('reject'), PERMISSION_TIMEOUT_MS)
      this.pending.set(request.id, { request, run, resolve: finish })
      run.abort.signal.addEventListener('abort', onAbort, { once: true })
      this.host.events.emit({ type: 'permission.asked', permission: structuredClone(request) })
    })

    if (decision === 'always') {
      for (const entry of resources) {
        await this.host.permissionRules
          .add({
            action,
            resource: alwaysPermissionResource(action, entry),
            effect: 'allow',
            sessionId: permissionSessionId
          })
          .catch(() => undefined)
      }
      for (const externalPath of scan?.externalPaths ?? []) {
        await this.host.permissionRules
          .add({
            action: 'external_directory',
            resource: alwaysPermissionResource('external_directory', externalPath),
            effect: 'allow',
            sessionId: permissionSessionId
          })
          .catch(() => undefined)
      }
    }
    const current = findToolPart(message, toolCallId)
    if (current && current.type === 'tool') {
      current.state = decision === 'reject' ? 'denied' : 'running'
      current.error = decision === 'reject' ? 'Permission denied by user' : undefined
      current.finishedAt = decision === 'reject' ? nowIso() : undefined
      emitPart(this.host.events, run, current, message.parts.indexOf(current))
    }
    this.host.events.emit({
      type: 'permission.replied',
      sessionId: permissionSessionId,
      requestId: request.id,
      decision
    })
    await this.host.store.setStatus(run.sessionId, 'running')
    this.host.emitSession(run.sessionId)
    await this.host.store.persist(run.sessionId)
    return decision !== 'reject'
  }

  rejectPendingForRun(run: Run): void {
    for (const [id, entry] of this.pending) {
      if (entry.run !== run) continue
      entry.resolve('reject')
      this.pending.delete(id)
    }
    for (const [id, entry] of this.pendingQuestions) {
      if (entry.run !== run) continue
      this.settleQuestion(id, { selected: [], custom: null, cancelled: true })
    }
  }
}
