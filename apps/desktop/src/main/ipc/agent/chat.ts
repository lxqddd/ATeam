import { app } from 'electron'
import { AGENT_CHANNELS, type MessagesSnapshot } from '@ateam/shared'
import { attachmentDirectory, isPathInsideDirectory } from '@ateam/agent-core/attachments'
import type { AgentIpcContext } from './context'
import { chatSendSchema, sessionIdSchema } from './schemas'

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
}
