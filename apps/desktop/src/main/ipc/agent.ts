import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  AGENT_CHANNELS,
  type AgentInfo,
  type AgentStatus,
  type MessagesSnapshot,
  type PermissionRequest,
  type SessionMeta
} from '@ateam/shared'
import type { AgentManager } from '../agent/agent-manager'
import type { ModelsStore } from '../models/store'
import type { TrustedSender } from './trusted-sender'

const idSchema = z.string().min(1).max(200)
const modelRefSchema = z.object({
  providerId: idSchema,
  modelId: z.string().min(1).max(200)
})
const renameSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(200)
})
const idPayloadSchema = z.object({ id: idSchema })
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
const chatSendSchema = z.object({
  sessionId: idSchema,
  text: z.string().min(1).max(100_000),
  model: modelRefSchema.nullable().optional()
})
const permissionReplySchema = z.object({
  requestId: idSchema,
  decision: z.enum(['once', 'always', 'reject'])
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
  workspacePath: string
  isTrustedSender: TrustedSender
}

export function registerAgentIpc(options: AgentIpcOptions): void {
  const { manager, modelsStore, workspacePath, isTrustedSender } = options

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

  handle(AGENT_CHANNELS.info, (): AgentInfo => ({
    workspacePath,
    appVersion: app.getVersion(),
    encryptionAvailable: modelsStore.isEncryptionAvailable()
  }))

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

  handle(AGENT_CHANNELS.messagesList, (payload): Promise<MessagesSnapshot> => {
    const { sessionId } = sessionIdSchema.parse(payload)
    return manager.request('messages.list', { sessionId })
  })

  handle(AGENT_CHANNELS.chatSend, async (payload): Promise<void> => {
    const input = chatSendSchema.parse(payload)
    await manager.request('chat.send', input)
  })

  handle(AGENT_CHANNELS.chatStop, async (payload): Promise<void> => {
    const { sessionId } = sessionIdSchema.parse(payload)
    await manager.request('chat.stop', { sessionId })
  })

  handle(AGENT_CHANNELS.chatRetry, async (payload): Promise<void> => {
    const { sessionId } = sessionIdSchema.parse(payload)
    await manager.request('chat.retry', { sessionId })
  })

  handle(AGENT_CHANNELS.permissionsList, (): Promise<PermissionRequest[]> =>
    manager.request('permissions.list')
  )

  handle(AGENT_CHANNELS.permissionReply, async (payload): Promise<void> => {
    const input = permissionReplySchema.parse(payload)
    await manager.request('permission.reply', input)
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
