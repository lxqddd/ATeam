import type { ToolSet } from 'ai'
import {
  createBrowserClickTool,
  createBrowserCloseTool,
  createBrowserEvalTool,
  createBrowserNetworkTool,
  createBrowserOpenTool,
  createBrowserScreenshotTool,
  createBrowserSnapshotTool,
  createBrowserTabsTool,
  createBrowserTypeTool,
  createBrowserUploadTool
} from './browser'
import { createExecuteTool } from './execute'
import { createEditTool, createListTool, createReadTool, createWriteTool } from './fs'
import {
  createLspCallHierarchyTool,
  createLspDefinitionTool,
  createLspHoverTool,
  createLspImplementationTool,
  createLspReferencesTool,
  createLspSymbolsTool
} from './lsp'
import { createMcpPromptTool, createMcpResourceTool } from './mcp'
import { createPatchTool } from './patch'
import {
  createPlanExitTool,
  createQuestionTool,
  createSkillTool,
  createSubagentTool,
  createTodoReadTool,
  createTodoWriteTool
} from './runtime-tools'
import { createGlobTool, createGrepTool } from './search'
import { createShellTool } from './shell'
import type { ToolContext } from './types'
import { createWebFetchTool, createWebSearchTool } from './web'
import {
  createSessionMoveTool,
  createWorkspaceAdapterListTool,
  createWorkspaceCreateTool,
  createWorkspaceRemoveTool,
  createWorktreeCreateTool,
  createWorktreeListTool,
  createWorktreeRemoveTool
} from './workspace'

export function createTools(context: ToolContext): ToolSet {
  const browserTools = {
    browser_open: createBrowserOpenTool(context),
    browser_tabs: createBrowserTabsTool(context),
    browser_snapshot: createBrowserSnapshotTool(context),
    browser_click: createBrowserClickTool(context),
    browser_type: createBrowserTypeTool(context),
    browser_screenshot: createBrowserScreenshotTool(context),
    browser_eval: createBrowserEvalTool(context),
    browser_network: createBrowserNetworkTool(context),
    browser_upload: createBrowserUploadTool(context),
    browser_close: createBrowserCloseTool(context)
  }

  const rawTools: ToolSet = {
    read: createReadTool(context),
    list: createListTool(context),
    grep: createGrepTool(context),
    glob: createGlobTool(context),
    patch: createPatchTool(context),
    write: createWriteTool(context),
    edit: createEditTool(context),
    shell: createShellTool(context),
    subagent: createSubagentTool(context),
    websearch: createWebSearchTool(context),
    webfetch: createWebFetchTool(context),
    skill: createSkillTool(context),
    todowrite: createTodoWriteTool(context),
    todoread: createTodoReadTool(context),
    question: createQuestionTool(context),
    plan_exit: createPlanExitTool(context),
    lsp_hover: createLspHoverTool(context),
    lsp_definition: createLspDefinitionTool(context),
    lsp_references: createLspReferencesTool(context),
    lsp_implementation: createLspImplementationTool(context),
    lsp_symbols: createLspSymbolsTool(context),
    lsp_call_hierarchy: createLspCallHierarchyTool(context),
    worktree_create: createWorktreeCreateTool(context),
    worktree_list: createWorktreeListTool(context),
    worktree_remove: createWorktreeRemoveTool(context),
    session_move: createSessionMoveTool(context),
    workspace_adapter_list: createWorkspaceAdapterListTool(context),
    workspace_create: createWorkspaceCreateTool(context),
    workspace_remove: createWorkspaceRemoveTool(context),
    ...(context.browserOpen ? browserTools : {}),
    mcp_prompt: createMcpPromptTool(context),
    mcp_resource: createMcpResourceTool(context)
  }

  return wrapToolOutputs({ ...rawTools, execute: createExecuteTool(rawTools, context) }, context)
}

export function wrapToolOutputs(tools: ToolSet, context: ToolContext): ToolSet {
  if (!context.storeOutput) return tools
  const wrapped: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(tools)) {
    const executable = definition as unknown as {
      execute?: (input: never, options: { toolCallId: string }) => unknown
    }
    if (typeof executable.execute !== 'function') {
      wrapped[name] = definition
      continue
    }
    const execute = executable.execute
    wrapped[name] = {
      ...definition,
      execute: async (input: never, options: { toolCallId: string }) => {
        const result = await execute(input, options)
        if (typeof result !== 'string') return result
        return (await context.storeOutput?.(options.toolCallId, result))?.output ?? result
      }
    }
  }
  return wrapped as ToolSet
}
