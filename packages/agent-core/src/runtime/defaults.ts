import { generateText, stepCountIs, streamText } from 'ai'
import type { LanguageModel } from 'ai'
import { discoverInstructionFiles, type InstructionFile } from '../config/instructions'
import { McpManager } from '../integrations/mcp'
import { fetchWebContent } from '../integrations/webfetch'
import { searchWeb } from '../integrations/websearch'
import { createLanguageModel as createDefaultLanguageModel } from '../providers'
import { createTools as createDefaultTools } from '../tools'
import { createVcs } from '../vcs'
import { createStepLimitHandler } from './max-steps'
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

async function generateTitle(input: { model: LanguageModel; prompt: string }): Promise<string> {
  const result = await generateText({
    model: input.model,
    prompt: input.prompt,
    maxOutputTokens: 32
  })
  return result.text
}

export const DEFAULT_DEPENDENCIES: AgentRuntimeDependencies = {
  createLanguageModel: createDefaultLanguageModel,
  createTools: createDefaultTools,
  createTurn: (input) => {
    const maxSteps = input.maxSteps ?? MAX_STEPS
    return {
      stream: streamText({
        model: input.model,
        system: input.systemProviderOptions
          ? {
              role: 'system' as const,
              content: input.system,
              providerOptions: input.systemProviderOptions as Parameters<
                typeof streamText
              >[0]['providerOptions']
            }
          : input.system,
        messages: input.messages,
        tools: input.tools,
        stopWhen: input.shouldStop
          ? [stepCountIs(maxSteps), () => input.shouldStop?.() === true]
          : stepCountIs(maxSteps),
        prepareStep: createStepLimitHandler(maxSteps),
        abortSignal: input.abortSignal,
        reasoning: input.reasoning ?? undefined,
        temperature: input.temperature,
        maxRetries: 0,
        maxOutputTokens: input.maxOutputTokens ?? 8_192,
        providerOptions: input.providerOptions as Parameters<
          typeof streamText
        >[0]['providerOptions'],
        onError: () => undefined
      }).stream
    }
  },
  generateSummary,
  generateTitle,
  loadInstructions,
  createMcpManager: (input) =>
    new McpManager({
      userDataPath: input.userDataPath,
      workspace: input.workspacePath,
      auth: input.mcpAuth,
      onAuthUpdated: input.onMcpAuth,
      projectServers: input.projectServers
    }),
  fetchWeb: fetchWebContent,
  searchWeb,
  createVcs: (workspace) => createVcs(workspace)
}
