import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ateam', {
  platform: process.platform,
  version: process.versions.electron,
  kernel: {
    status: () => ipcRenderer.invoke('kernel:status'),
    sessions: () => ipcRenderer.invoke('kernel:sessions'),
    createSession: (title: string) => ipcRenderer.invoke('kernel:create-session', title),
    prompt: (sessionId: string, text: string) =>
      ipcRenderer.invoke('kernel:prompt', { sessionId, text }),
    messages: (sessionId: string) => ipcRenderer.invoke('kernel:messages', sessionId),
    interrupt: (sessionId: string) => ipcRenderer.invoke('kernel:interrupt', sessionId),
    restart: () => ipcRenderer.invoke('kernel:restart'),
    models: () => ipcRenderer.invoke('kernel:models'),
    switchModel: (sessionId: string, model: { id: string; providerID: string }) =>
      ipcRenderer.invoke('kernel:switch-model', { sessionId, model }),
    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('kernel:event', listener)
      return () => ipcRenderer.removeListener('kernel:event', listener)
    },
  },
  provider: {
    get: () => ipcRenderer.invoke('provider:get'),
    set: (input: { kind: 'opencode-go'; model: string; apiKey?: string }) =>
      ipcRenderer.invoke('provider:set', input),
    test: () => ipcRenderer.invoke('provider:test'),
  },
})
