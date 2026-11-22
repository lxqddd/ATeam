import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { safeStorage } from 'electron'
import type {
  ModelCreateInput,
  ModelPublic,
  ModelRef,
  ModelUpdateInput,
  ModelVariant,
  ModelVariantInput,
  ModelVariantSettings,
  VariantReasoningEffort,
  ModelsConfigPublic,
  ProviderCreateInput,
  ProviderPublic,
  ProviderType,
  ProviderUpdateInput,
  RuntimeModelsConfig,
  RuntimeProvider
} from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '../agent/atomic-json'

interface StoredProvider {
  id: string
  name: string
  type: ProviderType
  baseURL?: string
  createdAt: string
  updatedAt: string
}

interface StoredConfig {
  version: 1
  providers: StoredProvider[]
  models: ModelPublic[]
  defaultModel: ModelRef | null
}

interface StoredSecrets {
  version: 1
  keys: Record<string, string>
}

const PROVIDER_TYPES: ProviderType[] = ['anthropic', 'openai', 'google', 'openai-compatible']
const VARIANT_EFFORTS: VariantReasoningEffort[] = ['minimal', 'low', 'medium', 'high']
const MAX_MODEL_VARIANTS = 10

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('NAME_REQUIRED')
  if (name.length > 100) throw new Error('NAME_TOO_LONG')
  return name
}

function normalizeModelId(value: string): string {
  const modelId = value.trim()
  if (!modelId) throw new Error('MODEL_ID_REQUIRED')
  if (modelId.length > 200) throw new Error('MODEL_ID_TOO_LONG')
  return modelId
}

function slugifyVariant(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeVariantSettings(value: ModelVariantSettings | undefined): ModelVariantSettings {
  if (!value || typeof value !== 'object') throw new Error('INVALID_VARIANT')
  const settings: ModelVariantSettings = {}
  if (value.reasoningEffort !== undefined && value.reasoningEffort !== null) {
    if (!VARIANT_EFFORTS.includes(value.reasoningEffort)) throw new Error('INVALID_VARIANT')
    settings.reasoningEffort = value.reasoningEffort
  }
  if (value.temperature !== undefined && value.temperature !== null) {
    if (!Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2) {
      throw new Error('INVALID_VARIANT')
    }
    settings.temperature = value.temperature
  }
  if (value.maxOutputTokens !== undefined && value.maxOutputTokens !== null) {
    if (
      !Number.isInteger(value.maxOutputTokens) ||
      value.maxOutputTokens < 1 ||
      value.maxOutputTokens > 1_000_000
    ) {
      throw new Error('INVALID_VARIANT')
    }
    settings.maxOutputTokens = value.maxOutputTokens
  }
  return settings
}

function normalizeVariants(
  value: ModelVariantInput[] | null | undefined
): ModelVariant[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length > MAX_MODEL_VARIANTS) {
    throw new Error('INVALID_VARIANT')
  }
  if (value.length === 0) return undefined
  const seen = new Set<string>()
  return value.map((input) => {
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    const id = slugifyVariant(name)
    if (!name || name.length > 50 || !id || seen.has(id)) throw new Error('INVALID_VARIANT')
    seen.add(id)
    return { id, name, settings: normalizeVariantSettings(input.settings) }
  })
}

function normalizeContextWindow(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!Number.isInteger(value) || value < 1_000 || value > 10_000_000) {
    throw new Error('INVALID_CONTEXT_WINDOW')
  }
  return value
}

function normalizeMaxOutputTokens(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
    throw new Error('INVALID_MAX_OUTPUT_TOKENS')
  }
  return value
}

function normalizeCost(value: number | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!Number.isFinite(value) || value < 0 || value > 1_000) {
    throw new Error('INVALID_COST')
  }
  return value
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('INVALID_BASE_URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('INVALID_BASE_URL')
  }
  return trimmed.replace(/\/+$/, '')
}

function normalizeProviderType(value: ProviderType): ProviderType {
  if (!PROVIDER_TYPES.includes(value)) throw new Error('INVALID_PROVIDER_TYPE')
  return value
}

export class ModelsStore {
  private readonly directory: string
  private readonly configFile: string
  private readonly secretsFile: string
  private config: StoredConfig = { version: 1, providers: [], models: [], defaultModel: null }
  private secrets: StoredSecrets = { version: 1, keys: {} }
  private chain: Promise<void> = Promise.resolve()

  constructor(userDataPath: string) {
    this.directory = path.join(userDataPath, 'models')
    this.configFile = path.join(this.directory, 'config.json')
    this.secretsFile = path.join(this.directory, 'secrets.json')
  }

  async init(): Promise<void> {
    const config = await readJsonFile<StoredConfig>(this.configFile)
    if (
      config &&
      config.version === 1 &&
      Array.isArray(config.providers) &&
      Array.isArray(config.models)
    ) {
      this.config = {
        version: 1,
        providers: config.providers,
        models: config.models,
        defaultModel: config.defaultModel ?? null
      }
      if (
        this.config.defaultModel &&
        !this.config.models.some(
          (model) =>
            model.providerId === this.config.defaultModel?.providerId &&
            model.modelId === this.config.defaultModel?.modelId
        )
      ) {
        this.config.defaultModel = this.firstModelRef()
      }
    }
    const secrets = await readJsonFile<StoredSecrets>(this.secretsFile)
    if (secrets && secrets.version === 1 && secrets.keys && typeof secrets.keys === 'object') {
      this.secrets = { version: 1, keys: secrets.keys }
    }
  }

  isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  publicConfig(): ModelsConfigPublic {
    return {
      providers: this.config.providers.map((provider) => this.toPublicProvider(provider)),
      models: this.config.models.map((model) => ({ ...model })),
      defaultModel: this.config.defaultModel ? { ...this.config.defaultModel } : null,
      encryptionAvailable: this.isEncryptionAvailable()
    }
  }

  revealApiKey(providerId: string): string | null {
    const provider = this.config.providers.find((candidate) => candidate.id === providerId)
    if (!provider) return null
    return this.decryptKey(providerId) ?? null
  }

  runtimeConfig(): RuntimeModelsConfig {
    const providers: RuntimeProvider[] = this.config.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseURL: provider.baseURL,
      apiKey: this.decryptKey(provider.id)
    }))
    return {
      providers,
      models: this.config.models.map((model) => ({ ...model })),
      defaultModel: this.config.defaultModel ? { ...this.config.defaultModel } : null
    }
  }

  addProvider(input: ProviderCreateInput): Promise<ModelsConfigPublic> {
    return this.mutate(async () => {
      const name = normalizeName(input.name)
      const type = normalizeProviderType(input.type)
      const baseURL = normalizeBaseUrl(input.baseURL)
      if (type === 'openai-compatible' && !baseURL) throw new Error('BASE_URL_REQUIRED')

      const apiKey = input.apiKey?.trim()
      if (type !== 'openai-compatible' && !apiKey) throw new Error('API_KEY_REQUIRED')

      const id = randomUUID()
      if (apiKey) {
        this.secrets.keys[id] = this.encryptOrThrow(apiKey)
      }
      const timestamp = nowIso()
      this.config.providers.push({
        id,
        name,
        type,
        baseURL,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      await this.persist()
    })
  }

  updateProvider(input: ProviderUpdateInput): Promise<ModelsConfigPublic> {
    return this.mutate(async () => {
      const provider = this.config.providers.find((candidate) => candidate.id === input.id)
      if (!provider) throw new Error('PROVIDER_NOT_FOUND')

      const nextType = input.type ? normalizeProviderType(input.type) : provider.type
      const nextBaseURL =
        input.baseURL !== undefined ? normalizeBaseUrl(input.baseURL) : provider.baseURL
      if (nextType === 'openai-compatible' && !nextBaseURL) throw new Error('BASE_URL_REQUIRED')

      const nextApiKey = input.apiKey?.trim()
      const willHaveKey = input.clearApiKey
        ? false
        : Boolean(nextApiKey) || Boolean(this.secrets.keys[provider.id])
      if (nextType !== 'openai-compatible' && !willHaveKey) throw new Error('API_KEY_REQUIRED')

      if (input.clearApiKey) {
        delete this.secrets.keys[provider.id]
      } else if (nextApiKey) {
        this.secrets.keys[provider.id] = this.encryptOrThrow(nextApiKey)
      }

      if (input.name !== undefined) provider.name = normalizeName(input.name)
      provider.type = nextType
      provider.baseURL = nextBaseURL
      provider.updatedAt = nowIso()
      await this.persist()
    })
  }

  deleteProvider(id: string): Promise<ModelsConfigPublic> {
    return this.mutate(async () => {
      const index = this.config.providers.findIndex((provider) => provider.id === id)
      if (index < 0) throw new Error('PROVIDER_NOT_FOUND')
      this.config.providers.splice(index, 1)
      this.config.models = this.config.models.filter((model) => model.providerId !== id)
      delete this.secrets.keys[id]
      if (this.config.defaultModel?.providerId === id) {
        this.config.defaultModel = this.firstModelRef()
      }
      await this.persist()
    })
  }

  addModel(input: ModelCreateInput): Promise<ModelsConfigPublic> {
    return this.mutate(async () => {
      const provider = this.config.providers.find((candidate) => candidate.id === input.providerId)
      if (!provider) throw new Error('PROVIDER_NOT_FOUND')
      const modelId = normalizeModelId(input.modelId)
      if (
        this.config.models.some(
          (model) => model.providerId === input.providerId && model.modelId === modelId
        )
      ) {
        throw new Error('MODEL_EXISTS')
      }
      const model: ModelPublic = {
        id: randomUUID(),
        providerId: input.providerId,
        modelId,
        name: input.name?.trim() || modelId,
        createdAt: nowIso()
      }
      const contextWindow = normalizeContextWindow(input.contextWindow)
      if (contextWindow !== undefined) model.contextWindow = contextWindow
      const maxOutputTokens = normalizeMaxOutputTokens(input.maxOutputTokens)
      if (maxOutputTokens !== undefined) model.maxOutputTokens = maxOutputTokens
      if (input.reasoning !== undefined) model.reasoning = input.reasoning
      if (input.attachment !== undefined) model.attachment = input.attachment
      const costInput = normalizeCost(input.costInput)
      if (costInput !== undefined) model.costInput = costInput
      const costOutput = normalizeCost(input.costOutput)
      if (costOutput !== undefined) model.costOutput = costOutput
      const variants = normalizeVariants(input.variants)
      if (variants) model.variants = variants
      if (input.applyPatch !== undefined) model.applyPatch = input.applyPatch
      if (input.compaction !== undefined) model.compaction = input.compaction
      this.config.models.push(model)
      if (!this.config.defaultModel) {
        this.config.defaultModel = { providerId: model.providerId, modelId: model.modelId }
      }
      await this.persist()
    })
  }

  updateModel(input: ModelUpdateInput): Promise<ModelsConfigPublic> {
    return this.mutate(async () => {
      const model = this.config.models.find((candidate) => candidate.id === input.id)
      if (!model) throw new Error('MODEL_NOT_FOUND')
      model.name = normalizeName(input.name)
      if (input.contextWindow !== undefined) {
        const contextWindow = normalizeContextWindow(input.contextWindow)
        if (contextWindow === undefined) delete model.contextWindow
        else model.contextWindow = contextWindow
      }
      if (input.maxOutputTokens !== undefined) {
        const maxOutputTokens = normalizeMaxOutputTokens(input.maxOutputTokens)
        if (maxOutputTokens === undefined) delete model.maxOutputTokens
        else model.maxOutputTokens = maxOutputTokens
      }
      if (input.reasoning !== undefined) model.reasoning = input.reasoning
      if (input.attachment !== undefined) model.attachment = input.attachment
      if (input.costInput !== undefined) {
        const costInput = normalizeCost(input.costInput)
        if (costInput === undefined) delete model.costInput
        else model.costInput = costInput
      }
      if (input.costOutput !== undefined) {
        const costOutput = normalizeCost(input.costOutput)
        if (costOutput === undefined) delete model.costOutput
        else model.costOutput = costOutput
      }
      if (input.variants !== undefined) {
        const variants = normalizeVariants(input.variants)
        if (variants === undefined) delete model.variants
        else model.variants = variants
      }
      if (input.applyPatch !== undefined) model.applyPatch = input.applyPatch
      if (input.compaction !== undefined) model.compaction = input.compaction
      await this.persist()
    })
  }

  deleteModel(id: string): Promise<ModelsConfigPublic> {
    return this.mutate(async () => {
      const model = this.config.models.find((candidate) => candidate.id === id)
      if (!model) throw new Error('MODEL_NOT_FOUND')
      this.config.models = this.config.models.filter((candidate) => candidate.id !== id)
      if (
        this.config.defaultModel?.providerId === model.providerId &&
        this.config.defaultModel.modelId === model.modelId
      ) {
        this.config.defaultModel = this.firstModelRef()
      }
      await this.persist()
    })
  }

  setDefault(model: ModelRef | null): Promise<ModelsConfigPublic> {
    return this.mutate(async () => {
      if (model) {
        const exists = this.config.models.some(
          (candidate) =>
            candidate.providerId === model.providerId && candidate.modelId === model.modelId
        )
        if (!exists) throw new Error('MODEL_NOT_FOUND')
        this.config.defaultModel = { ...model }
      } else {
        this.config.defaultModel = null
      }
      await this.persist()
    })
  }

  private mutate(action: () => Promise<void>): Promise<ModelsConfigPublic> {
    const run = this.chain.then(action, action)
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run.then(() => this.publicConfig())
  }

  private firstModelRef(): ModelRef | null {
    const first = this.config.models[0]
    return first ? { providerId: first.providerId, modelId: first.modelId } : null
  }

  private toPublicProvider(provider: StoredProvider): ProviderPublic {
    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseURL: provider.baseURL,
      hasApiKey: Boolean(this.secrets.keys[provider.id]),
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    }
  }

  private encryptOrThrow(apiKey: string): string {
    if (!this.isEncryptionAvailable()) throw new Error('ENCRYPTION_UNAVAILABLE')
    return safeStorage.encryptString(apiKey).toString('base64')
  }

  private decryptKey(providerId: string): string | undefined {
    const encrypted = this.secrets.keys[providerId]
    if (!encrypted) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return undefined
    }
  }

  private async persist(): Promise<void> {
    await Promise.all([
      writeJsonAtomic(this.configFile, this.config),
      writeJsonAtomic(this.secretsFile, this.secrets)
    ])
  }
}
