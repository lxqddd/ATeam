import { app } from 'electron'
import { AGENT_CHANNELS, type AgentConfig, type EffectiveAgentConfig } from '@ateam/shared'
import {
  readEffectiveAgentConfig,
  readProjectConfigFile,
  writeProjectConfigFile
} from '@ateam/agent-core/config'
import {
  agentConfigPatchSchema,
  agentConfigResolveSchema,
  projectConfigUpdateSchema
} from '../config-schema'
import type { AgentIpcContext } from './context'

/** Registers persisted agent configuration channels. */
export function registerConfigHandlers(ctx: AgentIpcContext): void {
  const { handle, configStore, configReady } = ctx

  handle(AGENT_CHANNELS.agentConfig, async (): Promise<AgentConfig> => {
    await configReady
    return configStore.get()
  })

  handle(AGENT_CHANNELS.agentConfigUpdate, async (payload): Promise<AgentConfig> => {
    const patch = agentConfigPatchSchema.parse(payload)
    await configReady
    return configStore.update(patch)
  })

  handle(AGENT_CHANNELS.agentConfigResolve, async (payload): Promise<EffectiveAgentConfig> => {
    const { directory } = agentConfigResolveSchema.parse(payload ?? {})
    return readEffectiveAgentConfig(
      app.getPath('userData'),
      ctx.requestedDirectory(directory) ?? ctx.workspacePath
    )
  })

  handle(AGENT_CHANNELS.agentConfigProjectGet, (payload) => {
    const { directory } = agentConfigResolveSchema.parse(payload ?? {})
    return readProjectConfigFile(ctx.requestedDirectory(directory) ?? ctx.workspacePath)
  })

  handle(AGENT_CHANNELS.agentConfigProjectUpdate, async (payload) => {
    const { directory, content } = projectConfigUpdateSchema.parse(payload)
    const workspace = ctx.requestedDirectory(directory) ?? ctx.workspacePath
    await writeProjectConfigFile(workspace, content)
    return readProjectConfigFile(workspace)
  })
}
