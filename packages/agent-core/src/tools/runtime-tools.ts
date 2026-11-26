import { tool, type Tool } from 'ai'
import { z } from 'zod'
import type { ToolContext } from './types'

export function createSubagentTool(context: ToolContext): Tool {
  return tool({
    description:
      'Delegate a focused task to a subagent that works in its own context and returns the result. Use sessionId (or its taskId alias) to continue an earlier subagent session.',
    inputSchema: z.object({
      prompt: z.string().min(1).describe('Task instructions for the subagent'),
      agent: z.string().optional().describe('Subagent name such as explore or general'),
      sessionId: z.string().optional().describe('Continue a previous subagent session'),
      taskId: z
        .string()
        .optional()
        .describe('Resume a previous subagent task id (alias of sessionId)'),
      description: z.string().optional().describe('Short task summary'),
      background: z
        .boolean()
        .optional()
        .describe('Run in the background and report completion as a notification')
    }),
    execute: async (input, options) => {
      if (!context.runSubagent) return 'Error: subagents are not available.'
      const agentName = input.agent?.trim() || 'general'
      const allowed = await context.askPermission(
        'subagent',
        agentName,
        'subagent',
        options.toolCallId
      )
      if (!allowed) return 'Permission denied; the subagent was not started.'
      return context.runSubagent(input, options.toolCallId)
    }
  })
}

export function createSkillTool(context: ToolContext): Tool {
  return tool({
    description:
      'Load the full instructions of an available skill by name. Use a skill when its description matches the task.',
    inputSchema: z.object({
      name: z.string().min(1).describe('Skill name as listed in the system prompt')
    }),
    execute: async ({ name }, options) => {
      if (!context.loadSkill) return 'Error: skills are not available.'
      const allowed = await context.askPermission('skill', name, 'skill', options.toolCallId)
      if (!allowed) return 'Permission denied; the skill was not loaded.'
      return context.loadSkill(name)
    }
  })
}

export function createTodoWriteTool(context: ToolContext): Tool {
  const todoItemSchema = z.object({
    content: z.string().min(1).max(500).describe('Task description'),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
    priority: z.enum(['high', 'medium', 'low'])
  })

  return tool({
    description:
      'Replace the session todo list. Use it to track progress on multi-step work; statuses are pending, in_progress, completed and cancelled.',
    inputSchema: z.object({
      todos: z.array(todoItemSchema).max(50).describe('The complete todo list')
    }),
    execute: async ({ todos }) => {
      if (!context.writeTodos) return 'Error: todo tracking is not available.'
      return context.writeTodos(todos)
    }
  })
}

export function createTodoReadTool(context: ToolContext): Tool {
  return tool({
    description: 'Read the current session todo list.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!context.readTodos) return 'Error: todo tracking is not available.'
      return context.readTodos()
    }
  })
}

export function createQuestionTool(context: ToolContext): Tool {
  return tool({
    description:
      'Ask the user a structured question when a decision is genuinely theirs. Options are shown as buttons or checkboxes; free-form input can be enabled.',
    inputSchema: z.object({
      header: z.string().min(1).max(50).describe('Short label for the question'),
      question: z.string().min(1).max(500).describe('The question to ask'),
      options: z
        .array(
          z.object({
            label: z.string().min(1).max(100),
            description: z.string().max(300).optional()
          })
        )
        .min(1)
        .max(6),
      multiple: z.boolean().optional().describe('Allow selecting several options'),
      allowCustom: z.boolean().optional().describe('Allow a free-form answer')
    }),
    execute: async (input, options) => {
      if (!context.askQuestion) return 'Error: questions are not available.'
      return context.askQuestion(input, options.toolCallId)
    }
  })
}

export function createPlanExitTool(context: ToolContext): Tool {
  return tool({
    description:
      'Finish planning and ask the user whether to switch to the build agent. Only use this in plan mode after the plan file is complete.',
    inputSchema: z.object({}),
    execute: async (_input, options) => {
      if (!context.exitPlan) return 'Error: plan mode is not active.'
      if (context.planReady && !(await context.planReady())) {
        return 'The plan file is missing or empty. Write the complete plan before calling plan_exit.'
      }
      if (!context.askQuestion) return 'Error: questions are not available.'
      const answer = await context.askQuestion(
        {
          header: 'Build Agent',
          question: 'The plan is ready. Switch to the build agent and start implementing?',
          options: [
            { label: 'Yes', description: 'Switch to the build agent' },
            { label: 'No', description: 'Stay in plan mode' }
          ],
          multiple: false,
          allowCustom: false
        },
        options.toolCallId
      )
      if (!/yes/i.test(answer)) return 'The user chose to stay in plan mode.'
      return context.exitPlan()
    }
  })
}
