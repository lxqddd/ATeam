import type { ModelRef } from './model-types'

export type SessionRuntimeStatus = 'idle' | 'running' | 'waiting-permission' | 'error'

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

export type PermissionMode = 'plan' | 'ask' | 'acceptEdits' | 'auto'

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high']

export const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'ask', 'acceptEdits', 'auto']

export interface SessionSettings {
  reasoningEffort: ReasoningEffort | null
  permissionMode: PermissionMode
}

export interface SessionCompaction {
  summary: string
  throughMessageId: string
  createdAt: string
  tokensBefore: number
  tokensAfter: number
}

export interface SessionMeta extends SessionSettings {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  model: ModelRef | null
  status: SessionRuntimeStatus
  compaction: SessionCompaction | null
}

export type ToolState =
  'pending' | 'awaiting-approval' | 'running' | 'completed' | 'failed' | 'denied'

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool'
      toolCallId: string
      toolName: string
      input?: unknown
      state: ToolState
      output?: string
      error?: string
      startedAt?: string
      finishedAt?: string
    }

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  parts: MessagePart[]
  createdAt: string
  updatedAt: string
  status: 'streaming' | 'complete' | 'interrupted' | 'error'
  error?: string
  usage?: TokenUsage
  durationMs?: number
}

export type PermissionAction = 'write' | 'edit' | 'shell'
export type PermissionDecision = 'once' | 'always' | 'reject'

export type PermissionEffect = 'allow' | 'ask' | 'deny'

export type PermissionRuleAction = PermissionAction | 'external_directory' | '*'

export interface PermissionRule {
  id: string
  action: PermissionRuleAction
  resource: string
  effect: PermissionEffect
  /** null means the rule applies to every session. */
  sessionId: string | null
  createdAt: string
}

export interface PermissionRuleInput {
  action: PermissionRuleAction
  resource: string
  effect: PermissionEffect
  sessionId: string | null
}

export interface PermissionRequest {
  id: string
  sessionId: string
  messageId: string
  toolCallId: string
  action: PermissionAction
  resource: string
  toolName: string
  createdAt: string
}

export interface AgentStatus {
  status: 'stopped' | 'starting' | 'ready' | 'error'
  error?: string
  pid?: number
}

export interface AgentInfo {
  workspacePath: string
  appVersion: string
  encryptionAvailable: boolean
  instructionFiles: string[]
}

export type RunOutcome = 'completed' | 'failed' | 'interrupted' | 'max-steps'

export type AgentEvent =
  | { type: 'agent.status'; status: AgentStatus }
  | { type: 'session.upsert'; session: SessionMeta }
  | { type: 'session.deleted'; sessionId: string }
  | { type: 'message.upsert'; message: ChatMessage }
  | {
      type: 'message.part.delta'
      sessionId: string
      messageId: string
      partIndex: number
      kind: 'text' | 'reasoning'
      delta: string
    }
  | {
      type: 'message.part.upsert'
      sessionId: string
      messageId: string
      partIndex: number
      part: MessagePart
    }
  | { type: 'permission.asked'; permission: PermissionRequest }
  | {
      type: 'permission.replied'
      sessionId: string
      requestId: string
      decision: PermissionDecision
    }
  | { type: 'run.started'; sessionId: string; messageId: string; startedAt: string }
  | {
      type: 'run.finished'
      sessionId: string
      messageId: string
      status: RunOutcome
      error?: string
      usage?: TokenUsage
      durationMs?: number
    }

export interface AgentEventEnvelope {
  seq: number
  at: string
  event: AgentEvent
}

export interface MessagesSnapshot {
  sessionId: string
  seq: number
  messages: ChatMessage[]
  running: boolean
}
