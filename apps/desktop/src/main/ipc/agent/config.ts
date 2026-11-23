import { AGENT_CHANNELS, type AgentConfig } from '@ateam/shared'
import { agentConfigPatchSchema } from '../config-schema'
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
}
