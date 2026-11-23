import { tool, type Tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { runCodeScript } from '../code-mode'
import type { ToolContext } from './types'

async function runCodeMode(
  tools: ToolSet,
  context: ToolContext,
  code: string,
  toolCallId: string
): Promise<string> {
  const preview = code.replace(/\s+/g, ' ').trim().slice(0, 200)
  const allowed = await context.askPermission(
    'shell',
    `code mode: ${preview}`,
    'execute',
    toolCallId
  )
  if (!allowed) return 'Permission denied; the code was not run.'

  return runCodeScript({
    tools: context.codeModeTools?.() ?? tools,
    code,
    timeoutMs: context.codeTimeoutMs ?? 10_000,
    toolCallId,
    signal: context.signal
  })
}

export function createExecuteTool(tools: ToolSet, context: ToolContext): Tool {
  return tool({
    description:
      'Run JavaScript to orchestrate several tool calls in one step. Access tools as `await tools.<name>(input)` using the same names and inputs as direct tool calls, and use console.log for output. Only the value you return and what you log are added to the conversation; intermediate tool results stay inside the script. The script requires shell approval, runs in a separate terminated-after-inactivity worker, and inner tool calls still go through their normal permission checks. Prefer a direct tool call for a single operation.',
    inputSchema: z.object({
      code: z
        .string()
        .min(1)
        .max(20_000)
        .describe(
          'Async JavaScript body; return a concise result, e.g. `return await tools.grep({...})`'
        )
    }),
    execute: async ({ code }, options) => runCodeMode(tools, context, code, options.toolCallId)
  })
}
