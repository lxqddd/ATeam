import { tool, type Tool } from 'ai'
import { z } from 'zod'
import { ensureExternalAccess, escapesWorkspace, resolvePath, safeError } from './helpers'
import type { ToolContext } from './types'

export function createLspHoverTool(context: ToolContext): Tool {
  return tool({
    description:
      'Get hover information such as types or documentation for a symbol at a 1-based line and character.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to the workspace'),
      line: z.number().int().min(1).describe('1-based line number'),
      character: z.number().int().min(1).optional().describe('1-based character position')
    }),
    execute: async ({ path: inputPath, line, character = 1 }, options) => {
      try {
        if (!context.lspHover) return 'Error: LSP is not available.'
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'read', options.toolCallId))
        ) {
          return 'Permission denied; the query was not run.'
        }
        const allowed = await context.askPermission(
          'read',
          inputPath,
          'lsp_hover',
          options.toolCallId
        )
        if (!allowed) return 'Permission denied; the query was not run.'
        const filePath = await resolvePath(context.workspace, inputPath, false, external)
        return (await context.lspHover(filePath, line, character)) || 'No hover information.'
      } catch (error) {
        return safeError(error)
      }
    }
  })
}

export function createLspDefinitionTool(context: ToolContext): Tool {
  return tool({
    description:
      'Find the definition of a symbol at a 1-based line and character and return its file position.',
    inputSchema: z.object({
      path: z.string().describe('File path relative to the workspace'),
      line: z.number().int().min(1).describe('1-based line number'),
      character: z.number().int().min(1).optional().describe('1-based character position')
    }),
    execute: async ({ path: inputPath, line, character = 1 }, options) => {
      try {
        if (!context.lspDefinition) return 'Error: LSP is not available.'
        const external = escapesWorkspace(context.workspace, inputPath)
        if (
          external &&
          !(await ensureExternalAccess(context, inputPath, 'read', options.toolCallId))
        ) {
          return 'Permission denied; the query was not run.'
        }
        const allowed = await context.askPermission(
          'read',
          inputPath,
          'lsp_definition',
          options.toolCallId
        )
        if (!allowed) return 'Permission denied; the query was not run.'
        const filePath = await resolvePath(context.workspace, inputPath, false, external)
        return (await context.lspDefinition(filePath, line, character)) || 'No definition found.'
      } catch (error) {
        return safeError(error)
      }
    }
  })
}
