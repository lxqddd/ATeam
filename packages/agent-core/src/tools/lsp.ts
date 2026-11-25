import { tool, type Tool } from 'ai'
import { z } from 'zod'
import type { LspCallDirection } from '../integrations/lsp'
import { ensureExternalAccess, escapesWorkspace, resolvePath, safeError } from './helpers'
import type { ToolContext } from './types'

const POSITION_INPUT = z.object({
  path: z.string().describe('File path relative to the workspace'),
  line: z.number().int().min(1).describe('1-based line number'),
  character: z.number().int().min(1).optional().describe('1-based character position')
})

const DENIED = 'Permission denied; the query was not run.'

interface AuthorizedTarget {
  path: string
  external: boolean
}

async function authorizePath(
  context: ToolContext,
  inputPath: string,
  toolName: string,
  toolCallId: string
): Promise<AuthorizedTarget | null> {
  const external = escapesWorkspace(context.workspace, inputPath)
  if (external && !(await ensureExternalAccess(context, inputPath, toolName, toolCallId))) {
    return null
  }
  const allowed = await context.askPermission('lsp', inputPath, toolName, toolCallId)
  if (!allowed) return null
  return { external, path: await resolvePath(context.workspace, inputPath, false, external) }
}

function createPositionTool(
  context: ToolContext,
  options: {
    name: string
    description: string
    available: boolean
    empty: string
    run: (file: string, line: number, character: number) => Promise<string>
  }
): Tool {
  return tool({
    description: options.description,
    inputSchema: POSITION_INPUT,
    execute: async ({ path: inputPath, line, character = 1 }, executionOptions) => {
      try {
        if (!options.available) return 'Error: LSP is not available.'
        const target = await authorizePath(
          context,
          inputPath,
          options.name,
          executionOptions.toolCallId
        )
        if (!target) return DENIED
        return (await options.run(target.path, line, character)) || options.empty
      } catch (error) {
        return safeError(error)
      }
    }
  })
}

export function createLspHoverTool(context: ToolContext): Tool {
  return createPositionTool(context, {
    name: 'lsp_hover',
    description:
      'Get hover information such as types or documentation for a symbol at a 1-based line and character.',
    available: Boolean(context.lspHover),
    empty: 'No hover information.',
    run: (file, line, character) => context.lspHover!(file, line, character)
  })
}

export function createLspDefinitionTool(context: ToolContext): Tool {
  return createPositionTool(context, {
    name: 'lsp_definition',
    description:
      'Find the definition of a symbol at a 1-based line and character and return its file position.',
    available: Boolean(context.lspDefinition),
    empty: 'No definition found.',
    run: (file, line, character) => context.lspDefinition!(file, line, character)
  })
}

export function createLspReferencesTool(context: ToolContext): Tool {
  return createPositionTool(context, {
    name: 'lsp_references',
    description:
      'Find all references to the symbol at a 1-based line and character, including its declaration.',
    available: Boolean(context.lspReferences),
    empty: 'No references found.',
    run: (file, line, character) => context.lspReferences!(file, line, character)
  })
}

export function createLspImplementationTool(context: ToolContext): Tool {
  return createPositionTool(context, {
    name: 'lsp_implementation',
    description:
      'Find the implementations of the interface or abstract symbol at a 1-based line and character.',
    available: Boolean(context.lspImplementation),
    empty: 'No implementations found.',
    run: (file, line, character) => context.lspImplementation!(file, line, character)
  })
}

export function createLspSymbolsTool(context: ToolContext): Tool {
  return tool({
    description:
      'List symbols. With only path, list the symbols declared in that file. With query, search workspace symbols; pass path (any file of the target language) to choose the language server.',
    inputSchema: z.object({
      path: z.string().optional().describe('File path relative to the workspace'),
      query: z
        .string()
        .min(1)
        .optional()
        .describe('Workspace symbol name query; omit to list symbols in path')
    }),
    execute: async (
      { path: inputPath, query }: { path?: string; query?: string },
      executionOptions
    ) => {
      try {
        if (!context.lspDocumentSymbols || !context.lspWorkspaceSymbols) {
          return 'Error: LSP is not available.'
        }
        if (query) {
          if (!inputPath) {
            return 'Error: pass a path belonging to the language so a server can be chosen.'
          }
          const target = await authorizePath(
            context,
            inputPath,
            'lsp_symbols',
            executionOptions.toolCallId
          )
          if (!target) return DENIED
          return (
            (await context.lspWorkspaceSymbols(query, target.path)) || 'No workspace symbols found.'
          )
        }
        if (!inputPath) {
          return 'Error: pass a path to list file symbols or a query to search the workspace.'
        }
        const target = await authorizePath(
          context,
          inputPath,
          'lsp_symbols',
          executionOptions.toolCallId
        )
        if (!target) return DENIED
        return (await context.lspDocumentSymbols(target.path)) || 'No symbols found.'
      } catch (error) {
        return safeError(error)
      }
    }
  })
}

export function createLspCallHierarchyTool(context: ToolContext): Tool {
  return tool({
    description:
      'Inspect incoming and outgoing calls for the function at a 1-based line and character.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to the workspace'),
      line: z.number().int().min(1).describe('1-based line number'),
      character: z.number().int().min(1).optional().describe('1-based character position'),
      direction: z
        .enum(['incoming', 'outgoing', 'both'])
        .optional()
        .describe('Which calls to list; defaults to both')
    }),
    execute: async (
      {
        path: inputPath,
        line,
        character = 1,
        direction = 'both'
      }: {
        path: string
        line: number
        character?: number
        direction?: LspCallDirection
      },
      executionOptions
    ) => {
      try {
        if (!context.lspCallHierarchy) return 'Error: LSP is not available.'
        const target = await authorizePath(
          context,
          inputPath,
          'lsp_call_hierarchy',
          executionOptions.toolCallId
        )
        if (!target) return DENIED
        return (
          (await context.lspCallHierarchy(target.path, line, character, direction)) ||
          'No call hierarchy found.'
        )
      } catch (error) {
        return safeError(error)
      }
    }
  })
}
