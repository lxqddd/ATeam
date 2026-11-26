import { app } from 'electron'
import { AGENT_CHANNELS, type AgentConfig, type EffectiveAgentConfig } from '@ateam/shared'
import {
  editProjectConfigFile,
  globalAgentConfigPath,
  readEffectiveAgentConfig,
  readProjectConfigFile,
  writeProjectConfigFile
} from '@ateam/agent-core/config'
import {
  agentConfigPatchSchema,
  agentConfigResolveSchema,
  projectConfigEditSchema,
  projectConfigUpdateSchema
} from '../config-schema'
import type { AgentIpcContext } from './context'

/** Edits for one workspace are serialized so a form save cannot interleave with a raw save. */
const projectEditQueues = new Map<string, Promise<unknown>>()

function enqueueProjectEdit<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = projectEditQueues.get(key) ?? Promise.resolve()
  const run = previous.then(task, task)
  const tracked = run.then(
    () => undefined,
    () => undefined
  )
  projectEditQueues.set(key, tracked)
  return run.finally(() => {
    if (projectEditQueues.get(key) === tracked) projectEditQueues.delete(key)
  })
}

/** Registers persisted agent configuration channels. */
export function registerConfigHandlers(ctx: AgentIpcContext): void {
  const { handle, configStore, configReady, manager, configWatcher } = ctx

  handle(AGENT_CHANNELS.agentConfig, async (): Promise<AgentConfig> => {
    await configReady
    return configStore.get()
  })

  handle(AGENT_CHANNELS.agentConfigUpdate, async (payload): Promise<AgentConfig> => {
    const patch = agentConfigPatchSchema.parse(payload)
    await configReady
    const updated = await configStore.update(patch)
    configWatcher?.noteSelfWrite(globalAgentConfigPath(app.getPath('userData')))
    await manager.request('config.reload').catch(() => undefined)
    return updated
  })

  handle(AGENT_CHANNELS.agentConfigResolve, async (payload): Promise<EffectiveAgentConfig> => {
    const { directory } = agentConfigResolveSchema.parse(payload ?? {})
    const workspace = ctx.requestedDirectory(directory) ?? ctx.workspacePath
    void configWatcher?.trackWorkspace(workspace)
    return readEffectiveAgentConfig(app.getPath('userData'), workspace)
  })

  handle(AGENT_CHANNELS.agentConfigProjectGet, (payload) => {
    const { directory } = agentConfigResolveSchema.parse(payload ?? {})
    const workspace = ctx.requestedDirectory(directory) ?? ctx.workspacePath
    void configWatcher?.trackWorkspace(workspace)
    return readProjectConfigFile(workspace)
  })

  handle(AGENT_CHANNELS.agentConfigProjectUpdate, async (payload) => {
    const { directory, content } = projectConfigUpdateSchema.parse(payload)
    const workspace = ctx.requestedDirectory(directory) ?? ctx.workspacePath
    const file = await writeProjectConfigFile(workspace, content)
    configWatcher?.noteSelfWrite(file.path)
    await manager.request('config.reload', { workspace }).catch(() => undefined)
    return file
  })

  handle(AGENT_CHANNELS.agentConfigProjectEdit, async (payload) => {
    const { directory, edits } = projectConfigEditSchema.parse(payload)
    const workspace = ctx.requestedDirectory(directory) ?? ctx.workspacePath
    return enqueueProjectEdit(workspace, async () => {
      const file = await editProjectConfigFile(workspace, edits)
      configWatcher?.noteSelfWrite(file.path)
      await manager.request('config.reload', { workspace }).catch(() => undefined)
      return file
    })
  })
}
