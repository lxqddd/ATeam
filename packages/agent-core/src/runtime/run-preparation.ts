import type { ModelMessage, ToolSet } from 'ai'
import type {
  AgentDefinition,
  ChatMessage,
  ModelPublic,
  ModelRef,
  ModelVariant,
  ReasoningEffort,
  RuntimeModelsConfig,
  SkillDefinition
} from '@ateam/shared'
import { filterToolsForAgent } from '../config/agents'
import {
  loadConfiguredInstructions,
  systemWithInstructions,
  type InstructionFile
} from '../config/instructions'
import type { McpManagerLike } from '../integrations/mcp'
import { applyAnthropicCache, buildModelMessages, type AttachmentPayload } from '../message-history'
import type { PluginRegistry } from '../plugins'
import { referencesPrompt, type ResolvedReference } from '../references'
import { contextTokenLimit, systemWithSummary } from '../sessions/context'
import type { SessionRecord } from '../sessions/sessions-store'
import { skillsPrompt } from '../skills'
import { filterToolsForModel, type ToolContext } from '../tools'
import { buildSystemPrompt } from './policy'
import { buildToolContext, type ToolContextHost } from './tool-context'
import type { Run } from './types'

export interface ResolvedTarget {
  ref: ModelRef
  provider: RuntimeModelsConfig['providers'][number]
  model: ModelPublic
}

export interface RunPreparationInput {
  run: Run
  messageId: string
  agent: AgentDefinition | null
  target: ModelRef | null
  resolvedTarget: ResolvedTarget
  variant: ModelVariant | undefined
  nativeCompaction: boolean
  contextWindow: number
}

export interface RunPreparationHost {
  readonly userDataPath: string
  readonly toolContextHost: ToolContextHost
  record(sessionId: string): SessionRecord
  loadInstructions(input: {
    workspacePath: string
    globalDirectory: string
  }): Promise<InstructionFile[]>
  skillsFor(workspace: string): Promise<SkillDefinition[]>
  resolveRunReferences(config: Run['config'], workspace: string): Promise<ResolvedReference[]>
  plugins(config: Run['config'], workspace: string): Promise<PluginRegistry>
  createTools(context: ToolContext): ToolSet
  mcp(workspace: string): McpManagerLike
  historyMessages(run: Run, assistantMessageId: string): ChatMessage[]
  attachmentPayloads(
    sessionId: string,
    messages: ChatMessage[]
  ): Promise<Map<string, AttachmentPayload>>
  isGitRepository(workspace: string): Promise<boolean>
  planFilePath(run: Run): string
}

export interface PreparedRun {
  tools: ToolSet
  system: string
  messages: ModelMessage[]
  providerOptions: Record<string, Record<string, unknown>> | undefined
  params: {
    reasoning: ReasoningEffort | null | undefined
    maxOutputTokens: number | undefined
    temperature: number | undefined
  }
}

export async function prepareRun(
  host: RunPreparationHost,
  input: RunPreparationInput
): Promise<PreparedRun> {
  const { run, agent, target, resolvedTarget, variant, nativeCompaction, contextWindow } = input
  const current = host.record(run.sessionId)
  const instructions = [
    ...(await host.loadInstructions({
      workspacePath: run.workspace,
      globalDirectory: host.userDataPath
    })),
    ...(run.config.instructions.length > 0
      ? await loadConfiguredInstructions(run.config.instructions, run.workspace)
      : [])
  ]
  const loadedInstructionPaths = new Set(instructions.map((file) => file.path))
  const skills = await host.skillsFor(run.workspace)
  const references = await host.resolveRunReferences(run.config, run.workspace)
  run.references = references
  const toolContext = buildToolContext(host.toolContextHost, {
    run,
    skills,
    loadedInstructionPaths
  })
  const plugins = await host.plugins(run.config, run.workspace)
  run.plugins = plugins
  const pluginTools = await plugins.tools(
    {
      workspace: run.workspace,
      sessionId: run.sessionId,
      config: run.config
    },
    {
      askPermission: (pluginName, toolName, toolCallId) =>
        toolContext.askPermission('plugin', `${pluginName}/${toolName}`, toolName, toolCallId)
    }
  )
  const baseTools = host.createTools(toolContext)
  let mcpTools: ToolSet = {}
  let mcpInstructions: Array<{ server: string; instructions: string }> = []
  try {
    const mcpManager = host.mcp(run.workspace)
    mcpTools = await mcpManager.tools(toolContext)
    mcpInstructions = (await mcpManager.instructions?.()) ?? []
  } catch {
    /* MCP servers are best effort */
  }
  const targetInfo = resolvedTarget.model
  const tools = plugins.wrapTools(
    filterToolsForAgent(
      filterToolsForModel(
        { ...mcpTools, ...baseTools, ...pluginTools },
        targetInfo.applyPatch === true
      ),
      agent
    ),
    run.sessionId
  )
  toolContext.codeModeTools = () => tools

  const systemSections = [
    systemWithInstructions(
      systemWithSummary(
        buildSystemPrompt({
          workspacePath: run.workspace,
          permissionMode: current.session.permissionMode ?? 'ask',
          model: target,
          gitRepository: await host.isGitRepository(run.workspace),
          mcpInstructions:
            (current.session.permissionMode ?? 'ask') === 'plan' ||
            agent?.permissions.some((rule) => rule.action === 'mcp' && rule.effect === 'deny')
              ? []
              : mcpInstructions
        }),
        current.session.compaction?.summary
      ),
      instructions
    )
  ]
  const planPath = host.planFilePath(run)
  if ((current.session.permissionMode ?? 'ask') === 'plan') {
    systemSections.push(
      `You are in plan mode. Write the complete plan to ${planPath} using the write or patch tool. ` +
        'Do not modify other files or run shell commands. When the plan is ready, call plan_exit.'
    )
  }
  if (agent?.prompt) systemSections.push(agent.prompt)
  const referenceSection = referencesPrompt(references)
  if (referenceSection) systemSections.push(referenceSection)
  const skillSection = skillsPrompt(skills)
  if (skillSection) systemSections.push(skillSection)
  const systemState = { system: systemSections.join('\n\n') }
  await plugins.transformSystem(
    {
      sessionId: run.sessionId,
      model: `${resolvedTarget.ref.providerId}/${resolvedTarget.ref.modelId}`
    },
    systemState
  )
  const system = systemState.system

  const modelHistory = host.historyMessages(run, input.messageId)
  const historyMessages = buildModelMessages(
    modelHistory,
    await host.attachmentPayloads(run.sessionId, modelHistory),
    { currentModel: target }
  )
  const messages =
    resolvedTarget.provider.type === 'anthropic'
      ? applyAnthropicCache(historyMessages)
      : historyMessages
  const providerOptions: Record<string, Record<string, unknown>> = {}
  if (nativeCompaction && resolvedTarget.provider.type === 'anthropic') {
    providerOptions.anthropic = {
      contextManagement: {
        edits: [
          {
            type: 'compact_20260112',
            trigger: { type: 'input_tokens', value: contextTokenLimit(contextWindow) }
          }
        ]
      }
    }
  }
  if (resolvedTarget.provider.type === 'openai') {
    providerOptions.openai = {
      ...(providerOptions.openai ?? {}),
      promptCacheKey: run.sessionId
    }
  }
  const variantSettings = variant?.settings ?? {}
  const params = {
    reasoning: variantSettings.reasoningEffort ?? current.session.reasoningEffort,
    maxOutputTokens: variantSettings.maxOutputTokens ?? targetInfo.maxOutputTokens,
    temperature: agent?.temperature ?? variantSettings.temperature ?? undefined
  }
  await plugins.transformParams(
    {
      sessionId: run.sessionId,
      agent: agent?.id ?? null,
      model: `${resolvedTarget.ref.providerId}/${resolvedTarget.ref.modelId}`
    },
    params
  )
  return {
    tools,
    system,
    messages,
    providerOptions: Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
    params
  }
}
