import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export type TrustedSender = (event: IpcMainInvokeEvent) => boolean

export function createTrustedSender(getWindow: () => BrowserWindow | null): TrustedSender {
  return (event) => {
    const window = getWindow()
    return Boolean(window && !window.isDestroyed() && event.sender === window.webContents)
  }
}
