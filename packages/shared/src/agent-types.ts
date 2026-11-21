import type { ModelRef } from './model-types'

export type SessionRuntimeStatus = 'idle' | 'running' | 'waiting-permission' | 'error'

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

export type PermissionMode = 'plan' | 'ask' | 'acceptEdits' | 'auto'

export type AgentMode = 'primary' | 'subagent' | 'all'

export interface AgentDefinition {
  id: string
  name: string
  description: string
  mode: AgentMode
  model: ModelRef | null
  tools: string[] | null
  maxSteps: number | null
  prompt: string
  source: 'builtin' | 'user' | 'project'
}

export interface SubagentInput {
  prompt: string
  agent?: string
  sessionId?: string
  description?: string
}

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
  redoAvailable: boolean
  contextTokens: number | null
  contextWindow: number | null
  agent: string | null
  parentId: string | null
  hidden: boolean
}

export type ToolState =
  'pending' | 'awaiting-approval' | 'running' | 'completed' | 'failed' | 'denied'

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'attachment'; attachment: MessageAttachment }
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

export type AttachmentKind = 'text' | 'image' | 'pdf'

export interface MessageAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  kind: AttachmentKind
  path: string
}

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface MessageSnapshotStep {
  before: string
  after: string
  files: string[]
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
  snapshotBefore?: string
  snapshotAfter?: string
  snapshotSteps?: MessageSnapshotStep[]
  changedFiles?: string[]
}

export type PermissionAction =
  | 'read'
  | 'list'
  | 'grep'
  | 'write'
  | 'edit'
  | 'shell'
  | 'external_directory'
  | 'mcp'
  | 'webfetch'
  | 'websearch'
export type PermissionDecision = 'once' | 'always' | 'reject'

export type PermissionEffect = 'allow' | 'ask' | 'deny'

export type PermissionRuleAction = PermissionAction | 'glob' | 'external_directory' | '*'

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

export interface SessionUndoResult {
  session: SessionMeta
  prompt: string
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
  lspServers: string[]
  formatters: string[]
}

export interface AgentConfig {
  snapshots: boolean
  instructions: string[]
  lsp: boolean
  formatters: boolean
}

export type McpServerType = 'local' | 'remote'

export interface McpServerConfig {
  id: string
  name: string
  type: McpServerType
  command: string | null
  args: string[]
  url: string | null
  headers: Record<string, string>
  env: Record<string, string>
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface McpServerInput {
  name: string
  type: McpServerType
  command?: string | null
  args?: string[]
  url?: string | null
  headers?: Record<string, string>
  env?: Record<string, string>
  enabled?: boolean
}

export type McpConnectionState = 'idle' | 'connecting' | 'connected' | 'failed'

export interface McpServerStatus {
  id: string
  name: string
  state: McpConnectionState
  toolCount: number
  promptCount: number
  resourceCount: number
  error: string | null
  updatedAt: string | null
}

export type WebFetchFormat = 'markdown' | 'text' | 'html'

export type WebSearchProvider = 'tavily' | 'exa' | 'brave'

export interface WebSearchInput {
  provider: WebSearchProvider
  apiKey?: string
}

export interface WebSearchProviderPublic {
  provider: WebSearchProvider
  hasApiKey: boolean
  updatedAt: string | null
}

export interface RuntimeWebSearchConfig {
  provider: WebSearchProvider
  apiKey: string
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
      kind: 'text' | 'reasoning' | 'tool-output'
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
  | ({ type: 'background.finished' } & BackgroundResult)
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

export interface BackgroundResult {
  sessionId: string
  messageId: string
  toolCallId: string
  command: string
  exitCode: number | null
  outputPath: string | null
}
