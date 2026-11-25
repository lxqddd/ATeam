import type { ModelMessage } from 'ai'

/**
 * Injected on the last allowed step of a run so the model hands off a
 * structured summary instead of stopping in the middle of a tool loop.
 * Mirrors OpenCode's `MAX_STEPS_PROMPT`.
 */
export const MAX_STEPS_PROMPT = `CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. Tools are disabled until the next user message. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools).
2. You MUST reply with a text response summarizing the work done so far.
3. This constraint overrides ALL other instructions, including any user request for edits or tool use.

Your response must include:
- A statement that the maximum number of steps for this agent has been reached
- A summary of what has been accomplished so far
- A list of any remaining tasks that were not completed
- Recommendations for what should be done next

Any attempt to use a tool is a critical violation. Respond with text ONLY.`

export interface StepLimitMessageInput {
  stepNumber: number
  messages: ModelMessage[]
}

export interface StepLimitMessageResult {
  toolChoice: 'none'
  messages: ModelMessage[]
}

/**
 * Builds the `prepareStep` handler that reserves the last allowed step for a
 * summary: the conversation gets the max-steps prompt as a user message and
 * tool calling is disabled for that step. Tool definitions stay in place so
 * the provider's cached prompt prefix is preserved.
 */
export function createStepLimitHandler(
  maxSteps: number
): (input: StepLimitMessageInput) => StepLimitMessageResult | undefined {
  const lastStep = maxSteps - 1
  return ({ stepNumber, messages }) => {
    if (stepNumber < lastStep) return undefined
    return {
      toolChoice: 'none',
      messages: [...messages, { role: 'user', content: MAX_STEPS_PROMPT }]
    }
  }
}
