import type { ModelRef, ModelVariantInput, ProviderType } from './model-types'

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
  permissions: AgentPermissionRule[]
  maxSteps: number | null
  temperature: number | null
  prompt: string
  source: 'builtin' | 'user' | 'project'
}

export interface AgentPermissionRule {
  action: PermissionRuleAction
  resource: string
  effect: PermissionEffect
}

export interface SubagentInput {
  prompt: string
  agent?: string
  sessionId?: string
  description?: string
  background?: boolean
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
  todos: TodoItem[]
  /** Session workspace override; null uses the runtime workspace. */
  directory: string | null
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export type TodoPriority = 'high' | 'medium' | 'low'

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
  priority: TodoPriority
}

export interface TodoInput {
  content: string
  status: TodoStatus
  priority: TodoPriority
}

export type ToolState =
  'pending' | 'awaiting-approval' | 'running' | 'completed' | 'failed' | 'denied'

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; providerMetadata?: Record<string, unknown> }
  | { type: 'attachment'; attachment: MessageAttachment }
  | {
      type: 'tool'
      toolCallId: string
      toolName: string
      input?: unknown
      state: ToolState
      output?: string
      images?: Array<{ mimeType: string; data: string }>
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
  /** Input tokens served from the provider prompt cache. */
  cacheReadTokens?: number
  /** Input tokens written to the provider prompt cache. */
  cacheWriteTokens?: number
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted'

export interface FileDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export interface FileChange {
  /** Display path; reference files use `@alias/path`. */
  path: string
  /** Raw snapshot key used for revert operations. */
  snapshotPath: string
  status: FileChangeStatus
  binary: boolean
  truncated: boolean
  additions: number
  deletions: number
  hunks: FileDiffHunk[]
  error?: string | null
}

export interface TurnChanges {
  sessionId: string
  messageId: string
  latest: boolean
  canRevert: boolean
  truncated: boolean
  files: FileChange[]
}

export interface MessageSnapshotStep {
  before: string
  after: string
  files: string[]
}

export interface ChatRetryStatus {
  attempt: number
  maxAttempts: number
  delayMs: number
  reason: string
}

/** Retry state kept on a message when the run failed after at least one retry. */
export interface ChatRetryFailure {
  retries: number
  reason: string
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
  /** Model that produced this assistant message. */
  model?: ModelRef
  retry?: ChatRetryStatus
  retryFailure?: ChatRetryFailure
  usage?: TokenUsage
  /** Provider usage for the final model step, used for context sizing. */
  contextUsage?: TokenUsage
  durationMs?: number
  /** Estimated USD cost for this message when the model has pricing metadata. */
  costUsd?: number
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
  | 'skill'
  | 'subagent'
  | 'plugin'
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

export interface SessionSearchResult {
  session: SessionMeta
  snippet: string
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

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionInput {
  header: string
  question: string
  options: QuestionOption[]
  multiple?: boolean
  allowCustom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionId: string
  messageId: string
  toolCallId: string
  header: string
  question: string
  options: QuestionOption[]
  multiple: boolean
  allowCustom: boolean
  createdAt: string
}

export interface QuestionAnswer {
  selected: string[]
  custom: string | null
  cancelled?: boolean
  timedOut?: boolean
}

export interface AgentStatus {
  status: 'stopped' | 'starting' | 'ready' | 'error'
  error?: string
  pid?: number
}

export interface PolicyRule {
  action: PermissionRuleAction
  resource: string
  effect: PermissionEffect
}

export interface OrgPolicyInfo {
  path: string | null
  rules: PolicyRule[]
  error: string | null
}

export interface WorktreeInfo {
  path: string
  branch: string | null
  head: string | null
  main: boolean
  detached: boolean
}

export interface AgentInfo {
  workspacePath: string
  appVersion: string
  instructionFiles: string[]
  lspServers: string[]
  formatters: string[]
  policy?: OrgPolicyInfo
  retryMetrics?: RetryMetricsSnapshot | null
  cacheMetrics?: CacheMetricsSnapshot | null
}

/** In-memory prompt-cache counters for the current agent process. */
export interface CacheMetricsSnapshot {
  /** Model requests that reported usage. */
  requests: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** cacheReadTokens / inputTokens; null until a request reports input tokens. */
  hitRate: number | null
  /** Input tokens served from cache instead of being processed again. */
  savedTokens: number
}

export interface AgentMetricsSnapshot {
  retry: RetryMetricsSnapshot
  cache: CacheMetricsSnapshot
}

/** In-memory retry counters for the current agent process. */
export interface RetryMetricsSnapshot {
  retries: number
  /** Runs that eventually completed after at least one retry. */
  successes: number
  /** Runs that failed after at least one retry. */
  failures: number
  /** successes / (successes + failures); null until a retried run finishes. */
  successRate: number | null
  totalDelayMs: number
  averageDelayMs: number
  lastReason: string | null
  lastRetriedAt: string | null
}

export interface AgentReference {
  alias: string
  path?: string | null
  repository?: string | null
  branch?: string | null
  description?: string | null
  hidden?: boolean
}

export interface LspServerConfigInput {
  command?: string[]
  extensions?: string[]
  disabled?: boolean
  env?: Record<string, string>
  initialization?: Record<string, unknown>
}

export interface FormatterConfigInput {
  command?: string[]
  extensions?: string[]
  configFiles?: string[]
  disabled?: boolean
  environment?: Record<string, string>
}

export interface ProviderModelConfigInput {
  name?: string
  contextWindow?: number
  maxOutputTokens?: number
  reasoning?: boolean
  attachment?: boolean
  costInput?: number
  costOutput?: number
  applyPatch?: boolean
  compaction?: boolean
  variants?: ModelVariantInput[]
}

export interface ProviderConfigInput {
  name?: string
  type?: ProviderType
  baseURL?: string
  /** Environment variable containing the API key. Literal credentials are not accepted in config files. */
  apiKeyEnv?: string
  models?: Record<string, ProviderModelConfigInput>
}

export interface CommandConfigInput {
  template: string
  description?: string
  agent?: string
  model?: string
}

/** On-disk configuration document shared by global config.json and project ateam.json(c). */
export interface AgentConfigDocument {
  snapshots?: boolean
  instructions?: string[]
  lsp?: boolean | Record<string, LspServerConfigInput>
  lspEnabled?: boolean
  formatters?: boolean | Record<string, FormatterConfigInput>
  formattersEnabled?: boolean
  formatterOverrides?: Record<string, string>
  references?: AgentReference[] | Record<string, string | AgentReference>
  permissions?: PermissionRuleInput[]
  permissionRules?: PermissionRuleInput[]
  mcp?: McpServerInput[]
  mcpServers?: McpServerInput[]
  agents?: unknown[]
  providers?: Record<string, ProviderConfigInput> | unknown[]
  plugins?: string[]
  commands?: Record<string, CommandConfigInput> | CommandConfigInput[]
  skills?: string[]
  retry?: RetryConfigInput
}

export interface RetryConfig {
  /** Retries after the first attempt; 0 disables retries. */
  maxRetries: number
  /** Upper bound for one retry wait, in milliseconds. */
  maxDelayMs: number
  /** Time allowed for one request and its retry waits until response headers arrive; 0 disables. */
  timeoutMs: number
}

export type RetryConfigInput = Partial<RetryConfig>

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 4,
  maxDelayMs: 60_000,
  timeoutMs: 0
}

export interface AgentConfig {
  snapshots: boolean
  instructions: string[]
  lsp: boolean
  formatters: boolean
  /** Effective retry policy; always filled by the config loader. */
  retry?: RetryConfig
  references?: AgentReference[]
  /** File extension (e.g. .ts) to formatter id, or "none" to disable formatting. */
  formatterOverrides: Record<string, string>
  /** Project-level permission rules loaded from ateam.json. */
  permissionRules?: PermissionRuleInput[]
  /** Project-level MCP servers loaded from ateam.json. */
  mcpServers?: McpServerInput[]
  /** Raw project-level agent definitions, parsed by the agent loader. */
  agents?: unknown[]
  /** Effective provider overlays; credentials are resolved at runtime, never stored here. */
  providers?: Record<string, ProviderConfigInput>
  /** Project-level plugin specs reserved for the plugin loader. */
  plugins?: string[]
  /** Custom/overridden LSP server definitions keyed by server id. */
  lspServers?: Record<string, LspServerConfigInput>
  /** Custom/overridden formatter definitions keyed by formatter id. */
  formatterServers?: Record<string, FormatterConfigInput>
  /** Inline command definitions parsed from configuration. */
  commands?: CommandDefinition[]
  /** Additional skill directories after path anchoring. */
  skills?: string[]
}

export interface ProjectConfigFile {
  path: string
  directory: string
  root: string
  exists: boolean
  content: string
  diagnostics: ConfigDiagnostic[]
}

export type PluginSource = 'local' | 'npm'
export type PluginCompatibility = 'compatible' | 'incompatible' | 'unknown'

export interface PluginEntry {
  id: string
  spec: string
  name: string
  version: string | null
  source: PluginSource
  enabled: boolean
  compatibility: PluginCompatibility
  requiredVersion: string | null
  error: string | null
  /** Absolute entry file used by the runtime loader. */
  resolvedPath: string | null
  installedAt: string
  updatedAt: string
}

export interface PluginInstallInput {
  spec: string
  directory?: string | null
}

export interface PluginUpdateInput {
  enabled: boolean
}

export type PluginAuthMethodType = 'api' | 'oauth'

export interface PluginAuthPromptOption {
  label: string
  value: string
}

export interface PluginAuthPrompt {
  type: 'text' | 'select'
  key: string
  message: string
  placeholder?: string
  /** Mask the input; use for keys, tokens and secrets. */
  secret?: boolean
  /** Defaults to true; the UI blocks submission until a value is entered. */
  required?: boolean
  options?: PluginAuthPromptOption[]
}

/** Serializable declarative login method exposed by a plugin. */
export interface PluginAuthMethodInfo {
  id: string
  plugin: string
  provider: string
  providerName: string
  type: PluginAuthMethodType
  label: string
  description: string | null
  prompts: PluginAuthPrompt[]
}

export interface PluginAuthStatus {
  connected: boolean
  type: PluginAuthMethodType | null
  /** ISO timestamp for OAuth credentials that expire. */
  expiresAt: string | null
}

/** Auth method with credential state filled by the desktop main process. */
export interface PluginAuthMethodState extends PluginAuthMethodInfo {
  status: PluginAuthStatus
}

export type PluginAuthCredentials =
  | { type: 'api'; key: string }
  | {
      type: 'oauth'
      accessToken: string
      refreshToken?: string | null
      /** Epoch milliseconds. */
      expiresAt?: number | null
      tokenEndpoint?: string | null
      clientId?: string | null
      clientSecret?: string | null
      scope?: string | null
    }

export type PluginAuthResult =
  | { status: 'success'; provider: string; credentials: PluginAuthCredentials }
  | { status: 'failed'; message: string }
  | {
      status: 'pending'
      provider: string
      requestId: string
      url: string
      instructions: string | null
      codeRequired: boolean
    }

export interface PluginAuthAuthorizeInput {
  id: string
  answers: Record<string, string>
  directory?: string | null
}

export interface PluginAuthCompleteInput {
  requestId: string
  code?: string
  directory?: string | null
}

export interface ConfigSources {
  globalConfigPath: string
  projectConfigPath: string | null
  projectConfigDir: string | null
  projectRoot: string
}

export interface ConfigDiagnostic {
  source: string
  path: string
  severity: 'warning' | 'error'
  /** Human-readable message that never contains provider/MCP credential values. */
  message: string
}

export type ConfigFieldSource = 'global' | 'project' | 'merged' | 'default'

export interface ConfigProvenance {
  snapshots: ConfigFieldSource
  instructions: ConfigFieldSource
  lsp: ConfigFieldSource
  formatters: ConfigFieldSource
  references: ConfigFieldSource
  permissions: ConfigFieldSource
  mcp: ConfigFieldSource
  agents: ConfigFieldSource
  providers: ConfigFieldSource
  plugins: ConfigFieldSource
  commands: ConfigFieldSource
  skills: ConfigFieldSource
}

export interface EffectiveAgentConfig {
  config: AgentConfig
  sources: ConfigSources
  diagnostics: ConfigDiagnostic[]
  provenance: ConfigProvenance
  /** MCP servers that came from the project document, safe to manage as config-owned. */
  projectMcpServers?: McpServerInput[]
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
  oauthClientId?: string | null
  oauthScope?: string | null
  oauthRedirectUri?: string | null
  createdAt: string
  updatedAt: string
  /** Origin of the server when returned by the runtime; absent for stored user servers. */
  source?: 'user' | 'project' | 'transient'
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
  oauthClientId?: string | null
  oauthScope?: string | null
  oauthRedirectUri?: string | null
}

export type McpConnectionState = 'idle' | 'connecting' | 'connected' | 'failed' | 'auth-required'

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

/** OAuth credentials for a remote MCP server. Never exposed to the renderer. */
export interface McpAuthRecord {
  serverId: string
  serverUrl: string
  accessToken: string
  refreshToken?: string | null
  /** Epoch milliseconds. */
  expiresAt?: number | null
  tokenEndpoint?: string | null
  clientId?: string | null
  clientSecret?: string | null
  scope?: string | null
  resource?: string | null
}

export interface McpAuthStatus {
  serverId: string
  serverName: string
  authorized: boolean
  expiresAt: string | null
}

export type WebFetchFormat = 'markdown' | 'text' | 'html'

export const WEB_SEARCH_PROVIDERS = ['tavily', 'exa', 'brave', 'serper'] as const
export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number]

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

export interface CommandDefinition {
  id: string
  name: string
  description: string
  template: string
  agent: string | null
  model: ModelRef | null
  mcp?: { server: string; prompt: string; arguments?: string[] } | null
  source: 'user' | 'project' | 'mcp'
}

export interface SkillDefinition {
  id: string
  name: string
  description: string
  content: string
  path: string
  resources: string[]
  source: 'user' | 'project'
}

export type RunOutcome = 'completed' | 'failed' | 'interrupted' | 'max-steps'

export type AgentEvent =
  | { type: 'agent.status'; status: AgentStatus }
  | { type: 'config.changed'; workspace: string }
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
  | { type: 'question.asked'; question: QuestionRequest }
  | { type: 'question.replied'; sessionId: string; questionId: string }
  | {
      type: 'permission.replied'
      sessionId: string
      requestId: string
      decision: PermissionDecision
    }
  | { type: 'run.started'; sessionId: string; messageId: string; startedAt: string }
  | ({ type: 'background.finished' } & BackgroundResult)
  | ({ type: 'subagent.finished' } & SubagentResult)
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

export interface SubagentResult {
  sessionId: string
  parentSessionId: string
  toolCallId: string
  agentId: string
  status: 'completed' | 'failed' | 'interrupted'
  result: string
}
