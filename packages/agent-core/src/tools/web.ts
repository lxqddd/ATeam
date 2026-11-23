import { tool, type Tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from './types'

export function createWebSearchTool(context: ToolContext): Tool {
  return tool({
    description:
      'Search the web for a query and return result titles, URLs and snippets. Requires approval.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query'),
      count: z.number().int().min(1).max(10).optional().describe('Number of results (default 5)')
    }),
    execute: async ({ query, count = 5 }, options) => {
      if (!context.webSearch) return 'Error: web search is not available.'
      const allowed = await context.askPermission(
        'websearch',
        query,
        'websearch',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the search was not run.'
      return context.webSearch({ query, count })
    }
  })
}

export function createWebFetchTool(context: ToolContext): Tool {
  return tool({
    description:
      'Fetch a web page and return its content as markdown, plain text or raw HTML. Requires approval.',
    inputSchema: z.object({
      url: z.string().describe('http(s) URL to fetch'),
      format: z
        .enum(['markdown', 'text', 'html'])
        .optional()
        .describe('Output format (default markdown)'),
      timeoutMs: z.number().int().min(1_000).max(120_000).optional()
    }),
    execute: async (input, options) => {
      if (!context.fetchWeb) return 'Error: web fetching is not available.'
      const allowed = await context.askPermission(
        'webfetch',
        input.url,
        'webfetch',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the page was not fetched.'
      return context.fetchWeb({
        url: input.url,
        format: input.format ?? 'markdown',
        timeoutMs: input.timeoutMs
      })
    }
  })
}
