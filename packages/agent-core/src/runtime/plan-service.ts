import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentDefinition, AgentEvent, SessionPlan } from '@ateam/shared'
import type { SessionRecord, SessionsStore } from '../sessions/sessions-store'
import type { Run } from './types'

export interface PlanHost {
  readonly store: SessionsStore
  sessionWorkspace(sessionId: string): string
  agents(workspace: string): Promise<AgentDefinition[]>
  emit(event: AgentEvent): void
  record(sessionId: string): SessionRecord
}

/**
 * Plan-mode files: a plan is a Markdown file under `.ateam/plans/<session>.md`
 * in the session workspace. Leaving plan mode switches the session to the
 * build agent and the next run picks the plan up as a continuation prompt.
 */
export class PlanService {
  constructor(private readonly host: PlanHost) {}

  pathForSession(sessionId: string): string {
    return path.posix.join('.ateam', 'plans', `${sessionId}.md`)
  }

  filePathFor(run: Run): string {
    return this.pathForSession(run.sessionId)
  }

  async currentPlan(sessionId: string): Promise<SessionPlan> {
    const record = this.host.store.get(sessionId)
    if (!record) throw new Error('SESSION_NOT_FOUND')
    const relative = this.pathForSession(sessionId)
    const absolutePath = path.resolve(this.host.sessionWorkspace(sessionId), relative)
    try {
      return {
        path: relative,
        absolutePath,
        exists: true,
        content: await fs.readFile(absolutePath, 'utf8')
      }
    } catch {
      return { path: relative, absolutePath, exists: false, content: '' }
    }
  }

  async isReady(run: Run): Promise<boolean> {
    try {
      const content = await fs.readFile(path.resolve(run.workspace, this.filePathFor(run)), 'utf8')
      return content.trim().length > 0
    } catch {
      return false
    }
  }

  async continuationPrompt(sessionId: string): Promise<string | undefined> {
    const record = this.host.store.get(sessionId)
    if (!record || record.session.agent !== 'build') return undefined
    const workspace = this.host.sessionWorkspace(sessionId)
    const relative = this.pathForSession(sessionId)
    try {
      const content = await fs.readFile(path.resolve(workspace, relative), 'utf8')
      if (!content.trim()) return undefined
      return `The user approved the plan saved at ${relative}. Read it and implement it now.`
    } catch {
      return undefined
    }
  }

  async exitPlan(run: Run): Promise<string> {
    const record = this.host.record(run.sessionId)
    if ((record.session.permissionMode ?? 'ask') !== 'plan') {
      throw new Error('NOT_IN_PLAN_MODE')
    }
    if (!(await this.isReady(run))) {
      throw new Error('PLAN_NOT_READY')
    }
    const withAgent = await this.host.store.setAgent(run.sessionId, 'build')
    if (!withAgent) throw new Error('SESSION_NOT_FOUND')
    const session = await this.host.store.setSettings(run.sessionId, {
      reasoningEffort: withAgent.reasoningEffort,
      permissionMode: 'ask'
    })
    if (!session) throw new Error('SESSION_NOT_FOUND')
    run.agent =
      (await this.host.agents(run.workspace)).find((candidate) => candidate.id === 'build') ??
      run.agent
    run.exitedPlan = true
    this.host.emit({ type: 'session.upsert', session })
    return `Switched to build agent. The plan is saved at ${this.filePathFor(run)}. Continuing with implementation.`
  }
}
