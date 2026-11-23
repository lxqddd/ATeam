import {
  AGENT_CHANNELS,
  type SessionMeta,
  type SessionSearchResult,
  type SessionUndoResult,
  type TurnChanges
} from '@ateam/shared'
import type { AgentIpcContext } from './context'
import {
  directoryPayloadSchema,
  idPayloadSchema,
  renameSchema,
  sessionChangesSchema,
  sessionMessageSchema,
  sessionRevertFilesSchema,
  sessionSearchSchema,
  sessionSetAgentSchema,
  sessionSetDirectorySchema,
  sessionSetModelSchema,
  sessionSetSettingsSchema
} from './schemas'

/** Registers every session lifecycle and inspection channel. */
export function registerSessionHandlers(ctx: AgentIpcContext): void {
  const { manager, handle } = ctx

  handle(AGENT_CHANNELS.sessionsList, (): Promise<SessionMeta[]> =>
    manager.request('sessions.list')
  )

  handle(AGENT_CHANNELS.sessionCreate, (payload): Promise<SessionMeta> => {
    const { directory } = directoryPayloadSchema.parse(payload ?? {})
    return manager.request('sessions.create', { directory })
  })

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

  handle(AGENT_CHANNELS.sessionSetDirectory, (payload): Promise<SessionMeta> => {
    const { id, directory } = sessionSetDirectorySchema.parse(payload)
    return manager.request('sessions.setDirectory', { id, directory })
  })

  handle(AGENT_CHANNELS.sessionSetAgent, (payload): Promise<SessionMeta> => {
    const { id, agent } = sessionSetAgentSchema.parse(payload)
    return manager.request('sessions.setAgent', { id, agent })
  })

  handle(AGENT_CHANNELS.sessionCompact, (payload): Promise<SessionMeta> => {
    const { id } = idPayloadSchema.parse(payload)
    return manager.request('sessions.compact', { id, force: true })
  })

  handle(AGENT_CHANNELS.sessionUndo, (payload): Promise<SessionUndoResult> => {
    const { id, messageId } = sessionMessageSchema.parse(payload)
    return manager.request('sessions.undo', { id, messageId })
  })

  handle(AGENT_CHANNELS.sessionRedo, (payload): Promise<SessionMeta> => {
    const { id } = idPayloadSchema.parse(payload)
    return manager.request('sessions.redo', { id })
  })

  handle(AGENT_CHANNELS.sessionFork, (payload): Promise<SessionMeta> => {
    const { id, messageId } = sessionMessageSchema.parse(payload)
    return manager.request('sessions.fork', { id, messageId })
  })

  handle(AGENT_CHANNELS.sessionSearch, (payload): Promise<SessionSearchResult[]> => {
    const { query } = sessionSearchSchema.parse(payload)
    return manager.request('sessions.search', { query })
  })

  handle(AGENT_CHANNELS.sessionChanges, (payload): Promise<TurnChanges> => {
    const { sessionId, messageId } = sessionChangesSchema.parse(payload)
    return manager.request('sessions.changes', { sessionId, messageId })
  })

  handle(AGENT_CHANNELS.sessionRevertFiles, (payload): Promise<TurnChanges> => {
    const { sessionId, messageId, paths } = sessionRevertFilesSchema.parse(payload)
    return manager.request('sessions.revertFiles', { sessionId, messageId, paths })
  })
}
