import fs from 'node:fs/promises'
import path from 'node:path'
import { app, dialog } from 'electron'
import {
  AGENT_CHANNELS,
  SESSION_EXPORT_EXTENSIONS,
  type SessionExportPayload,
  type SessionExportFormat,
  type SessionExportResult
} from '@ateam/shared'
import type { AgentIpcContext } from './context'
import { sessionExportSchema } from './schemas'

const FORMAT_LABELS: Record<SessionExportFormat, string> = {
  json: 'JSON',
  jsonl: 'JSON Lines',
  markdown: 'Markdown'
}

/**
 * Exports a session (or all visible sessions): the agent worker serializes and
 * redacts the records, then this handler asks for a destination and writes the
 * file. Serialization runs off the renderer thread, so the UI stays responsive.
 */
export function registerSessionExportHandlers(ctx: AgentIpcContext): void {
  const { manager, handle } = ctx

  handle(AGENT_CHANNELS.sessionExport, async (payload): Promise<SessionExportResult> => {
    const request = sessionExportSchema.parse(payload)
    const exported = await manager.request<SessionExportPayload>('sessions.export', request)

    const result = await dialog.showSaveDialog({
      defaultPath: path.join(app.getPath('downloads'), exported.suggestedName),
      filters: [
        {
          name: FORMAT_LABELS[exported.format],
          extensions: [SESSION_EXPORT_EXTENSIONS[exported.format]]
        }
      ]
    })

    const counts = {
      sessionCount: exported.sessionCount,
      messageCount: exported.messageCount
    }
    if (result.canceled || !result.filePath) return { saved: false, path: null, ...counts }

    await fs.writeFile(result.filePath, exported.content, 'utf8')
    return { saved: true, path: result.filePath, ...counts }
  })
}
