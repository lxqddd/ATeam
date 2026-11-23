import { app } from 'electron'
import {
  AGENT_CHANNELS,
  type AgentDefinition,
  type AgentInfo,
  type AgentStatus,
  type CommandDefinition
} from '@ateam/shared'
import { discoverInstructionFiles, loadOrgPolicy } from '@ateam/agent-core/config'
import { availableLspServers, discoverFormatters } from '@ateam/agent-core/integrations'
import { runtimeModelsWithOAuth } from '../../providers/runtime-config'
import type { AgentIpcContext } from './context'
import { commandExpandSchema, directoryPayloadSchema } from './schemas'

/** Registers host status queries plus agent and command discovery channels. */
export function registerInfoHandlers(ctx: AgentIpcContext): void {
  const {
    manager,
    modelsStore,
    providerAuthStore,
    workspacePath,
    handle,
    refreshProviderTokens,
    requestedDirectory
  } = ctx

  handle(AGENT_CHANNELS.status, (): AgentStatus => manager.getStatus())

  handle(AGENT_CHANNELS.restart, async (): Promise<AgentStatus> => {
    await refreshProviderTokens()
    return manager.restart(runtimeModelsWithOAuth(modelsStore.runtimeConfig(), providerAuthStore))
  })

  handle(AGENT_CHANNELS.info, async (): Promise<AgentInfo> => {
    let instructionFiles: string[] = []
    try {
      const files = await discoverInstructionFiles(workspacePath, app.getPath('userData'))
      instructionFiles = files.map((file) => file.path)
    } catch {
      /* instruction discovery is best effort */
    }
    let formatters: string[] = []
    try {
      formatters = (await discoverFormatters(workspacePath)).map((formatter) => formatter.id)
    } catch {
      /* formatter discovery is best effort */
    }
    let lspServers: string[] = []
    try {
      lspServers = await availableLspServers(workspacePath)
    } catch {
      /* language server discovery is best effort */
    }
    return {
      workspacePath,
      appVersion: app.getVersion(),
      instructionFiles,
      lspServers,
      formatters,
      policy: loadOrgPolicy({
        userDataPath: app.getPath('userData'),
        envPolicyFile: process.env.ATEAM_POLICY_FILE
      })
    }
  })

  handle(AGENT_CHANNELS.agentsList, (payload): Promise<AgentDefinition[]> => {
    const { directory } = directoryPayloadSchema.parse(payload ?? {})
    return manager.request('agents.list', { workspace: requestedDirectory(directory) })
  })

  handle(AGENT_CHANNELS.commandsList, (payload): Promise<CommandDefinition[]> => {
    const { directory } = directoryPayloadSchema.parse(payload ?? {})
    return manager.request('commands.list', { workspace: requestedDirectory(directory) })
  })

  handle(AGENT_CHANNELS.commandExpand, (payload): Promise<string> => {
    const { template, args, directory } = commandExpandSchema.parse(payload)
    return manager.request('commands.expand', {
      template,
      args,
      workspace: requestedDirectory(directory) ?? workspacePath
    })
  })
}
