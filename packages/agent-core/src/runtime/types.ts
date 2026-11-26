import type { LanguageModel, ModelMessage, TextStreamPart, ToolSet } from 'ai'
import type {
  AgentConfig,
  McpAuthRecord,
  McpServerInput,
  AgentDefinition,
  AgentEventEnvelope,
  AgentPermissionRule,
  ModelRef,
  PermissionAction,
  PermissionDecision,
  PermissionRequest,
  PermissionRule,
  QuestionAnswer,
  QuestionRequest,
  ReasoningEffort,
  RuntimeModelsConfig,
  RuntimeProviderAuth,
  RuntimeWebSearchConfig,
  WebFetchFormat
} from '@ateam/shared'
import type { InstructionFile } from '../config/instructions'
import type { McpManagerLike } from '../integrations/mcp'
import type { WebFetchResult } from '../integrations/webfetch'
import type { WebSearchResult } from '../integrations/websearch'
import type { ToolContext } from '../tools'
import type { ResolvedReference } from '../references'
import type { PluginRegistry } from '../plugins'
import type { VcsService } from '../vcs'

export const MAX_STEPS = 25
export const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000

export interface Run {
  sessionId: string
  messageId: string
  workspace: string
  abort: AbortController
  startedAt: number
  steps: number
  config: AgentConfig
  models: RuntimeModelsConfig
  skipHistoryIds?: Set<string>
  retried?: boolean
  agent: AgentDefinition | null
  depth: number
  parentSessionId?: string
  references?: ResolvedReference[]
  policyRules?: PermissionRule[]
  plugins?: PluginRegistry
  pluginToolOverrides?: {
    inputs: Map<string, unknown>
    outputs: Map<string, unknown>
  }
  permissionDelegate?: (
    action: PermissionAction,
    resource: string,
    toolName: string,
    toolCallId: string,
    agentRules?: AgentPermissionRule[]
  ) => Promise<boolean>
  /** Set when plan_exit switched the session to the build agent. */
  exitedPlan?: boolean
  /** Model-only prompt used by an automatic follow-up run after plan exit. */
  continuationPrompt?: string
}

export interface PendingPermission {
  request: PermissionRequest
  run: Run
  resolve: (decision: PermissionDecision) => void
}

export interface PendingQuestion {
  request: QuestionRequest
  run: Run
  resolve: (answer: QuestionAnswer) => void
  timer: NodeJS.Timeout
}

export interface AgentRuntimeOptions {
  userDataPath: string
  workspacePath: string
  appVersion?: string
  models: RuntimeModelsConfig
  providerAuth?: RuntimeProviderAuth[]
  webSearch?: RuntimeWebSearchConfig | null
  mcpAuth?: McpAuthRecord[]
  onMcpAuth?: (auth: McpAuthRecord) => void
  send: (envelope: AgentEventEnvelope) => void
  browserRequest?: (
    sessionId: string,
    method: string,
    params?: Record<string, unknown>
  ) => Promise<unknown>
  dependencies?: Partial<AgentRuntimeDependencies>
}

export interface AgentTurnInput {
  model: LanguageModel
  system: string
  systemProviderOptions?: Record<string, Record<string, unknown>>
  messages: ModelMessage[]
  tools: ToolSet
  abortSignal: AbortSignal
  /** Stop the tool loop after the current step when this returns true. */
  shouldStop?: () => boolean
  reasoning?: ReasoningEffort | null
  maxSteps?: number
  maxOutputTokens?: number
  temperature?: number
  providerOptions?: Record<string, Record<string, unknown>>
}

export interface AgentTurnStream {
  stream: AsyncIterable<TextStreamPart<ToolSet>>
}

export interface AgentRuntimeDependencies {
  createLanguageModel: (
    models: RuntimeModelsConfig,
    ref: ModelRef | null,
    options?: {
      sessionId?: string
      retry?: import('@ateam/shared').RetryConfig
      onRetry?: (info: import('@ateam/shared').ChatRetryStatus | null) => void
    }
  ) => LanguageModel
  createTools: (context: ToolContext) => ToolSet
  createTurn: (input: AgentTurnInput) => AgentTurnStream
  generateSummary: (input: {
    model: LanguageModel
    prompt: string
    abortSignal?: AbortSignal
  }) => Promise<string>
  generateTitle: (input: { model: LanguageModel; prompt: string }) => Promise<string>
  loadInstructions: (input: {
    workspacePath: string
    globalDirectory: string
  }) => Promise<InstructionFile[]>
  createMcpManager: (input: {
    userDataPath: string
    workspacePath: string
    mcpAuth?: McpAuthRecord[]
    onMcpAuth?: (auth: McpAuthRecord) => void
    projectServers?: McpServerInput[]
  }) => McpManagerLike
  fetchWeb: (input: {
    url: string
    format: WebFetchFormat
    timeoutMs?: number
  }) => Promise<WebFetchResult>
  searchWeb: (
    config: RuntimeWebSearchConfig,
    input: { query: string; count: number }
  ) => Promise<WebSearchResult[]>
  createVcs: (workspace: string) => VcsService
}
