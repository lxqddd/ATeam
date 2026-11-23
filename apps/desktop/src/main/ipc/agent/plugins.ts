import { app } from 'electron'
import { z } from 'zod'
import { AGENT_CHANNELS, type PluginEntry } from '@ateam/shared'
import type { AgentIpcContext } from './context'

const installSchema = z.object({
  spec: z.string().min(1).max(500),
  directory: z.string().max(2_000).nullable().optional()
})
const updateSchema = z.object({
  id: z.string().min(1).max(200),
  input: z.object({ enabled: z.boolean() })
})
const idSchema = z.object({ id: z.string().min(1).max(200) })

/** Registers plugin management channels. */
export function registerPluginHandlers(ctx: AgentIpcContext): void {
  const { handle, pluginStore, requestedDirectory, workspacePath } = ctx

  handle(AGENT_CHANNELS.pluginsList, (): Promise<PluginEntry[]> => pluginStore.list())

  handle(AGENT_CHANNELS.pluginsInstall, (payload): Promise<PluginEntry[]> => {
    const input = installSchema.parse(payload)
    const workspace = requestedDirectory(input.directory) ?? workspacePath
    return pluginStore.install(
      { spec: input.spec, directory: workspace },
      workspace,
      app.getVersion()
    )
  })

  handle(AGENT_CHANNELS.pluginsUpdate, (payload): Promise<PluginEntry[]> => {
    const { id, input } = updateSchema.parse(payload)
    return pluginStore.update(id, input)
  })

  handle(AGENT_CHANNELS.pluginsRemove, (payload): Promise<PluginEntry[]> => {
    const { id } = idSchema.parse(payload)
    return pluginStore.remove(id)
  })
}
