import { randomUUID } from 'node:crypto'
import path from 'node:path'
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
  ProviderAuthMode,
  ProviderCreateInput,
  ProviderOAuthConfig,
  ProviderPublic,
  ProviderType,
  ProviderUpdateInput,
  RuntimeModelsConfig,
  RuntimeProvider
} from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '@ateam/agent-core/storage'
import { ProviderAuthStore } from '../providers/provider-auth-store'

interface StoredProvider {
  id: string
  name: string
  type: ProviderType
  baseURL?: string
  authMode?: ProviderAuthMode
  oauth?: ProviderOAuthConfig
  createdAt: string
  updatedAt: string
}

interface StoredConfig {
  version: 1
  providers: StoredProvider[]
  models: ModelPublic[]
  defaultModel: ModelRef | null
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

function normalizeOAuthEndpoint(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_OAUTH_CONFIG')
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('INVALID_OAUTH_CONFIG')
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('INVALID_OAUTH_CONFIG')
  }
  if (value.length > 2_000) throw new Error('INVALID_OAUTH_CONFIG')
  return url.toString()
}

function normalizeOAuthConfig(
  value: ProviderOAuthConfig | null | undefined,
  existing?: ProviderOAuthConfig
): ProviderOAuthConfig | null {
  const raw = value === undefined ? existing : value
  if (!raw) return null
  const clientId = typeof raw.clientId === 'string' ? raw.clientId.trim() : ''
  if (!clientId || clientId.length > 300) throw new Error('INVALID_OAUTH_CONFIG')
  const scope =
    typeof raw.scope === 'string' && raw.scope.trim() ? raw.scope.trim().slice(0, 500) : null
  if (scope && (scope.includes('\u0000') || scope.includes('\r') || scope.includes('\n'))) {
    throw new Error('INVALID_OAUTH_CONFIG')
  }
  let redirectUri: string | null = null
  if (raw.redirectUri) {
    let url: URL
    try {
      url = new URL(raw.redirectUri)
    } catch {
      throw new Error('INVALID_OAUTH_CONFIG')
    }
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
    ) {
      throw new Error('INVALID_OAUTH_CONFIG')
    }
    redirectUri = raw.redirectUri
  }
  return {
    authorizationEndpoint: normalizeOAuthEndpoint(raw.authorizationEndpoint),
    tokenEndpoint: normalizeOAuthEndpoint(raw.tokenEndpoint),
    clientId,
    scope,
    redirectUri
  }
}

function normalizeAuthMode(
  value: ProviderAuthMode | undefined,
  fallback: ProviderAuthMode
): ProviderAuthMode {
  const mode = value ?? fallback
  if (mode !== 'apiKey' && mode !== 'oauth') throw new Error('INVALID_AUTH_MODE')
  return mode
}

function supportsOAuth(type: ProviderType): boolean {
  return type === 'openai' || type === 'openai-compatible'
}

function normalizeProviderType(value: ProviderType): ProviderType {
  if (!PROVIDER_TYPES.includes(value)) throw new Error('INVALID_PROVIDER_TYPE')
  return value
}

export class ModelConfigStore {
  private readonly directory: string
  private readonly configFile: string
  private config: StoredConfig = { version: 1, providers: [], models: [], defaultModel: null }
  private chain: Promise<void> = Promise.resolve()

  constructor(
    userDataPath: string,
    private readonly authStore: ProviderAuthStore = new ProviderAuthStore(userDataPath)
  ) {
    this.directory = path.join(userDataPath, 'models')
    this.configFile = path.join(this.directory, 'config.json')
  }

  async init(): Promise<void> {
    await this.authStore.init()
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
  }

  publicConfig(): ModelsConfigPublic {
    return {
      providers: this.config.providers.map((provider) => this.toPublicProvider(provider)),
      models: this.config.models.map((model) => ({ ...model })),
      defaultModel: this.config.defaultModel ? { ...this.config.defaultModel } : null
    }
  }

  revealApiKey(providerId: string): string | null {
    const provider = this.config.providers.find((candidate) => candidate.id === providerId)
    if (!provider) return null
    return this.authStore.getApiKey(providerId)
  }

  runtimeConfig(): RuntimeModelsConfig {
    const providers: RuntimeProvider[] = this.config.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseURL: provider.baseURL,
      apiKey: this.authStore.getApiKey(provider.id) ?? undefined
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
      const authMode = normalizeAuthMode(input.authMode, 'apiKey')
      const oauth = normalizeOAuthConfig(input.oauth)
      if (authMode === 'oauth') {
        if (!supportsOAuth(type)) throw new Error('OAUTH_UNSUPPORTED_PROVIDER')
        if (!oauth) throw new Error('INVALID_OAUTH_CONFIG')
      }

      const apiKey = input.apiKey?.trim()
      if (authMode === 'apiKey' && type !== 'openai-compatible' && !apiKey) {
        throw new Error('API_KEY_REQUIRED')
      }

      const id = randomUUID()
      if (apiKey) await this.authStore.setApiKey(id, apiKey)
      if (authMode === 'oauth' && input.oauthClientSecret?.trim()) {
        await this.authStore.setClientSecret(id, input.oauthClientSecret.trim())
      }
      const timestamp = nowIso()
      const provider: StoredProvider = {
        id,
        name,
        type,
        baseURL,
        createdAt: timestamp,
        updatedAt: timestamp
      }
      if (authMode === 'oauth' && oauth) {
        provider.authMode = 'oauth'
        provider.oauth = oauth
      }
      this.config.providers.push(provider)
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
      const nextAuthMode = normalizeAuthMode(input.authMode, provider.authMode ?? 'apiKey')
      const nextOAuth = normalizeOAuthConfig(input.oauth, provider.oauth)
      if (nextAuthMode === 'oauth') {
        if (!supportsOAuth(nextType)) throw new Error('OAUTH_UNSUPPORTED_PROVIDER')
        if (!nextOAuth) throw new Error('INVALID_OAUTH_CONFIG')
      }

      const nextApiKey = input.apiKey?.trim()
      const willHaveKey = input.clearApiKey
        ? false
        : Boolean(nextApiKey) || this.authStore.hasApiKey(provider.id)
      if (nextAuthMode === 'apiKey' && nextType !== 'openai-compatible' && !willHaveKey) {
        throw new Error('API_KEY_REQUIRED')
      }

      if (input.clearApiKey) {
        await this.authStore.removeApiKey(provider.id)
      } else if (nextApiKey) {
        await this.authStore.setApiKey(provider.id, nextApiKey)
      }
      if (nextAuthMode !== 'oauth' || input.clearOAuthClientSecret) {
        await this.authStore.removeClientSecret(provider.id)
      } else if (input.oauthClientSecret?.trim()) {
        await this.authStore.setClientSecret(provider.id, input.oauthClientSecret.trim())
      }

      if (input.name !== undefined) provider.name = normalizeName(input.name)
      provider.type = nextType
      provider.baseURL = nextBaseURL
      if (nextAuthMode === 'oauth' && nextOAuth) {
        provider.authMode = 'oauth'
        provider.oauth = nextOAuth
      } else {
        delete provider.authMode
        delete provider.oauth
      }
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
      await this.authStore.remove(id)
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
      hasApiKey: this.authStore.hasApiKey(provider.id),
      authMode: provider.authMode ?? 'apiKey',
      oauth: provider.oauth ? { ...provider.oauth } : null,
      hasOAuthClientSecret: Boolean(this.authStore.getClientSecret(provider.id)),
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    }
  }

  oauthConfig(providerId: string): (ProviderOAuthConfig & { clientSecret: string | null }) | null {
    const provider = this.config.providers.find((candidate) => candidate.id === providerId)
    if (!provider?.oauth) return null
    return { ...provider.oauth, clientSecret: this.authStore.getClientSecret(providerId) }
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.configFile, this.config)
  }
}
