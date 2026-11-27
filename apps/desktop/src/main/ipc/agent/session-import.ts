import { dialog } from 'electron'
import { AGENT_CHANNELS, type SessionImportResult } from '@ateam/shared'
import type { AgentIpcContext } from './context'

const EXPORT_FILTER = {
  name: 'ATeam session export',
  extensions: ['json', 'jsonl', 'md', 'markdown']
}

/**
 * Imports a session export: the file picker runs in the main process, the agent
 * worker parses, validates and remaps the file into new sessions. Parsing stays
 * off the renderer thread, so large exports do not block the UI.
 */
export function registerSessionImportHandlers(ctx: AgentIpcContext): void {
  const { manager, handle } = ctx

  handle(AGENT_CHANNELS.sessionImport, async (): Promise<SessionImportResult> => {
    const selection = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [EXPORT_FILTER]
    })
    if (selection.canceled || selection.filePaths.length === 0) {
      return { imported: false, sessions: [], sessionCount: 0, messageCount: 0 }
    }
    return manager.request<SessionImportResult>('sessions.import', {
      path: selection.filePaths[0]
    })
  })
}
