export type ProviderType = 'anthropic' | 'openai' | 'google' | 'openai-compatible'

export interface ModelRef {
  providerId: string
  modelId: string
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
}

export interface ModelUpdateInput {
  id: string
  name: string
}

export interface ModelTestResult {
  ok: boolean
  message: string
  latencyMs?: number
}
