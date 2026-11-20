import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  MODEL_CHANNELS,
  type ModelCreateInput,
  type ModelTestResult,
  type ModelUpdateInput,
  type ModelsConfigPublic,
  type ProviderCreateInput,
  type ProviderUpdateInput
} from '@ateam/shared'
import type { AgentManager } from '../agent/agent-manager'
import { normalizeError } from '../agent/errors'
import type { ModelsStore } from '../models/store'
import type { TrustedSender } from './trusted-sender'

const providerTypeSchema = z.enum(['anthropic', 'openai', 'google', 'openai-compatible'])
const idSchema = z.string().min(1).max(200)

const providerCreateSchema = z.object({
  name: z.string().min(1).max(100),
  type: providerTypeSchema,
  baseURL: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional()
})

const providerUpdateSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(100).optional(),
  type: providerTypeSchema.optional(),
  baseURL: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  clearApiKey: z.boolean().optional()
})

const modelCreateSchema = z.object({
  providerId: idSchema,
  modelId: z.string().min(1).max(200),
  name: z.string().max(100).optional()
})

const modelUpdateSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(100)
})

const idPayloadSchema = z.object({ id: idSchema })
const modelRefSchema = z.object({
  providerId: idSchema,
  modelId: z.string().min(1).max(200)
})
const testSchema = modelRefSchema

export interface ModelsIpcOptions {
  manager: AgentManager
  modelsStore: ModelsStore
  isTrustedSender: TrustedSender
}

export function registerModelsIpc(options: ModelsIpcOptions): void {
  const { manager, modelsStore, isTrustedSender } = options

  let syncChain: Promise<void> = Promise.resolve()

  const sync = (): Promise<void> => {
    syncChain = syncChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await manager.setModels(modelsStore.runtimeConfig())
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
    const config = await modelsStore.updateProvider(input)
    await sync()
    return config
  })

  handle(MODEL_CHANNELS.providerDelete, async (payload): Promise<ModelsConfigPublic> => {
    const { id } = idPayloadSchema.parse(payload)
    const config = await modelsStore.deleteProvider(id)
    await sync()
    return config
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
    await sync()
    try {
      return await manager.request<ModelTestResult>('models.test', { providerId, modelId })
    } catch (error) {
      return { ok: false, message: normalizeError(error) }
    }
  })
}
