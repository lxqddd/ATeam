import { generateText, stepCountIs, streamText } from 'ai'
import type { LanguageModel } from 'ai'
import { discoverInstructionFiles, type InstructionFile } from '../config/instructions'
import { McpManager } from '../integrations/mcp'
import { fetchWebContent } from '../integrations/webfetch'
import { searchWeb } from '../integrations/websearch'
import { createLanguageModel as createDefaultLanguageModel } from '../providers'
import { createTools as createDefaultTools } from '../tools'
import { MAX_STEPS, type AgentRuntimeDependencies } from './types'

async function generateSummary(input: {
  model: LanguageModel
  prompt: string
  abortSignal?: AbortSignal
}): Promise<string> {
  const result = await generateText({
    model: input.model,
    prompt: input.prompt,
    maxOutputTokens: 2_048,
    abortSignal: input.abortSignal
  })
  return result.text
}

async function loadInstructions(input: {
  workspacePath: string
  globalDirectory: string
}): Promise<InstructionFile[]> {
  return discoverInstructionFiles(input.workspacePath, input.globalDirectory)
}

export const DEFAULT_DEPENDENCIES: AgentRuntimeDependencies = {
  createLanguageModel: createDefaultLanguageModel,
  createTools: createDefaultTools,
  createTurn: (input) => ({
    stream: streamText({
      model: input.model,
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      stopWhen: stepCountIs(input.maxSteps ?? MAX_STEPS),
      abortSignal: input.abortSignal,
      reasoning: input.reasoning ?? undefined,
      maxRetries: 1,
      maxOutputTokens: input.maxOutputTokens ?? 8_192,
      onError: () => undefined
    }).stream
  }),
  generateSummary,
  loadInstructions,
  createMcpManager: (input) =>
    new McpManager({ userDataPath: input.userDataPath, workspace: input.workspacePath }),
  fetchWeb: fetchWebContent,
  searchWeb
}
