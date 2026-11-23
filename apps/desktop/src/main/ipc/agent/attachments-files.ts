import { app } from 'electron'
import { AGENT_CHANNELS, type MessageAttachment } from '@ateam/shared'
import { attachmentDataUrl, removeAttachment, saveAttachment } from '@ateam/agent-core/attachments'
import { normalizeImageAttachment } from '../../attachments/image'
import { searchFilesWithReferences } from '../../files/search'
import type { AgentIpcContext } from './context'
import {
  attachmentImportSchema,
  attachmentPreviewSchema,
  attachmentRemoveSchema,
  filesSearchSchema
} from './schemas'

/** Registers attachment storage/preview and workspace file search channels. */
export function registerAttachmentHandlers(ctx: AgentIpcContext): void {
  const { workspacePath, handle, requestedDirectory, searchReferences } = ctx

  handle(AGENT_CHANNELS.attachmentsImport, async (payload): Promise<MessageAttachment> => {
    const input = attachmentImportSchema.parse(payload)
    const normalized = normalizeImageAttachment({
      name: input.name,
      mimeType: input.mimeType,
      data: input.data
    })
    return saveAttachment(app.getPath('userData'), input.sessionId, normalized)
  })

  handle(AGENT_CHANNELS.attachmentRemove, async (payload): Promise<void> => {
    const { sessionId, attachmentId } = attachmentRemoveSchema.parse(payload)
    await removeAttachment(app.getPath('userData'), sessionId, attachmentId)
  })

  handle(AGENT_CHANNELS.attachmentPreview, async (payload): Promise<string | null> => {
    const { sessionId, path: attachmentPath } = attachmentPreviewSchema.parse(payload)
    return attachmentDataUrl(app.getPath('userData'), sessionId, attachmentPath)
  })

  handle(AGENT_CHANNELS.filesSearch, async (payload): Promise<string[]> => {
    const { query, directory } = filesSearchSchema.parse(payload)
    const searchRoot = requestedDirectory(directory) ?? workspacePath
    const references = await searchReferences(searchRoot)
    return searchFilesWithReferences(searchRoot, query, references)
  })
}
