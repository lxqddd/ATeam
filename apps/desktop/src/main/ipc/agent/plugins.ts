import { app, shell } from 'electron'
import { z } from 'zod'
import {
  AGENT_CHANNELS,
  type PluginAuthMethodInfo,
  type PluginAuthResult,
  type PluginEntry
} from '@ateam/shared'
import { runtimeModelsWithOAuth } from '../../providers/runtime-config'
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
const authMethodsSchema = z.object({
  directory: z.string().max(2_000).nullable().optional()
})
const authorizeAuthSchema = z.object({
  id: z.string().min(1).max(200),
  answers: z.record(z.string().max(200), z.string().max(10_000)),
  directory: z.string().max(2_000).nullable().optional()
})
const completeAuthSchema = z.object({
  requestId: z.string().min(1).max(200),
  code: z.string().max(10_000).optional(),
  directory: z.string().max(2_000).nullable().optional()
})

/** Registers plugin management channels. */
export function registerPluginHandlers(ctx: AgentIpcContext): void {
  const { handle, pluginStore, requestedDirectory, workspacePath, manager } = ctx

  const persistAuth = async (result: PluginAuthResult): Promise<PluginAuthResult> => {
    if (result.status !== 'success') return result
    await ctx.providerAuthStore.setPluginCredentials(result.provider, result.credentials)
    await manager.setProviderAuth(ctx.providerAuthStore.runtimeAuth())
    await manager.setModels(
      runtimeModelsWithOAuth(ctx.modelsStore.runtimeConfig(), ctx.providerAuthStore)
    )
    return result
  }

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

  handle(AGENT_CHANNELS.pluginsAuthMethods, (payload): Promise<PluginAuthMethodInfo[]> => {
    const input = authMethodsSchema.parse(payload ?? {})
    const workspace = requestedDirectory(input.directory) ?? workspacePath
    return manager.request('plugins.authMethods', { workspace })
  })

  handle(AGENT_CHANNELS.pluginsAuthorizeAuth, async (payload): Promise<PluginAuthResult> => {
    const input = authorizeAuthSchema.parse(payload)
    const workspace = requestedDirectory(input.directory) ?? workspacePath
    const result = await manager.request<PluginAuthResult>('plugins.authorizeAuth', {
      workspace,
      id: input.id,
      answers: input.answers
    })
    if (result.status === 'pending') {
      await shell.openExternal(result.url).catch(() => undefined)
    }
    return persistAuth(result)
  })

  handle(AGENT_CHANNELS.pluginsCompleteAuth, async (payload): Promise<PluginAuthResult> => {
    const input = completeAuthSchema.parse(payload)
    const workspace = requestedDirectory(input.directory) ?? workspacePath
    const result = await manager.request<PluginAuthResult>('plugins.completeAuth', {
      workspace,
      requestId: input.requestId,
      code: input.code
    })
    return persistAuth(result)
  })
}
