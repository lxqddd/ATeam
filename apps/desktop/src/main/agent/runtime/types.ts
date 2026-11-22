import type { LanguageModel, ModelMessage, TextStreamPart, ToolSet } from 'ai'
import type {
  AgentConfig,
  McpAuthRecord,
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
  RuntimeWebSearchConfig,
  WebFetchFormat
} from '@ateam/shared'
import type { InstructionFile } from '../config/instructions'
import type { McpManagerLike } from '../integrations/mcp'
import type { WebFetchResult } from '../integrations/webfetch'
import type { WebSearchResult } from '../integrations/websearch'
import type { ToolContext } from '../tools'
import type { ResolvedReference } from '../references'

export const MAX_STEPS = 25
export const PERMISSION_TIMEOUT_MS = 10 * 60 * 1000

export interface Run {
  sessionId: string
  messageId: string
  abort: AbortController
  startedAt: number
  steps: number
  config: AgentConfig
  skipHistoryIds?: Set<string>
  retried?: boolean
  agent: AgentDefinition | null
  depth: number
  parentSessionId?: string
  references?: ResolvedReference[]
  policyRules?: PermissionRule[]
  permissionDelegate?: (
    action: PermissionAction,
    resource: string,
    toolName: string,
    toolCallId: string,
    agentRules?: AgentPermissionRule[]
  ) => Promise<boolean>
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
  models: RuntimeModelsConfig
  webSearch?: RuntimeWebSearchConfig | null
  mcpAuth?: McpAuthRecord[]
  onMcpAuth?: (auth: McpAuthRecord) => void
  send: (envelope: AgentEventEnvelope) => void
  dependencies?: Partial<AgentRuntimeDependencies>
}

export interface AgentTurnInput {
  model: LanguageModel
  system: string
  messages: ModelMessage[]
  tools: ToolSet
  abortSignal: AbortSignal
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
    options?: { sessionId?: string }
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
}
