import type { LanguageModel } from 'ai'
import type {
  AgentDefinition,
  AgentEvent,
  ChatMessage,
  ModelRef,
  RuntimeModelsConfig,
  SessionMeta
} from '@ateam/shared'
import {
  compactionKeepTokens,
  contextTokenLimit,
  DEFAULT_CONTEXT_WINDOW,
  estimateContextTokens,
  estimateMessagesTokens,
  estimateTextTokens,
  messagesAfterCompaction,
  planCompaction,
  summaryPrompt
} from '../sessions/context'
import type { SessionRecord, SessionsStore } from '../sessions/sessions-store'
import { resolveModelRef } from '../providers'
import { tokenCounterFor, type TokenCounter } from '../tokenizer'
import { nowIso } from './messages'
import type { AgentRuntimeDependencies, Run } from './types'

export interface CompactionHost {
  readonly store: SessionsStore
  models(): RuntimeModelsConfig
  readonly deps: Pick<AgentRuntimeDependencies, 'createLanguageModel' | 'generateSummary'>
  emit(event: AgentEvent): void
  sessionBusy(sessionId: string): boolean
  record(sessionId: string): SessionRecord
  historyMessages(run: Run, assistantMessageId: string): ChatMessage[]
  resolveAgentTarget(agent: AgentDefinition | null, sessionModel: ModelRef | null): ModelRef | null
}

export class CompactionService {
  constructor(private readonly host: CompactionHost) {}

  async prepareCompaction(id: string): Promise<boolean> {
    const record = this.host.store.get(id)
    if (!record || this.host.sessionBusy(id)) return false
    const target = record.session.model ?? this.host.models().defaultModel
    try {
      const contextWindow =
        resolveModelRef(this.host.models(), target).model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
      const plan = planCompaction(
        record.messages,
        contextWindow,
        compactionKeepTokens(contextWindow),
        false,
        await this.tokenEncoder(target)
      )
      if (!plan) return false
      const existing = this.host.store.getPreparedCompaction(id)
      if (existing?.throughMessageId === plan.throughMessageId) return true

      const model = this.host.deps.createLanguageModel(this.host.models(), target, {
        sessionId: id
      })
      const summary = (
        await this.host.deps.generateSummary({
          model,
          prompt: summaryPrompt(plan.older, record.session.compaction?.summary)
        })
      ).trim()
      if (!summary) return false
      await this.host.store.setPreparedCompaction(id, {
        summary,
        throughMessageId: plan.throughMessageId,
        createdAt: nowIso()
      })
      return true
    } catch {
      return false
    }
  }

  async compactMessages(
    sessionId: string,
    messages: ChatMessage[],
    model: LanguageModel,
    abortSignal?: AbortSignal,
    force = false,
    requestedTarget?: ModelRef | null
  ): Promise<SessionMeta | null> {
    const record = this.host.record(sessionId)
    const target = requestedTarget ?? record.session.model ?? this.host.models().defaultModel
    const contextWindow =
      resolveModelRef(this.host.models(), target).model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const encode = await this.tokenEncoder(target)
    const plan = planCompaction(
      messages,
      contextWindow,
      compactionKeepTokens(contextWindow),
      force,
      encode
    )
    if (!plan) return null

    const prepared = this.host.store.getPreparedCompaction(sessionId)
    let summary: string
    if (prepared?.throughMessageId === plan.throughMessageId) {
      summary = prepared.summary
    } else {
      summary = (
        await this.host.deps.generateSummary({
          model,
          prompt: summaryPrompt(plan.older, record.session.compaction?.summary),
          abortSignal
        })
      ).trim()
    }
    if (!summary) return null
    await this.host.store.clearPreparedCompaction(sessionId)

    const session = await this.host.store.setCompaction(sessionId, {
      summary,
      throughMessageId: plan.throughMessageId,
      createdAt: nowIso(),
      tokensBefore: plan.tokensBefore,
      tokensAfter: estimateMessagesTokens(plan.keep, encode) + estimateTextTokens(summary, encode)
    })
    if (!session) return null
    this.host.emit({ type: 'session.upsert', session })
    await this.updateContextUsage(sessionId)
    return this.host.store.getSession(sessionId) ?? session
  }

  async compactForOverflow(run: Run): Promise<boolean> {
    const record = this.host.record(run.sessionId)
    const target = this.host.resolveAgentTarget(run.agent, record.session.model)
    const model = this.host.deps.createLanguageModel(this.host.models(), target, {
      sessionId: run.sessionId
    })
    const session = await this.compactMessages(
      run.sessionId,
      this.host.historyMessages(run, run.messageId),
      model,
      run.abort.signal,
      true,
      target
    )
    return session !== null
  }

  schedulePreparedCompaction(sessionId: string): void {
    const session = this.host.store.getSession(sessionId)
    if (!session?.contextTokens || !session.contextWindow) return
    if (session.contextTokens < contextTokenLimit(session.contextWindow) * 0.6) return
    void this.prepareCompaction(sessionId)
  }

  async updateContextUsage(sessionId: string): Promise<void> {
    const record = this.host.store.get(sessionId)
    if (!record) return
    try {
      const target = record.session.model ?? this.host.models().defaultModel
      const window =
        resolveModelRef(this.host.models(), target).model.contextWindow ?? DEFAULT_CONTEXT_WINDOW
      const history = messagesAfterCompaction(record.messages, record.session.compaction).filter(
        (message) => message.status !== 'streaming'
      )
      const encode = await this.tokenEncoder(target)
      const tokens =
        estimateContextTokens(history, {
          usageCreatedAfter: record.session.compaction?.createdAt,
          encode
        }) + estimateTextTokens(record.session.compaction?.summary ?? '', encode)
      const session = await this.host.store.setContextUsage(sessionId, tokens, window)
      if (session) this.host.emit({ type: 'session.upsert', session })
    } catch {
      /* usage display is best effort */
    }
  }

  async tokenEncoder(target: ModelRef | null): Promise<TokenCounter | undefined> {
    try {
      const resolved = resolveModelRef(this.host.models(), target)
      return await tokenCounterFor(resolved.provider.type, resolved.model.modelId)
    } catch {
      return undefined
    }
  }
}
