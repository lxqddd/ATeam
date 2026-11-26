import type {
  McpServerInput,
  MessageAttachment,
  PermissionRuleInput,
  PluginAuthCredentials,
  QuestionAnswer,
  RuntimeWebSearchConfig,
  SessionSettings
} from './agent-types'
import type { ModelPublic, ModelRef, ProviderType, RuntimeProviderAuth } from './model-types'
import type { VcsDiffMode } from './vcs-types'

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
        providerAuth?: RuntimeProviderAuth[]
        webSearch?: RuntimeWebSearchConfig | null
        mcpAuth?: import('./agent-types').McpAuthRecord[]
      }
    }
  | { id: string; method: 'setModels'; params: { models: RuntimeModelsConfig } }
  | { id: string; method: 'setProviderAuth'; params: { auths: RuntimeProviderAuth[] } }
  | {
      id: string
      method: 'setWebSearch'
      params: { config: RuntimeWebSearchConfig | null }
    }
  | { id: string; method: 'config.reload'; params?: { workspace?: string } }
  | { id: string; method: 'agents.list'; params?: { workspace?: string } }
  | { id: string; method: 'commands.list'; params?: { workspace?: string } }
  | {
      id: string
      method: 'commands.expand'
      params: { template: string; args: string; workspace?: string }
    }
  | {
      id: string
      method: 'commands.run'
      params: { sessionId: string; name: string; args?: string }
    }
  | { id: string; method: 'sessions.list'; params?: undefined }
  | {
      id: string
      method: 'sessions.create'
      params?: { directory?: string | null }
    }
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
  | {
      id: string
      method: 'sessions.setDirectory'
      params: { id: string; directory: string | null }
    }
  | { id: string; method: 'sessions.compact'; params: { id: string; force?: boolean } }
  | {
      id: string
      method: 'sessions.undo'
      params: { id: string; messageId?: string; stepIndex?: number }
    }
  | { id: string; method: 'sessions.redo'; params: { id: string } }
  | { id: string; method: 'sessions.fork'; params: { id: string; messageId?: string } }
  | { id: string; method: 'sessions.search'; params: { query: string } }
  | { id: string; method: 'plan.get'; params: { sessionId: string } }
  | {
      id: string
      method: 'sessions.changes'
      params: { sessionId: string; messageId?: string }
    }
  | {
      id: string
      method: 'sessions.changesSummary'
      params: { sessionId: string }
    }
  | {
      id: string
      method: 'sessions.revertFiles'
      params: { sessionId: string; messageId: string; paths?: string[] }
    }
  | {
      id: string
      method: 'sessions.unrevertFiles'
      params: { sessionId: string; paths?: string[] }
    }
  | { id: string; method: 'vcs.status'; params: { sessionId: string } }
  | {
      id: string
      method: 'vcs.diff'
      params: { sessionId: string; mode?: VcsDiffMode; base?: string; path?: string }
    }
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
  | {
      id: string
      method: 'chat.steer'
      params: {
        sessionId: string
        text: string
        strategy?: import('./agent-types').SteerStrategy
        attachments?: MessageAttachment[]
      }
    }
  | { id: string; method: 'chat.queue.remove'; params: { sessionId: string; id: string } }
  | { id: string; method: 'background.list'; params?: { sessionId?: string } }
  | { id: string; method: 'background.cancel'; params: { taskId: string } }
  | { id: string; method: 'permissions.list'; params?: undefined }
  | {
      id: string
      method: 'permission.reply'
      params: { requestId: string; decision: 'once' | 'always' | 'reject' }
    }
  | { id: string; method: 'questions.list'; params?: undefined }
  | {
      id: string
      method: 'question.reply'
      params: { questionId: string; answer: QuestionAnswer }
    }
  | { id: string; method: 'permissions.rules'; params: { sessionId?: string } }
  | { id: string; method: 'permissions.overview'; params?: { workspace?: string } }
  | {
      id: string
      method: 'permissions.addRule'
      params: PermissionRuleInput
    }
  | { id: string; method: 'permissions.removeRule'; params: { id: string } }
  | { id: string; method: 'mcp.list'; params?: { workspace?: string } }
  | {
      id: string
      method: 'mcp.statuses'
      params: { probe?: boolean; workspace?: string }
    }
  | { id: string; method: 'mcp.add'; params: McpServerInput }
  | {
      id: string
      method: 'mcp.update'
      params: { id: string; input: Partial<McpServerInput> }
    }
  | { id: string; method: 'mcp.remove'; params: { id: string } }
  | {
      id: string
      method: 'mcp.prompt'
      params: {
        server: string
        prompt: string
        arguments?: Record<string, string>
        workspace?: string
      }
    }
  | {
      id: string
      method: 'mcp.setAuth'
      params: { auths: import('./agent-types').McpAuthRecord[] }
    }
  | {
      id: string
      method: 'plugins.authMethods'
      params?: { workspace?: string }
    }
  | {
      id: string
      method: 'plugins.authorizeAuth'
      params: { workspace: string; id: string; answers: Record<string, string> }
    }
  | {
      id: string
      method: 'plugins.completeAuth'
      params: { workspace: string; requestId: string; code?: string }
    }
  | {
      id: string
      method: 'plugins.refreshAuth'
      params: {
        workspace?: string
        provider: string
        credentials: PluginAuthCredentials
      }
    }
  | {
      id: string
      method: 'models.test'
      params: { providerId: string; modelId: string }
    }
  | { id: string; method: 'metrics.get'; params?: undefined }
  | { id: string; method: 'shutdown'; params?: undefined }

export type WorkerMessage =
  | { kind: 'ready'; status: { pid: number } }
  | { kind: 'response'; id: string; ok: true; result: unknown }
  | { kind: 'response'; id: string; ok: false; error: string }
  | { kind: 'event'; envelope: import('./agent-types').AgentEventEnvelope }
  | { kind: 'mcp-auth'; auth: import('./agent-types').McpAuthRecord }
  | {
      kind: 'browser'
      requestId: string
      sessionId: string
      method: string
      params?: Record<string, unknown>
    }

/** Main → agent worker message resolving a browser request. */
export interface BrowserResultMessage {
  method: 'browser.result'
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}
