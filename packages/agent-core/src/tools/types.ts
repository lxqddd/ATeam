import type { ToolSet } from 'ai'
import type {
  PermissionAction,
  QuestionInput,
  SubagentInput,
  TodoInput,
  VcsDiffOptions,
  VcsDiffResult,
  VcsInfo,
  VcsStatus,
  WebFetchFormat
} from '@ateam/shared'
import type { LspCallDirection } from '../integrations/lsp'

export const MAX_TOOL_OUTPUT = 200_000
export const MAX_READ_LINES = 2_000
export const MAX_LIST_ENTRIES = 500
export const MAX_GREP_MATCHES = 100
export const GLOB_TIMEOUT_MS = 10_000
export const MAX_READ_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_READ_PDF_BYTES = 10 * 1024 * 1024
export const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}
export const IGNORED_DIRS = new Set(['.git', 'node_modules', '.DS_Store'])

/** Structured Git access exposed to the vcs tool. */
export interface ToolContextVcs {
  info: () => Promise<VcsInfo>
  status: () => Promise<VcsStatus>
  diff: (options?: VcsDiffOptions) => Promise<VcsDiffResult>
  apply: (patch: string) => Promise<{ files: string[] }>
}

export interface ToolContext {
  workspace: string
  signal: AbortSignal
  askPermission: (
    action: PermissionAction,
    resource: string,
    toolName: string,
    toolCallId: string
  ) => Promise<boolean>
  loadNestedInstructions?: (targetPath: string) => Promise<string>
  storeOutput?: (
    toolCallId: string,
    output: string,
    toolName?: string
  ) => Promise<{ output: string; path?: string }>
  onToolOutput?: (toolCallId: string, delta: string) => void
  shellEnv?: () => Promise<Record<string, string>>
  backgroundOutputPath?: (toolCallId: string) => Promise<string>
  /** Registers a background command so tools and the UI can list, wait on and cancel it. */
  backgroundTaskStart?: (info: {
    toolCallId: string
    kind: 'shell'
    title: string
    outputPath: string | null
    cancel: () => void
  }) => void
  onBackgroundFinished?: (info: {
    toolCallId: string
    command: string
    exitCode: number | null
    outputPath: string | null
  }) => void
  listBackgroundTasks?: () => string
  waitBackgroundTask?: (taskId: string, timeoutMs: number) => Promise<string>
  cancelBackgroundTask?: (taskId: string) => string
  formatFiles?: (files: string[]) => Promise<string>
  diagnoseFiles?: (files: string[]) => Promise<string>
  runSubagent?: (input: SubagentInput, toolCallId: string) => Promise<string>
  fetchWeb?: (input: { url: string; format: WebFetchFormat; timeoutMs?: number }) => Promise<string>
  webSearch?: (input: { query: string; count: number }) => Promise<string>
  loadSkill?: (name: string) => Promise<string>
  writeTodos?: (todos: TodoInput[]) => Promise<string>
  readTodos?: () => Promise<string>
  askQuestion?: (input: QuestionInput, toolCallId: string) => Promise<string>
  exitPlan?: () => Promise<string>
  planReady?: () => Promise<boolean>
  listMcpPrompts?: (server?: string) => Promise<string>
  getMcpPrompt?: (server: string, prompt: string, args?: Record<string, string>) => Promise<string>
  listMcpResources?: (server?: string) => Promise<string>
  readMcpResource?: (server: string, uri: string) => Promise<string>
  grepEngine?: 'auto' | 'js'
  globTimeoutMs?: number
  lspHover?: (file: string, line: number, character: number) => Promise<string>
  lspDefinition?: (file: string, line: number, character: number) => Promise<string>
  lspReferences?: (file: string, line: number, character: number) => Promise<string>
  lspImplementation?: (file: string, line: number, character: number) => Promise<string>
  lspDocumentSymbols?: (file: string) => Promise<string>
  lspWorkspaceSymbols?: (query: string, file: string) => Promise<string>
  lspCallHierarchy?: (
    file: string,
    line: number,
    character: number,
    direction: LspCallDirection
  ) => Promise<string>
  worktreeCreate?: (input: { name: string; base?: string | null }) => Promise<string>
  worktreeList?: () => Promise<string>
  worktreeRemove?: (path: string, force: boolean) => Promise<string>
  vcs?: ToolContextVcs
  moveSession?: (directory: string) => Promise<string>
  workspaceAdapters?: () => Promise<string>
  createWorkspace?: (adapter: string, name: string, base?: string | null) => Promise<string>
  removeWorkspace?: (adapter: string, directory: string, force: boolean) => Promise<string>
  browserOpen?: (url: string, newTab?: boolean) => Promise<string>
  browserTabs?: () => Promise<string>
  browserSnapshot?: (tabId?: string) => Promise<string>
  browserClick?: (ref: string, tabId?: string) => Promise<string>
  browserType?: (ref: string, text: string, submit: boolean, tabId?: string) => Promise<string>
  browserScreenshot?: (
    tabId?: string
  ) => Promise<string | { summary: string; image: { mimeType: string; data: string } }>
  browserEval?: (code: string, tabId?: string) => Promise<string>
  browserNetwork?: (tabId?: string) => Promise<string>
  browserUpload?: (ref: string, path: string, tabId?: string) => Promise<string>
  browserClose?: (tabId?: string) => Promise<string>
  codeModeTools?: () => ToolSet
  codeTimeoutMs?: number
}
