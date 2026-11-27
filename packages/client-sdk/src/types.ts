/**
 * Types for the objects exchanged with the ATeam server.
 *
 * They are re-exported from the internal `@ateam/shared` workspace sources and
 * inlined into the published `dist/index.d.ts` (tsup `dts.resolve`), so SDK
 * consumers never need to install or resolve that package themselves.
 *
 * Import from the defining modules, never from the `@ateam/shared` barrel: its
 * `export *` chains cannot be attributed by rollup-plugin-dts and would leave
 * broken relative imports in the generated declarations.
 */
export type {
  AgentDefinition,
  AgentEvent,
  AgentEventEnvelope,
  AgentMode,
  ChatMessage,
  CommandDefinition,
  ConfigDiagnostic,
  ConfigProvenance,
  ConfigSources,
  EffectiveAgentConfig,
  McpServerConfig,
  McpServerStatus,
  MessageAttachment,
  MessagePart,
  MessagesSnapshot,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  QuestionAnswer,
  QuestionOption,
  QuestionRequest,
  ReasoningEffort,
  RunOutcome,
  SessionMeta,
  SessionRuntimeStatus,
  SessionSettings,
  TodoItem,
  TokenUsage
} from '../../shared/src/agent-types'
export type { ModelRef, ProviderType } from '../../shared/src/model-types'
export type {
  WorkspaceFileContent,
  WorkspaceFileEntry,
  WorkspaceFileFindResult,
  WorkspaceFileGrepResult,
  WorkspaceFileList,
  WorkspaceFileMatch,
  WorkspaceFileType
} from '../../shared/src/workspace-files'
export type {
  ResourceConfigSnapshot,
  ResourceLspServer,
  ResourceMcpServer,
  ResourceProvider
} from '../../shared/src/server-resources'
