import { dialog, shell } from 'electron'
import { AGENT_CHANNELS } from '@ateam/shared'
import type { AgentIpcContext } from './context'
import { externalUrlSchema, workspaceOpenSchema, workspacePickSchema } from './schemas'

/** Registers workspace selection/opening and external link channels. */
export function registerWorkspaceHandlers(ctx: AgentIpcContext): void {
  const { workspacePath, handle, requestedDirectory } = ctx

  handle(AGENT_CHANNELS.workspacePick, async (payload): Promise<string | null> => {
    const { defaultPath } = workspacePickSchema.parse(payload ?? {})
    const result = await dialog.showOpenDialog({
      defaultPath: defaultPath || workspacePath,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(AGENT_CHANNELS.workspaceOpen, async (payload): Promise<void> => {
    const { path: requestedPath } = workspaceOpenSchema.parse(payload ?? {})
    const error = await shell.openPath(requestedDirectory(requestedPath) ?? workspacePath)
    if (error) throw new Error(error)
  })

  handle(AGENT_CHANNELS.openExternal, async (payload): Promise<void> => {
    const url = externalUrlSchema.parse(payload)
    await shell.openExternal(url)
  })
}
