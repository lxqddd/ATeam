import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { z } from 'zod'
import {
  AGENT_CHANNELS,
  type AgentConfig,
  type AgentDefinition,
  type AgentInfo,
  type AgentStatus,
  type CommandDefinition,
  type McpAuthStatus,
  type McpServerConfig,
  type McpServerStatus,
  type MessageAttachment,
  type MessagesSnapshot,
  type PermissionRequest,
  type PermissionRule,
  type QuestionRequest,
  type SessionMeta,
  type SessionSearchResult,
  type SessionUndoResult,
  type WebSearchProviderPublic
} from '@ateam/shared'
import type { AgentManager } from '../agent/agent-manager'
import { AgentConfigStore } from '../agent/config/config-store'
import { discoverInstructionFiles } from '../agent/config/instructions'
import { discoverFormatters } from '../agent/integrations/formatters'
import { availableLspServers } from '../agent/integrations/lsp'
import {
  attachmentDataUrl,
  attachmentDirectory,
  removeAttachment,
  saveAttachment
} from '../agent/attachments'
import { expandCommandTemplate, runWorkspaceShell } from '../agent/commands'
import { modelRefSchema } from './model-schema'
import type { McpAuthStore } from '../agent/integrations/mcp-auth-store'
import { authorizeMcpServer } from '../agent/integrations/mcp-oauth-flow'
import type { ProviderAuthStore } from '../models/oauth-tokens'
import { refreshExpiringProviderAuth, runtimeModelsWithOAuth } from '../models/runtime'
import { agentConfigPatchSchema } from './config-schema'
import { webSearchUpdateSchema } from './websearch-schema'
import { normalizeImageAttachment } from '../attachments/image'
import { searchWorkspaceFiles } from '../files/search'
import type { ModelsStore } from '../stores/models'
import type { WebSearchStore } from '../stores/websearch'
import type { TrustedSender } from './trusted-sender'

const idSchema = z.string().min(1).max(200)
const renameSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(200)
})
const idPayloadSchema = z.object({ id: idSchema })
const mcpServerInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  type: z.enum(['local', 'remote']),
  command: z.string().max(500).nullable().optional(),
  args: z.array(z.string().max(2_000)).max(100).optional(),
  url: z.string().max(2_000).nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  oauthClientId: z.string().max(300).nullable().optional(),
  oauthScope: z.string().max(500).nullable().optional(),
  oauthRedirectUri: z.string().max(2_000).nullable().optional()
})
const mcpUpdateSchema = z.object({
  id: idSchema,
  input: mcpServerInputSchema.partial()
})
const sessionSetModelSchema = z.object({
  id: idSchema,
  model: modelRefSchema.nullable()
})
const sessionSettingsSchema = z.object({
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).nullable(),
  permissionMode: z.enum(['plan', 'ask', 'acceptEdits', 'auto'])
})
const sessionSetSettingsSchema = z.object({
  id: idSchema,
  settings: sessionSettingsSchema
})
const sessionIdSchema = z.object({ sessionId: idSchema })
const attachmentSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(300),
  mimeType: z.string().max(200),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(20 * 1024 * 1024),
  kind: z.enum(['text', 'image', 'pdf']),
  path: z.string().min(1).max(2_000)
})
const chatSendSchema = z.object({
  sessionId: idSchema,
  text: z.string().max(100_000),
  model: modelRefSchema.nullable().optional(),
  attachments: z.array(attachmentSchema).max(10).optional()
})
const permissionReplySchema = z.object({
  requestId: idSchema,
  decision: z.enum(['once', 'always', 'reject'])
})
const permissionRulesSchema = z.object({ sessionId: idSchema.optional() }).optional()
const permissionRuleInputSchema = z.object({
  action: z.enum([
    'read',
    'list',
    'glob',
    'grep',
    'write',
    'edit',
    'shell',
    'external_directory',
    'mcp',
    'webfetch',
    'websearch',
    'skill',
    'subagent',
    '*'
  ]),
  resource: z.string().trim().min(1).max(500),
  effect: z.enum(['allow', 'ask', 'deny']),
  sessionId: idSchema.nullable()
})
const questionReplySchema = z.object({
  questionId: idSchema,
  answer: z.object({
    selected: z.array(z.string().max(200)).max(10),
    custom: z.string().max(2_000).nullable(),
    cancelled: z.boolean().optional(),
    timedOut: z.boolean().optional()
  })
})
const externalUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}, 'INVALID_URL')

export interface AgentIpcOptions {
  manager: AgentManager
  modelsStore: ModelsStore
  webSearchStore: WebSearchStore
  mcpAuthStore: McpAuthStore
  providerAuthStore: ProviderAuthStore
  workspacePath: string
  isTrustedSender: TrustedSender
}

export function registerAgentIpc(options: AgentIpcOptions): void {
  const {
    manager,
    modelsStore,
    webSearchStore,
    mcpAuthStore,
    providerAuthStore,
    workspacePath,
    isTrustedSender
  } = options

  const refreshProviderTokens = async (): Promise<void> => {
    const changed = await refreshExpiringProviderAuth(providerAuthStore)
    if (!changed) return
    await manager.setModels(runtimeModelsWithOAuth(modelsStore.runtimeConfig(), providerAuthStore))
  }
  const configStore = new AgentConfigStore(app.getPath('userData'))
  const configReady = configStore.init()

  const handle = (channel: string, handler: (payload: unknown) => unknown): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, payload: unknown) => {
      if (!isTrustedSender(event)) throw new Error('UNTRUSTED_SENDER')
      return handler(payload)
    })
  }

  handle(AGENT_CHANNELS.status, (): AgentStatus => manager.getStatus())

  handle(AGENT_CHANNELS.restart, async (): Promise<AgentStatus> => {
    return manager.restart(modelsStore.runtimeConfig())
  })

  handle(AGENT_CHANNELS.info, async (): Promise<AgentInfo> => {
    let instructionFiles: string[] = []
    try {
      const files = await discoverInstructionFiles(workspacePath, app.getPath('userData'))
      instructionFiles = files.map((file) => file.path)
    } catch {
      /* instruction discovery is best effort */
    }
    let formatters: string[] = []
    try {
      formatters = (await discoverFormatters(workspacePath)).map((formatter) => formatter.id)
    } catch {
      /* formatter discovery is best effort */
    }
    let lspServers: string[] = []
    try {
      lspServers = await availableLspServers(workspacePath)
    } catch {
      /* language server discovery is best effort */
    }
    return {
      workspacePath,
      appVersion: app.getVersion(),
      encryptionAvailable: modelsStore.isEncryptionAvailable(),
      instructionFiles,
      lspServers,
      formatters
    }
  })

  handle(AGENT_CHANNELS.agentsList, (): Promise<AgentDefinition[]> =>
    manager.request('agents.list')
  )

  handle(AGENT_CHANNELS.commandsList, (): Promise<CommandDefinition[]> =>
    manager.request('commands.list')
  )

  handle(AGENT_CHANNELS.commandExpand, async (payload): Promise<string> => {
    const { template, args } = z
      .object({ template: z.string().max(100_000), args: z.string().max(10_000) })
      .parse(payload)
    return expandCommandTemplate(template, args, (command) =>
      runWorkspaceShell(command, workspacePath)
    )
  })

  handle(AGENT_CHANNELS.sessionsList, (): Promise<SessionMeta[]> =>
    manager.request('sessions.list')
  )

  handle(AGENT_CHANNELS.sessionCreate, (): Promise<SessionMeta> =>
    manager.request('sessions.create')
  )

  handle(AGENT_CHANNELS.sessionRename, (payload): Promise<SessionMeta> => {
    const { id, title } = renameSchema.parse(payload)
    return manager.request('sessions.rename', { id, title })
  })

  handle(AGENT_CHANNELS.sessionDelete, async (payload): Promise<void> => {
    const { id } = idPayloadSchema.parse(payload)
    await manager.request('sessions.delete', { id })
  })

  handle(AGENT_CHANNELS.sessionSetModel, (payload): Promise<SessionMeta> => {
    const { id, model } = sessionSetModelSchema.parse(payload)
    return manager.request('sessions.setModel', { id, model })
  })

  handle(AGENT_CHANNELS.sessionSetSettings, (payload): Promise<SessionMeta> => {
    const { id, settings } = sessionSetSettingsSchema.parse(payload)
    return manager.request('sessions.setSettings', { id, settings })
  })

  handle(AGENT_CHANNELS.sessionSetAgent, (payload): Promise<SessionMeta> => {
    const { id, agent } = z
      .object({ id: idSchema, agent: z.string().min(1).max(100).nullable() })
      .parse(payload)
    return manager.request('sessions.setAgent', { id, agent })
  })

  handle(AGENT_CHANNELS.sessionCompact, (payload): Promise<SessionMeta> => {
    const { id } = idPayloadSchema.parse(payload)
    return manager.request('sessions.compact', { id, force: true })
  })

  handle(AGENT_CHANNELS.sessionUndo, (payload): Promise<SessionUndoResult> => {
    const { id, messageId } = z
      .object({ id: idSchema, messageId: idSchema.optional() })
      .parse(payload)
    return manager.request('sessions.undo', { id, messageId })
  })

  handle(AGENT_CHANNELS.sessionRedo, (payload): Promise<SessionMeta> => {
    const { id } = idPayloadSchema.parse(payload)
    return manager.request('sessions.redo', { id })
  })

  handle(AGENT_CHANNELS.sessionFork, (payload): Promise<SessionMeta> => {
    const { id, messageId } = z
      .object({ id: idSchema, messageId: idSchema.optional() })
      .parse(payload)
    return manager.request('sessions.fork', { id, messageId })
  })

  handle(AGENT_CHANNELS.sessionSearch, (payload): Promise<SessionSearchResult[]> => {
    const { query } = z.object({ query: z.string().max(200) }).parse(payload)
    return manager.request('sessions.search', { query })
  })

  handle(AGENT_CHANNELS.messagesList, (payload): Promise<MessagesSnapshot> => {
    const { sessionId } = sessionIdSchema.parse(payload)
    return manager.request('messages.list', { sessionId })
  })

  handle(AGENT_CHANNELS.chatSend, async (payload): Promise<void> => {
    const input = chatSendSchema.parse(payload)
    await refreshProviderTokens()
    const directory = attachmentDirectory(app.getPath('userData'), input.sessionId)
    for (const attachment of input.attachments ?? []) {
      if (!attachment.path.startsWith(`${directory}${path.sep}`)) {
        throw new Error('Invalid attachment path')
      }
    }
    await manager.request('chat.send', input)
  })

  handle(AGENT_CHANNELS.attachmentsImport, async (payload): Promise<MessageAttachment> => {
    const input = z
      .object({
        sessionId: idSchema,
        name: z.string().min(1).max(300),
        mimeType: z.string().max(200),
        data: z.instanceof(Uint8Array)
      })
      .parse(payload)
    const normalized = normalizeImageAttachment({
      name: input.name,
      mimeType: input.mimeType,
      data: input.data
    })
    return saveAttachment(app.getPath('userData'), input.sessionId, normalized)
  })

  handle(AGENT_CHANNELS.attachmentRemove, async (payload): Promise<void> => {
    const { sessionId, attachmentId } = z
      .object({ sessionId: idSchema, attachmentId: idSchema })
      .parse(payload)
    await removeAttachment(app.getPath('userData'), sessionId, attachmentId)
  })

  handle(AGENT_CHANNELS.attachmentPreview, async (payload): Promise<string | null> => {
    const { sessionId, path: attachmentPath } = z
      .object({ sessionId: idSchema, path: z.string().min(1).max(2_000) })
      .parse(payload)
    return attachmentDataUrl(app.getPath('userData'), sessionId, attachmentPath)
  })

  handle(AGENT_CHANNELS.filesSearch, async (payload): Promise<string[]> => {
    const { query } = z.object({ query: z.string().max(200) }).parse(payload)
    return searchWorkspaceFiles(workspacePath, query)
  })

  handle(AGENT_CHANNELS.chatStop, async (payload): Promise<void> => {
    const { sessionId } = sessionIdSchema.parse(payload)
    await manager.request('chat.stop', { sessionId })
  })

  handle(AGENT_CHANNELS.chatRetry, async (payload): Promise<void> => {
    const { sessionId } = sessionIdSchema.parse(payload)
    await refreshProviderTokens()
    await manager.request('chat.retry', { sessionId })
  })

  handle(AGENT_CHANNELS.permissionsList, (): Promise<PermissionRequest[]> =>
    manager.request('permissions.list')
  )

  handle(AGENT_CHANNELS.permissionReply, async (payload): Promise<void> => {
    const input = permissionReplySchema.parse(payload)
    await manager.request('permission.reply', input)
  })

  handle(AGENT_CHANNELS.questionsList, (): Promise<QuestionRequest[]> =>
    manager.request('questions.list')
  )

  handle(AGENT_CHANNELS.questionReply, async (payload): Promise<void> => {
    const input = questionReplySchema.parse(payload)
    await manager.request('question.reply', input)
  })

  handle(AGENT_CHANNELS.permissionsRules, (payload): Promise<PermissionRule[]> => {
    const { sessionId } = permissionRulesSchema.parse(payload) ?? {}
    return manager.request('permissions.rules', { sessionId })
  })

  handle(AGENT_CHANNELS.permissionRuleAdd, (payload): Promise<PermissionRule> => {
    const input = permissionRuleInputSchema.parse(payload)
    return manager.request('permissions.addRule', input)
  })

  handle(AGENT_CHANNELS.permissionRuleRemove, (payload): Promise<boolean> => {
    const { id } = idPayloadSchema.parse(payload)
    return manager.request('permissions.removeRule', { id })
  })

  handle(AGENT_CHANNELS.agentConfig, async (): Promise<AgentConfig> => {
    await configReady
    return configStore.get()
  })

  handle(AGENT_CHANNELS.agentConfigUpdate, async (payload): Promise<AgentConfig> => {
    const patch = agentConfigPatchSchema.parse(payload)
    await configReady
    return configStore.update(patch)
  })

  handle(
    AGENT_CHANNELS.mcpList,
    (): Promise<{ servers: McpServerConfig[]; statuses: McpServerStatus[] }> =>
      manager.request('mcp.list')
  )

  handle(AGENT_CHANNELS.mcpStatuses, (payload): Promise<McpServerStatus[]> => {
    const { probe } = z.object({ probe: z.boolean().optional() }).parse(payload ?? {})
    return manager.request('mcp.statuses', { probe })
  })

  handle(AGENT_CHANNELS.mcpAdd, (payload): Promise<McpServerConfig> => {
    const input = mcpServerInputSchema.parse(payload)
    return manager.request('mcp.add', input)
  })

  handle(AGENT_CHANNELS.mcpUpdate, async (payload): Promise<McpServerConfig> => {
    const { id, input } = mcpUpdateSchema.parse(payload)
    const { servers } = await manager.request<{ servers: McpServerConfig[] }>('mcp.list')
    const previous = servers.find((server) => server.id === id)
    const updated = await manager.request<McpServerConfig>('mcp.update', { id, input })
    const credentialsChanged =
      !previous ||
      previous.url !== updated.url ||
      previous.type !== updated.type ||
      (previous.oauthClientId ?? null) !== (updated.oauthClientId ?? null) ||
      (previous.oauthRedirectUri ?? null) !== (updated.oauthRedirectUri ?? null)
    if (credentialsChanged) {
      await mcpAuthStore.remove(updated.id)
      await manager.setMcpAuth(mcpAuthStore.list())
    }
    return updated
  })

  handle(AGENT_CHANNELS.mcpPrompt, (payload): Promise<string> => {
    const {
      server,
      prompt,
      arguments: args
    } = z
      .object({
        server: z.string().min(1).max(200),
        prompt: z.string().min(1).max(500),
        arguments: z.record(z.string(), z.string()).optional()
      })
      .parse(payload)
    return manager.request('mcp.prompt', { server, prompt, arguments: args })
  })

  handle(AGENT_CHANNELS.mcpRemove, async (payload): Promise<boolean> => {
    const { id } = idPayloadSchema.parse(payload)
    const removed = await manager.request<boolean>('mcp.remove', { id })
    if (removed) {
      await mcpAuthStore.remove(id)
      await manager.setMcpAuth(mcpAuthStore.list())
    }
    return removed
  })

  handle(AGENT_CHANNELS.webSearchGet, (): WebSearchProviderPublic => webSearchStore.get())

  handle(AGENT_CHANNELS.webSearchUpdate, async (payload): Promise<WebSearchProviderPublic> => {
    const input = webSearchUpdateSchema.parse(payload)
    const result = await webSearchStore.update(input)
    await manager.setWebSearch(webSearchStore.runtimeConfig())
    return result
  })

  handle(AGENT_CHANNELS.mcpAuthStatuses, async (): Promise<McpAuthStatus[]> => {
    const { servers } = await manager.request<{ servers: McpServerConfig[] }>('mcp.list')
    return mcpAuthStore.statuses(servers)
  })

  handle(AGENT_CHANNELS.mcpAuthorize, async (payload): Promise<McpAuthStatus[]> => {
    const { id } = idPayloadSchema.parse(payload)
    const { servers } = await manager.request<{ servers: McpServerConfig[] }>('mcp.list')
    const server = servers.find((candidate) => candidate.id === id)
    if (!server) throw new Error('MCP server not found')
    await authorizeMcpServer({
      server,
      authStore: mcpAuthStore,
      openExternal: (url) => shell.openExternal(url)
    })
    await manager.setMcpAuth(mcpAuthStore.list())
    await manager.request('mcp.statuses', { probe: true }).catch(() => undefined)
    return mcpAuthStore.statuses(servers)
  })

  handle(AGENT_CHANNELS.mcpLogout, async (payload): Promise<McpAuthStatus[]> => {
    const { id } = idPayloadSchema.parse(payload)
    await mcpAuthStore.remove(id)
    await manager.setMcpAuth(mcpAuthStore.list())
    const { servers } = await manager.request<{ servers: McpServerConfig[] }>('mcp.list')
    await manager.request('mcp.statuses', { probe: true }).catch(() => undefined)
    return mcpAuthStore.statuses(servers)
  })

  handle(AGENT_CHANNELS.workspaceOpen, async (): Promise<void> => {
    const error = await shell.openPath(workspacePath)
    if (error) throw new Error(error)
  })

  handle(AGENT_CHANNELS.openExternal, async (payload): Promise<void> => {
    const url = externalUrlSchema.parse(payload)
    await shell.openExternal(url)
  })
}
