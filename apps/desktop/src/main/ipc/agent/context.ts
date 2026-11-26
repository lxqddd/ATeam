import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import fsSync from 'node:fs'
import path from 'node:path'
import type { PluginAuthResult } from '@ateam/shared'
import type { AgentManager } from '../../agent-host/agent-manager'
import { AgentConfigStore } from '@ateam/agent-core/config'
import { PluginStore } from '@ateam/agent-core'
import { hasProjectReferences, resolveReferences } from '@ateam/agent-core/references'
import type { McpAuthStore } from '../../credentials/mcp-auth-store'
import type { ProviderAuthStore } from '../../providers/provider-auth-store'
import type { ConfigWatcher } from '../../config-watcher'
import {
  refreshExpiringPluginAuth,
  refreshExpiringProviderAuth,
  runtimeModelsWithOAuth
} from '../../providers/runtime-config'
import type { ModelConfigStore } from '../../settings/model-config-store'
import type { WebSearchConfigStore } from '../../settings/websearch-config-store'
import type { TrustedSender } from '../trusted-sender'

/** Dependencies required to register the agent IPC surface. */
export interface AgentIpcOptions {
  manager: AgentManager
  modelsStore: ModelConfigStore
  webSearchStore: WebSearchConfigStore
  mcpAuthStore: McpAuthStore
  providerAuthStore: ProviderAuthStore
  workspacePath: string
  isTrustedSender: TrustedSender
  /** Shared global config store; created from `app.getPath('userData')` when omitted. */
  configStore?: AgentConfigStore
  /** Initialization promise for the shared config store. */
  configReady?: Promise<void>
  /** Watches config files so writes made by the app are not reloaded twice. */
  configWatcher?: ConfigWatcher
}

/** Reference root used to extend file search beyond the workspace. */
export interface AgentReferenceRoot {
  alias: string
  root: string
}

export type AgentIpcHandler = (payload: unknown) => unknown

export type AgentIpcHandle = (channel: string, handler: AgentIpcHandler) => void

/** Shared state and helpers for the per-domain agent IPC registrars. */
export interface AgentIpcContext extends AgentIpcOptions {
  handle: AgentIpcHandle
  refreshProviderTokens: () => Promise<void>
  configStore: AgentConfigStore
  pluginStore: PluginStore
  configReady: Promise<void>
  requestedDirectory: (value: unknown) => string | undefined
  searchReferences: (searchRoot: string) => Promise<AgentReferenceRoot[]>
}

export function createAgentIpcContext(options: AgentIpcOptions): AgentIpcContext {
  const { manager, modelsStore, providerAuthStore, isTrustedSender } = options

  const refreshProviderTokens = async (): Promise<void> => {
    // Keep these sequential: both helpers persist to the same auth.json.
    const providerChanged = await refreshExpiringProviderAuth(providerAuthStore)
    const pluginChanged = await refreshExpiringPluginAuth(
      providerAuthStore,
      async (provider, credentials) => {
        try {
          return await manager.request<PluginAuthResult | null>('plugins.refreshAuth', {
            provider,
            credentials
          })
        } catch {
          return null
        }
      }
    )
    if (!providerChanged && !pluginChanged) return
    await manager.setProviderAuth(providerAuthStore.runtimeAuth())
    await manager.setModels(runtimeModelsWithOAuth(modelsStore.runtimeConfig(), providerAuthStore))
  }

  const configStore = options.configStore ?? new AgentConfigStore(app.getPath('userData'))
  const pluginStore = new PluginStore(app.getPath('userData'))
  const configReady = options.configReady ?? configStore.init()
  let referenceSearchCache: {
    key: string
    expiresAt: number
    promise: Promise<AgentReferenceRoot[]>
  } | null = null

  const handle: AgentIpcHandle = (channel, handler) => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, payload: unknown) => {
      if (!isTrustedSender(event)) throw new Error('UNTRUSTED_SENDER')
      return handler(payload)
    })
  }

  const requestedDirectory = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || !value.trim()) return undefined
    return path.isAbsolute(value) ? path.resolve(value) : undefined
  }

  const searchReferences = async (searchRoot: string): Promise<AgentReferenceRoot[]> => {
    const config = configStore.get()
    if ((config.references?.length ?? 0) === 0 && !hasProjectReferences(searchRoot)) return []
    const projectFile = path.join(searchRoot, '.opencode', 'references.json')
    const projectStamp = (() => {
      try {
        return String(fsSync.statSync(projectFile).mtimeMs)
      } catch {
        return '0'
      }
    })()
    const key = `${searchRoot}:${JSON.stringify(config.references ?? [])}:${projectStamp}`
    if (
      !referenceSearchCache ||
      referenceSearchCache.key !== key ||
      referenceSearchCache.expiresAt < Date.now()
    ) {
      referenceSearchCache = {
        key,
        expiresAt: Date.now() + 60_000,
        promise: resolveReferences({
          references: config.references ?? [],
          workspacePath: searchRoot,
          globalDirectory: path.join(app.getPath('userData'), 'agent'),
          cacheDirectory: path.join(app.getPath('userData'), 'agent', 'references'),
          allowClone: false
        })
          .then((items) => items.map((item) => ({ alias: item.alias, root: item.root })))
          .catch(() => [])
      }
    }
    return referenceSearchCache.promise
  }

  return {
    ...options,
    handle,
    refreshProviderTokens,
    configStore,
    pluginStore,
    configReady,
    requestedDirectory,
    searchReferences
  }
}
