import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { UPDATE_CHANNELS, type UpdateDownloadResult, type UpdateInfo } from '@ateam/shared'
import type { ReleaseUpdater } from '../updates/release-updater'
import type { TrustedSender } from './trusted-sender'

export interface UpdatesIpcOptions {
  updater: ReleaseUpdater
  isTrustedSender: TrustedSender
}

export function registerUpdatesIpc(options: UpdatesIpcOptions): void {
  const handle = (channel: string, handler: (payload: unknown) => unknown): void => {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, payload: unknown) => {
      if (!options.isTrustedSender(event)) throw new Error('UNTRUSTED_SENDER')
      return handler(payload)
    })
  }

  handle(UPDATE_CHANNELS.check, (): Promise<UpdateInfo> => options.updater.check())

  handle(UPDATE_CHANNELS.download, (payload): Promise<UpdateDownloadResult> => {
    const { version } = z.object({ version: z.string().min(1).max(100) }).parse(payload)
    return options.updater.download(version)
  })
}
