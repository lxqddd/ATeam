import { tool, type Tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from './types'

export function createMcpPromptTool(context: ToolContext): Tool {
  return tool({
    description:
      'List MCP prompts, or load one prompt by server and name and return its messages. Omit prompt to list.',
    inputSchema: z.object({
      server: z.string().optional().describe('MCP server name'),
      prompt: z.string().optional().describe('Prompt name to load'),
      arguments: z.record(z.string(), z.string()).optional().describe('Arguments for the prompt')
    }),
    execute: async (input, options) => {
      if (!input.prompt) {
        if (!context.listMcpPrompts) return 'Error: MCP prompts are not available.'
        return context.listMcpPrompts(input.server)
      }
      if (!context.getMcpPrompt) return 'Error: MCP prompts are not available.'
      const server = input.server?.trim()
      if (!server) return 'Error: server is required to load an MCP prompt.'
      const allowed = await context.askPermission(
        'mcp',
        `${server}/prompts/${input.prompt}`,
        'mcp_prompt',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the MCP prompt was not loaded.'
      return context.getMcpPrompt(server, input.prompt, input.arguments)
    }
  })
}

export function createMcpResourceTool(context: ToolContext): Tool {
  return tool({
    description:
      'List MCP resources and resource templates, or read one resource by server and URI. Omit uri to list.',
    inputSchema: z.object({
      server: z.string().optional().describe('MCP server name'),
      uri: z.string().optional().describe('Resource URI to read')
    }),
    execute: async (input, options) => {
      if (!input.uri) {
        if (!context.listMcpResources) return 'Error: MCP resources are not available.'
        return context.listMcpResources(input.server)
      }
      if (!context.readMcpResource) return 'Error: MCP resources are not available.'
      const server = input.server?.trim()
      if (!server) return 'Error: server is required to read an MCP resource.'
      const allowed = await context.askPermission(
        'mcp',
        `${server}/resources/${input.uri}`,
        'mcp_resource',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the MCP resource was not read.'
      return context.readMcpResource(server, input.uri)
    }
  })
}
