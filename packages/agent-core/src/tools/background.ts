import { tool, type Tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from './types'

const MAX_WAIT_MS = 600_000

export function createBackgroundTasksTool(context: ToolContext): Tool {
  return tool({
    description:
      'Manage background tasks started by shell background mode or by a background subagent. ' +
      'Use list to see running and recent tasks, wait to block until a task finishes and return its result, ' +
      'or cancel to stop a running task.',
    inputSchema: z.object({
      action: z.enum(['list', 'wait', 'cancel']).describe('What to do with background tasks'),
      taskId: z
        .string()
        .min(1)
        .describe('Task id from list, required for wait and cancel')
        .optional(),
      timeoutMs: z
        .number()
        .int()
        .min(1_000)
        .max(MAX_WAIT_MS)
        .optional()
        .describe('How long wait may block, in milliseconds')
    }),
    execute: async ({
      action,
      taskId,
      timeoutMs
    }: {
      action: 'list' | 'wait' | 'cancel'
      taskId?: string
      timeoutMs?: number
    }) => {
      if (action === 'list') {
        return context.listBackgroundTasks?.() ?? 'Error: background tasks are not available.'
      }
      if (!taskId) return `Error: taskId is required to ${action} a background task.`
      if (action === 'cancel') {
        return (
          context.cancelBackgroundTask?.(taskId) ?? 'Error: background tasks are not available.'
        )
      }
      if (!context.waitBackgroundTask) return 'Error: background tasks are not available.'
      return context.waitBackgroundTask(taskId, timeoutMs ?? 60_000)
    }
  })
}
