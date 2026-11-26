import path from 'node:path'
import type {
  PermissionAction,
  QuestionInput,
  SkillDefinition,
  SubagentInput,
  TodoInput,
  VcsDiffOptions,
  VcsDiffResult,
  VcsInfo,
  VcsStatus,
  WebFetchFormat
} from '@ateam/shared'
import { discoverNestedInstructions, formatInstructions } from '../config/instructions'
import type { LspCallDirection } from '../integrations/lsp'
import type { ToolContext } from '../tools'
import type { Run } from './types'

export interface ToolContextHost {
  askPermission(
    run: Run,
    action: PermissionAction,
    resource: string,
    toolName: string,
    toolCallId: string
  ): Promise<boolean>
  storeOutput(
    run: Run,
    toolName: string | undefined,
    toolCallId: string,
    output: string
  ): Promise<{ output: string; path?: string }>
  toolOutputPath(sessionId: string, toolCallId: string): Promise<string>
  appendToolOutput(run: Run, toolCallId: string, delta: string): void
  registerBackgroundShell(
    run: Run,
    info: {
      toolCallId: string
      title: string
      outputPath: string | null
      cancel: () => void
    }
  ): void
  emitBackgroundFinished(
    run: Run,
    info: {
      toolCallId: string
      command: string
      exitCode: number | null
      outputPath: string | null
    }
  ): void
  listBackgroundTasks(run: Run): string
  waitBackgroundTask(run: Run, taskId: string, timeoutMs: number): Promise<string>
  cancelBackgroundTask(run: Run, taskId: string): string
  formatFiles(run: Run, files: string[]): Promise<string>
  diagnoseFiles(run: Run, files: string[]): Promise<string>
  lspHover(run: Run, file: string, line: number, character: number): Promise<string>
  lspDefinition(run: Run, file: string, line: number, character: number): Promise<string>
  lspReferences(run: Run, file: string, line: number, character: number): Promise<string>
  lspImplementation(run: Run, file: string, line: number, character: number): Promise<string>
  lspDocumentSymbols(run: Run, file: string): Promise<string>
  lspWorkspaceSymbols(run: Run, query: string, file: string): Promise<string>
  lspCallHierarchy(
    run: Run,
    file: string,
    line: number,
    character: number,
    direction: LspCallDirection
  ): Promise<string>
  runSubagent(run: Run, input: SubagentInput, toolCallId: string): Promise<string>
  fetchWebPage(input: { url: string; format: WebFetchFormat; timeoutMs?: number }): Promise<string>
  searchTheWeb(input: { query: string; count: number }): Promise<string>
  writeTodos(run: Run, todos: TodoInput[]): Promise<string>
  readTodos(run: Run): Promise<string>
  askQuestion(run: Run, input: QuestionInput, toolCallId: string): Promise<string>
  exitPlan(run: Run): Promise<string>
  planReady(run: Run): Promise<boolean>
  listMcpPrompts(server: string | undefined, workspace: string): Promise<string>
  getMcpPrompt(
    server: string,
    prompt: string,
    args: Record<string, string> | undefined,
    workspace: string
  ): Promise<string>
  listMcpResources(server: string | undefined, workspace: string): Promise<string>
  readMcpResource(server: string, uri: string, workspace: string): Promise<string>
  createSessionWorktree(run: Run, input: { name: string; base?: string | null }): Promise<string>
  listSessionWorktrees(run: Run): Promise<string>
  removeSessionWorktree(run: Run, target: string, force: boolean): Promise<string>
  vcsInfo(run: Run): Promise<VcsInfo>
  vcsStatus(run: Run): Promise<VcsStatus>
  vcsDiff(run: Run, options: VcsDiffOptions): Promise<VcsDiffResult>
  vcsApply(run: Run, patch: string): Promise<{ files: string[] }>
  moveSession(run: Run, directory: string): Promise<string>
  listWorkspaceAdapters(run: Run): Promise<string>
  createPluginWorkspace(
    run: Run,
    adapter: string,
    name: string,
    base?: string | null
  ): Promise<string>
  removePluginWorkspace(
    run: Run,
    adapter: string,
    directory: string,
    force: boolean
  ): Promise<string>
  browserAction(run: Run, method: string, params?: Record<string, unknown>): Promise<string>
  browserCapture(
    run: Run,
    tabId?: string
  ): Promise<string | { summary: string; image: { mimeType: string; data: string } }>
}

export interface ToolContextInput {
  run: Run
  skills: SkillDefinition[]
  loadedInstructionPaths: Set<string>
}

export function buildToolContext(host: ToolContextHost, input: ToolContextInput): ToolContext {
  const { run, skills, loadedInstructionPaths } = input
  return {
    workspace: run.workspace,
    signal: run.abort.signal,
    askPermission: (action, resource, toolName, toolCallId) =>
      host.askPermission(run, action, resource, toolName, toolCallId),
    loadNestedInstructions: async (targetPath) => {
      const nested = await discoverNestedInstructions(
        run.workspace,
        targetPath,
        loadedInstructionPaths
      )
      return formatInstructions(nested)
    },
    storeOutput: (toolCallId, output, toolName) =>
      host.storeOutput(run, toolName, toolCallId, output),
    shellEnv: () =>
      run.plugins ? run.plugins.shellEnv(run.workspace, run.sessionId) : Promise.resolve({}),
    onToolOutput: (toolCallId, delta) => host.appendToolOutput(run, toolCallId, delta),
    backgroundOutputPath: (toolCallId) => host.toolOutputPath(run.sessionId, toolCallId),
    backgroundTaskStart: (info) => host.registerBackgroundShell(run, info),
    onBackgroundFinished: (info) => host.emitBackgroundFinished(run, info),
    listBackgroundTasks: () => host.listBackgroundTasks(run),
    waitBackgroundTask: (taskId, timeoutMs) => host.waitBackgroundTask(run, taskId, timeoutMs),
    cancelBackgroundTask: (taskId) => host.cancelBackgroundTask(run, taskId),
    formatFiles: run.config.formatters ? (files) => host.formatFiles(run, files) : undefined,
    diagnoseFiles: run.config.lsp ? (files) => host.diagnoseFiles(run, files) : undefined,
    lspHover: run.config.lsp
      ? (file, line, character) => host.lspHover(run, file, line, character)
      : undefined,
    lspDefinition: run.config.lsp
      ? (file, line, character) => host.lspDefinition(run, file, line, character)
      : undefined,
    lspReferences: run.config.lsp
      ? (file, line, character) => host.lspReferences(run, file, line, character)
      : undefined,
    lspImplementation: run.config.lsp
      ? (file, line, character) => host.lspImplementation(run, file, line, character)
      : undefined,
    lspDocumentSymbols: run.config.lsp ? (file) => host.lspDocumentSymbols(run, file) : undefined,
    lspWorkspaceSymbols: run.config.lsp
      ? (query, file) => host.lspWorkspaceSymbols(run, query, file)
      : undefined,
    lspCallHierarchy: run.config.lsp
      ? (file, line, character, direction) =>
          host.lspCallHierarchy(run, file, line, character, direction)
      : undefined,
    runSubagent: (subagentInput, toolCallId) => host.runSubagent(run, subagentInput, toolCallId),
    fetchWeb: (webInput) => host.fetchWebPage(webInput),
    webSearch: (searchInput) => host.searchTheWeb(searchInput),
    loadSkill: async (name) => {
      const skill = skills.find(
        (candidate) =>
          candidate.name.toLowerCase() === name.toLowerCase() || candidate.id === name.toLowerCase()
      )
      if (!skill) return `Error: unknown skill: ${name}`
      const sections = [`# ${skill.name}`, '', skill.content]
      sections.push('', `Skill directory: ${path.dirname(skill.path)}`)
      if (skill.resources.length > 0) {
        sections.push('Resource files:', ...skill.resources.map((file) => `- ${file}`))
      }
      return sections.join('\n')
    },
    writeTodos: (todos) => host.writeTodos(run, todos),
    readTodos: async () => host.readTodos(run),
    askQuestion: (questionInput, toolCallId) => host.askQuestion(run, questionInput, toolCallId),
    exitPlan: () => host.exitPlan(run),
    planReady: () => host.planReady(run),
    listMcpPrompts: (server) => host.listMcpPrompts(server, run.workspace),
    getMcpPrompt: (server, prompt, args) => host.getMcpPrompt(server, prompt, args, run.workspace),
    listMcpResources: (server) => host.listMcpResources(server, run.workspace),
    readMcpResource: (server, uri) => host.readMcpResource(server, uri, run.workspace),
    worktreeCreate: (worktreeInput) => host.createSessionWorktree(run, worktreeInput),
    worktreeList: () => host.listSessionWorktrees(run),
    worktreeRemove: (target, force) => host.removeSessionWorktree(run, target, force),
    vcs: {
      info: () => host.vcsInfo(run),
      status: () => host.vcsStatus(run),
      diff: (options) => host.vcsDiff(run, options ?? {}),
      apply: (patch) => host.vcsApply(run, patch)
    },
    moveSession: (directory) => host.moveSession(run, directory),
    workspaceAdapters: () => host.listWorkspaceAdapters(run),
    createWorkspace: (adapter, name, base) => host.createPluginWorkspace(run, adapter, name, base),
    removeWorkspace: (adapter, directory, force) =>
      host.removePluginWorkspace(run, adapter, directory, force),
    browserOpen: (url) => host.browserAction(run, 'open', { url }),
    browserSnapshot: () => host.browserAction(run, 'snapshot'),
    browserClick: (ref) => host.browserAction(run, 'click', { ref }),
    browserType: (ref, text, submit) => host.browserAction(run, 'type', { ref, text, submit }),
    browserScreenshot: () => host.browserCapture(run),
    browserEval: (code) => host.browserAction(run, 'eval', { code }),
    browserNetwork: () => host.browserAction(run, 'network'),
    browserUpload: (ref, filePath) => host.browserAction(run, 'upload', { ref, path: filePath }),
    browserClose: () => host.browserAction(run, 'close')
  }
}
