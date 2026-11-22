import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  MODEL_CHANNELS,
  type AvailableModel,
  type ModelCatalogEntry,
  type ModelCreateInput,
  type ModelTestResult,
  type ModelUpdateInput,
  type ModelsConfigPublic,
  type ProviderAuthRecord,
  type ProviderCreateInput,
  type ProviderOAuthStatus,
  type ProviderUpdateInput
} from '@ateam/shared'
import { modelCreateSchema, modelRefSchema, modelUpdateSchema } from './model-schema'
import type { AgentManager } from '../agent/agent-manager'
import { normalizeError } from '../agent/errors'
import { listProviderModels } from '../models/available'
import { previewApiKey } from '../models/preview'
import type { ModelCatalogStore } from '../models/catalog-store'
import type { ModelsStore } from '../stores/models'
import type { ProviderAuthStore } from '../models/oauth-tokens'
import { authorizeProvider } from '../models/oauth-flow'
import { refreshExpiringProviderAuth, runtimeModelsWithOAuth } from '../models/runtime'
import type { TrustedSender } from './trusted-sender'

const providerTypeSchema = z.enum(['anthropic', 'openai', 'google', 'openai-compatible'])
const idSchema = z.string().min(1).max(200)

const oauthConfigSchema = z.object({
  authorizationEndpoint: z.string().min(1).max(2_000),
  tokenEndpoint: z.string().min(1).max(2_000),
  clientId: z.string().min(1).max(300),
  scope: z.string().max(500).nullable().optional(),
  redirectUri: z.string().max(2_000).nullable().optional()
})

const providerCreateSchema = z.object({
  name: z.string().min(1).max(100),
  type: providerTypeSchema,
  baseURL: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  authMode: z.enum(['apiKey', 'oauth']).optional(),
  oauth: oauthConfigSchema.nullable().optional(),
  oauthClientSecret: z.string().max(1_000).nullable().optional()
})

const providerUpdateSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(100).optional(),
  type: providerTypeSchema.optional(),
  baseURL: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  clearApiKey: z.boolean().optional(),
  authMode: z.enum(['apiKey', 'oauth']).optional(),
  oauth: oauthConfigSchema.nullable().optional(),
  oauthClientSecret: z.string().max(1_000).nullable().optional(),
  clearOAuthClientSecret: z.boolean().optional()
})

const idPayloadSchema = z.object({ id: idSchema })
const testSchema = modelRefSchema

const providerPreviewSchema = z.object({
  providerId: idSchema.optional(),
  type: providerTypeSchema,
  baseURL: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional()
})

export interface ModelsIpcOptions {
  manager: AgentManager
  modelsStore: ModelsStore
  providerAuthStore: ProviderAuthStore
  catalogStore: ModelCatalogStore
  isTrustedSender: TrustedSender
}

export function registerModelsIpc(options: ModelsIpcOptions): void {
  const { manager, modelsStore, providerAuthStore, catalogStore, isTrustedSender } = options

  let syncChain: Promise<void> = Promise.resolve()

  const sync = (): Promise<void> => {
    syncChain = syncChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await manager.setModels(
            runtimeModelsWithOAuth(modelsStore.runtimeConfig(), providerAuthStore)
          )
        } catch (error) {
          console.error('[models] failed to sync the agent configuration', error)
        }
      })
    return syncChain
  }

  const handle = (channel: string, handler: (payload: unknown) => unknown): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, payload: unknown) => {
      if (!isTrustedSender(event)) throw new Error('UNTRUSTED_SENDER')
      return handler(payload)
    })
  }

  handle(MODEL_CHANNELS.get, (): ModelsConfigPublic => modelsStore.publicConfig())

  handle(MODEL_CHANNELS.providerAdd, async (payload): Promise<ModelsConfigPublic> => {
    const input = providerCreateSchema.parse(payload) as ProviderCreateInput
    const config = await modelsStore.addProvider(input)
    await sync()
    return config
  })

  handle(MODEL_CHANNELS.providerUpdate, async (payload): Promise<ModelsConfigPublic> => {
    const input = providerUpdateSchema.parse(payload) as ProviderUpdateInput
    const before = modelsStore.publicConfig().providers.find((provider) => provider.id === input.id)
    const config = await modelsStore.updateProvider(input)
    const after = config.providers.find((provider) => provider.id === input.id)
    const oauthChanged =
      before?.authMode !== after?.authMode ||
      before?.type !== after?.type ||
      before?.baseURL !== after?.baseURL ||
      before?.oauth?.authorizationEndpoint !== after?.oauth?.authorizationEndpoint ||
      before?.oauth?.tokenEndpoint !== after?.oauth?.tokenEndpoint ||
      before?.oauth?.clientId !== after?.oauth?.clientId
    if (oauthChanged) await providerAuthStore.remove(input.id)
    await sync()
    return config
  })

  handle(MODEL_CHANNELS.providerDelete, async (payload): Promise<ModelsConfigPublic> => {
    const { id } = idPayloadSchema.parse(payload)
    const config = await modelsStore.deleteProvider(id)
    await providerAuthStore.remove(id)
    await sync()
    return config
  })

  handle(MODEL_CHANNELS.catalog, (payload): Promise<ModelCatalogEntry[]> => {
    const { refresh } = z.object({ refresh: z.boolean().optional() }).parse(payload ?? {})
    return catalogStore.get(refresh === true)
  })

  handle(MODEL_CHANNELS.providerRevealKey, (payload): string | null => {
    const { id } = idPayloadSchema.parse(payload)
    return modelsStore.revealApiKey(id)
  })

  handle(MODEL_CHANNELS.modelAdd, async (payload): Promise<ModelsConfigPublic> => {
    const input = modelCreateSchema.parse(payload) as ModelCreateInput
    const config = await modelsStore.addModel(input)
    await sync()
    return config
  })

  handle(MODEL_CHANNELS.modelUpdate, async (payload): Promise<ModelsConfigPublic> => {
    const input = modelUpdateSchema.parse(payload) as ModelUpdateInput
    const config = await modelsStore.updateModel(input)
    await sync()
    return config
  })

  handle(MODEL_CHANNELS.modelDelete, async (payload): Promise<ModelsConfigPublic> => {
    const { id } = idPayloadSchema.parse(payload)
    const config = await modelsStore.deleteModel(id)
    await sync()
    return config
  })

  handle(MODEL_CHANNELS.defaultSet, async (payload): Promise<ModelsConfigPublic> => {
    const model = payload === null ? null : modelRefSchema.parse(payload)
    const config = await modelsStore.setDefault(model)
    await sync()
    return config
  })

  handle(MODEL_CHANNELS.providerAuthStatuses, (): ProviderOAuthStatus[] => {
    return providerAuthStore.statuses(modelsStore.publicConfig().providers)
  })

  handle(MODEL_CHANNELS.providerOAuthAuthorize, async (payload): Promise<ProviderOAuthStatus[]> => {
    const { id } = idPayloadSchema.parse(payload)
    const provider = modelsStore.publicConfig().providers.find((candidate) => candidate.id === id)
    if (!provider) throw new Error('PROVIDER_NOT_FOUND')
    if (provider.authMode !== 'oauth') throw new Error('OAUTH_NOT_CONFIGURED')
    const oauth = modelsStore.oauthConfig(id)
    if (!oauth) throw new Error('OAUTH_NOT_CONFIGURED')
    const tokens = await authorizeProvider({
      providerId: id,
      providerName: provider.name,
      oauth,
      clientSecret: oauth.clientSecret,
      authStore: providerAuthStore,
      openExternal: (url) => shell.openExternal(url)
    })
    const record: ProviderAuthRecord = {
      providerId: id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      tokenEndpoint: oauth.tokenEndpoint,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      scope: tokens.scope
    }
    await providerAuthStore.set(record)
    await sync()
    return providerAuthStore.statuses(modelsStore.publicConfig().providers)
  })

  handle(MODEL_CHANNELS.providerOAuthLogout, async (payload): Promise<ProviderOAuthStatus[]> => {
    const { id } = idPayloadSchema.parse(payload)
    await providerAuthStore.remove(id)
    await sync()
    return providerAuthStore.statuses(modelsStore.publicConfig().providers)
  })

  handle(MODEL_CHANNELS.providerModels, async (payload): Promise<AvailableModel[]> => {
    const { id } = idPayloadSchema.parse(payload)
    await refreshExpiringProviderAuth(providerAuthStore)
    const provider = runtimeModelsWithOAuth(
      modelsStore.runtimeConfig(),
      providerAuthStore
    ).providers.find((candidate) => candidate.id === id)
    if (!provider) throw new Error('PROVIDER_NOT_FOUND')
    return listProviderModels(provider)
  })

  handle(MODEL_CHANNELS.providerModelsPreview, async (payload): Promise<AvailableModel[]> => {
    const input = providerPreviewSchema.parse(payload)
    const injected = input.providerId
      ? runtimeModelsWithOAuth(modelsStore.runtimeConfig(), providerAuthStore).providers.find(
          (candidate) => candidate.id === input.providerId
        )
      : undefined
    const apiKey = previewApiKey(input, injected)
    if (input.type !== 'openai-compatible' && !apiKey) {
      throw new Error('API_KEY_REQUIRED')
    }
    return listProviderModels({
      id: input.providerId ?? 'preview',
      name: 'Preview',
      type: input.type,
      baseURL: input.baseURL?.trim() || undefined,
      apiKey
    })
  })

  handle(MODEL_CHANNELS.test, async (payload): Promise<ModelTestResult> => {
    const { providerId, modelId } = testSchema.parse(payload)
    const config = modelsStore.publicConfig()
    const provider = config.providers.find((candidate) => candidate.id === providerId)
    const model = config.models.find(
      (candidate) => candidate.providerId === providerId && candidate.modelId === modelId
    )
    if (!provider || !model) {
      return { ok: false, message: 'The provider or model is not configured.' }
    }
    if (!manager.isReady()) {
      return { ok: false, message: 'The agent is not running.' }
    }
    await refreshExpiringProviderAuth(providerAuthStore)
    await sync()
    try {
      return await manager.request<ModelTestResult>('models.test', { providerId, modelId })
    } catch (error) {
      return { ok: false, message: normalizeError(error) }
    }
  })
}
