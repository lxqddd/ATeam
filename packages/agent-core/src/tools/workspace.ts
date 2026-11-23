import { tool, type Tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from './types'

export function createWorktreeCreateTool(context: ToolContext): Tool {
  return tool({
    description:
      'Create a Git worktree for the current project and return its directory. The worktree gets its own branch, or reuses an existing branch with the same name. Use session_move to continue working there.',
    inputSchema: z.object({
      name: z.string().min(1).max(200).describe('Worktree and branch name, e.g. feature/login'),
      base: z.string().max(200).optional().describe('Revision to branch from (default HEAD)')
    }),
    execute: async (input, options) => {
      if (!context.worktreeCreate) return 'Error: worktree management is not available.'
      const allowed = await context.askPermission(
        'shell',
        `git worktree add ${input.name}`,
        'worktree_create',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the worktree was not created.'
      return context.worktreeCreate(input)
    }
  })
}

export function createWorktreeListTool(context: ToolContext): Tool {
  return tool({
    description: 'List the Git worktrees of the current project, including the main checkout.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!context.worktreeList) return 'Error: worktree management is not available.'
      return context.worktreeList()
    }
  })
}

export function createWorktreeRemoveTool(context: ToolContext): Tool {
  return tool({
    description:
      'Remove a worktree managed by ATeam. Set force to discard uncommitted changes. The main checkout cannot be removed.',
    inputSchema: z.object({
      path: z.string().min(1).max(1_000).describe('Worktree directory'),
      force: z.boolean().optional().describe('Discard uncommitted changes')
    }),
    execute: async ({ path: worktreePath, force = false }, options) => {
      if (!context.worktreeRemove) return 'Error: worktree management is not available.'
      const allowed = await context.askPermission(
        'edit',
        worktreePath,
        'worktree_remove',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the worktree was not removed.'
      return context.worktreeRemove(worktreePath, force)
    }
  })
}

export function createSessionMoveTool(context: ToolContext): Tool {
  return tool({
    description:
      'Move this session to another directory, typically a newly created worktree. The move takes effect on the next message; the current run keeps using the current directory.',
    inputSchema: z.object({
      directory: z.string().min(1).max(1_000).describe('Absolute path of the new working directory')
    }),
    execute: async ({ directory }, options) => {
      if (!context.moveSession) return 'Error: session moves are not available.'
      const allowed = await context.askPermission(
        'edit',
        directory,
        'session_move',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the session was not moved.'
      return context.moveSession(directory)
    }
  })
}
