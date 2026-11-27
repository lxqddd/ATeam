import { app } from 'electron'
import {
  AGENT_CHANNELS,
  type PermissionRequest,
  type PermissionRule,
  type PermissionRulesOverview,
  type QuestionRequest
} from '@ateam/shared'
import { permissionsFilePath } from '@ateam/agent-core/config'
import type { AgentIpcContext } from './context'
import {
  directoryPayloadSchema,
  idPayloadSchema,
  permissionReplySchema,
  permissionRuleInputSchema,
  permissionRulesSchema,
  questionReplySchema
} from './schemas'

/** Registers permission and question prompts plus permission rule management. */
export function registerPermissionHandlers(ctx: AgentIpcContext): void {
  const { manager, handle } = ctx

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

  handle(AGENT_CHANNELS.permissionsOverview, (payload): Promise<PermissionRulesOverview> => {
    const { directory } = directoryPayloadSchema.parse(payload) ?? {}
    return manager.request('permissions.overview', {
      ...(directory ? { workspace: directory } : {})
    })
  })

  handle(AGENT_CHANNELS.permissionRuleAdd, async (payload): Promise<PermissionRule> => {
    const input = permissionRuleInputSchema.parse(payload)
    const rule = await manager.request<PermissionRule>('permissions.addRule', input)
    ctx.configWatcher?.noteSelfWrite(permissionsFilePath(app.getPath('userData')))
    return rule
  })

  handle(AGENT_CHANNELS.permissionRuleRemove, async (payload): Promise<boolean> => {
    const { id } = idPayloadSchema.parse(payload)
    const removed = await manager.request<boolean>('permissions.removeRule', { id })
    if (removed) {
      ctx.configWatcher?.noteSelfWrite(permissionsFilePath(app.getPath('userData')))
    }
    return removed
  })
}
