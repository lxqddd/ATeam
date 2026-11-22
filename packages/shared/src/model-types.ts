export type ProviderType = 'anthropic' | 'openai' | 'google' | 'openai-compatible'

export interface ModelRef {
  providerId: string
  modelId: string
  variant?: string | null
}

export type VariantReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

export interface ModelVariantSettings {
  reasoningEffort?: VariantReasoningEffort | null
  temperature?: number | null
  maxOutputTokens?: number | null
}

export interface ModelVariant {
  id: string
  name: string
  settings: ModelVariantSettings
}

export interface ModelVariantInput {
  name: string
  settings: ModelVariantSettings
}

export interface ProviderPublic {
  id: string
  name: string
  type: ProviderType
  baseURL?: string
  hasApiKey: boolean
  createdAt: string
  updatedAt: string
}

export interface ModelPublic {
  id: string
  providerId: string
  modelId: string
  name: string
  createdAt: string
  contextWindow?: number
  maxOutputTokens?: number
  reasoning?: boolean
  attachment?: boolean
  /** USD per 1M input tokens. */
  costInput?: number
  /** USD per 1M output tokens. */
  costOutput?: number
  variants?: ModelVariant[]
  /** Model handles the multi-file patch tool; edit/write are hidden. */
  applyPatch?: boolean
  /** Provider performs context compaction server-side. */
  compaction?: boolean
}

export interface ModelCatalogEntry {
  providerId: string
  providerName: string
  providerApi: string | null
  providerType: ProviderType | null
  modelId: string
  name: string
  contextWindow: number | null
  maxOutputTokens: number | null
  reasoning: boolean
  attachment: boolean
  costInput: number | null
  costOutput: number | null
}

/** A model exposed by the provider's own model-listing endpoint. */
export interface AvailableModel {
  id: string
  name?: string
}

/** Provider fields used to preview the provider's model list before saving. */
export interface ProviderModelListInput {
  /** Saved provider id; its stored key is used when apiKey is omitted. */
  providerId?: string
  type: ProviderType
  baseURL?: string
  apiKey?: string
}

export interface ModelsConfigPublic {
  providers: ProviderPublic[]
  models: ModelPublic[]
  defaultModel: ModelRef | null
  encryptionAvailable: boolean
}

export interface ProviderCreateInput {
  name: string
  type: ProviderType
  baseURL?: string
  apiKey?: string
}

export interface ProviderUpdateInput {
  id: string
  name?: string
  type?: ProviderType
  baseURL?: string
  apiKey?: string
  clearApiKey?: boolean
}

export interface ModelCreateInput {
  providerId: string
  modelId: string
  name?: string
  contextWindow?: number
  maxOutputTokens?: number
  reasoning?: boolean
  attachment?: boolean
  costInput?: number
  costOutput?: number
  variants?: ModelVariantInput[]
  applyPatch?: boolean
  compaction?: boolean
}

export interface ModelUpdateInput {
  id: string
  name: string
  contextWindow?: number | null
  maxOutputTokens?: number | null
  reasoning?: boolean
  attachment?: boolean
  costInput?: number | null
  costOutput?: number | null
  variants?: ModelVariantInput[] | null
  applyPatch?: boolean
  compaction?: boolean
}

export interface ModelTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}
