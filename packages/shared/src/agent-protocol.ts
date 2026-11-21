import type {
  McpServerInput,
  MessageAttachment,
  PermissionRuleInput,
  RuntimeWebSearchConfig,
  SessionSettings
} from './agent-types'
import type { ModelPublic, ModelRef, ProviderType } from './model-types'

/** Provider config with the decrypted key; main → agent worker only. */
export interface RuntimeProvider {
  id: string
  name: string
  type: ProviderType
  baseURL?: string
  apiKey?: string
}

export interface RuntimeModelsConfig {
  providers: RuntimeProvider[]
  models: ModelPublic[]
  defaultModel: ModelRef | null
}

export type WorkerRequest =
  | {
      id: string
      method: 'init'
      params: {
        userDataPath: string
        workspacePath: string
        appVersion: string
        models: RuntimeModelsConfig
        webSearch?: RuntimeWebSearchConfig | null
      }
    }
  | { id: string; method: 'setModels'; params: { models: RuntimeModelsConfig } }
  | {
      id: string
      method: 'setWebSearch'
      params: { config: RuntimeWebSearchConfig | null }
    }
  | { id: string; method: 'agents.list'; params?: undefined }
  | { id: string; method: 'sessions.list'; params?: undefined }
  | { id: string; method: 'sessions.create'; params?: undefined }
  | { id: string; method: 'sessions.rename'; params: { id: string; title: string } }
  | { id: string; method: 'sessions.delete'; params: { id: string } }
  | {
      id: string
      method: 'sessions.setModel'
      params: { id: string; model: ModelRef | null }
    }
  | {
      id: string
      method: 'sessions.setSettings'
      params: { id: string; settings: SessionSettings }
    }
  | {
      id: string
      method: 'sessions.setAgent'
      params: { id: string; agent: string | null }
    }
  | { id: string; method: 'sessions.compact'; params: { id: string; force?: boolean } }
  | { id: string; method: 'sessions.undo'; params: { id: string; messageId?: string } }
  | { id: string; method: 'sessions.redo'; params: { id: string } }
  | { id: string; method: 'messages.list'; params: { sessionId: string } }
  | {
      id: string
      method: 'chat.send'
      params: {
        sessionId: string
        text: string
        model?: ModelRef | null
        attachments?: MessageAttachment[]
      }
    }
  | { id: string; method: 'chat.stop'; params: { sessionId: string } }
  | { id: string; method: 'chat.retry'; params: { sessionId: string } }
  | { id: string; method: 'permissions.list'; params?: undefined }
  | {
      id: string
      method: 'permission.reply'
      params: { requestId: string; decision: 'once' | 'always' | 'reject' }
    }
  | { id: string; method: 'permissions.rules'; params: { sessionId?: string } }
  | {
      id: string
      method: 'permissions.addRule'
      params: PermissionRuleInput
    }
  | { id: string; method: 'permissions.removeRule'; params: { id: string } }
  | { id: string; method: 'mcp.list'; params?: undefined }
  | { id: string; method: 'mcp.statuses'; params: { probe?: boolean } }
  | { id: string; method: 'mcp.add'; params: McpServerInput }
  | {
      id: string
      method: 'mcp.update'
      params: { id: string; input: Partial<McpServerInput> }
    }
  | { id: string; method: 'mcp.remove'; params: { id: string } }
  | {
      id: string
      method: 'models.test'
      params: { providerId: string; modelId: string }
    }
  | { id: string; method: 'shutdown'; params?: undefined }

export type WorkerMessage =
  | { kind: 'ready'; status: { pid: number } }
  | { kind: 'response'; id: string; ok: true; result: unknown }
  | { kind: 'response'; id: string; ok: false; error: string }
  | { kind: 'event'; envelope: import('./agent-types').AgentEventEnvelope }
