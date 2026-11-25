import { app } from 'electron'
import {
  AGENT_CHANNELS,
  type BackgroundTaskInfo,
  type MessagesSnapshot,
  type QueuedMessage
} from '@ateam/shared'
import { attachmentDirectory, isPathInsideDirectory } from '@ateam/agent-core/attachments'
import type { AgentIpcContext } from './context'
import {
  backgroundCancelSchema,
  backgroundListSchema,
  chatQueueRemoveSchema,
  chatSendSchema,
  chatSteerSchema,
  sessionIdSchema
} from './schemas'

/** Registers message listing and chat turn controls. */
export function registerChatHandlers(ctx: AgentIpcContext): void {
  const { manager, handle, refreshProviderTokens } = ctx

  handle(AGENT_CHANNELS.messagesList, (payload): Promise<MessagesSnapshot> => {
    const { sessionId } = sessionIdSchema.parse(payload)
    return manager.request('messages.list', { sessionId })
  })

  handle(AGENT_CHANNELS.chatSend, async (payload): Promise<void> => {
    const input = chatSendSchema.parse(payload)
    await refreshProviderTokens()
    const directory = attachmentDirectory(app.getPath('userData'), input.sessionId)
    for (const attachment of input.attachments ?? []) {
      if (!(await isPathInsideDirectory(directory, attachment.path))) {
        throw new Error('Invalid attachment path')
      }
    }
    await manager.request('chat.send', input)
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

  handle(AGENT_CHANNELS.chatSteer, async (payload): Promise<QueuedMessage> => {
    const input = chatSteerSchema.parse(payload)
    await refreshProviderTokens()
    const directory = attachmentDirectory(app.getPath('userData'), input.sessionId)
    for (const attachment of input.attachments ?? []) {
      if (!(await isPathInsideDirectory(directory, attachment.path))) {
        throw new Error('Invalid attachment path')
      }
    }
    return manager.request('chat.steer', {
      sessionId: input.sessionId,
      text: input.text,
      strategy: input.strategy ?? 'after-step',
      ...(input.attachments ? { attachments: input.attachments } : {})
    })
  })

  handle(AGENT_CHANNELS.chatQueueRemove, async (payload): Promise<boolean> => {
    const input = chatQueueRemoveSchema.parse(payload)
    return manager.request('chat.queue.remove', input)
  })

  handle(AGENT_CHANNELS.backgroundTasksList, async (payload): Promise<BackgroundTaskInfo[]> => {
    const input = backgroundListSchema.parse(payload ?? {})
    return manager.request('background.list', input)
  })

  handle(AGENT_CHANNELS.backgroundTaskCancel, async (payload): Promise<boolean> => {
    const { taskId } = backgroundCancelSchema.parse(payload)
    return manager.request('background.cancel', { taskId })
  })
}
