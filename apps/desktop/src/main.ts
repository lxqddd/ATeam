import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { KernelManager, kernelWorkspace } from './kernel'
import { providerConfig, saveProvider } from './settings'
import { chooseProject, listProjects, removeProject, renameProject, selectProject } from './projects'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
let kernel: KernelManager | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#faf9f6',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  const capturePath = process.env.ATEAM_CAPTURE_PATH
  if (capturePath) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void window.webContents.capturePage().then((image) => {
          fs.writeFileSync(capturePath, image.toPNG())
          app.quit()
        })
      }, 800)
    })
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string)
  } else {
    void window.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  }

  return window
}

app.setName('ATeam')

void app.whenReady().then(() => {
  ipcMain.handle('ateam:version', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
  }))

  kernel = new KernelManager(kernelWorkspace())
  kernel.onEvent((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('kernel:event', event)
    }
  })
  ipcMain.handle('kernel:status', () => kernel?.status() ?? { status: 'stopped' })
  ipcMain.handle('kernel:sessions', () => kernel?.listSessions() ?? [])
  ipcMain.handle('kernel:create-session', (_event, title: unknown) =>
    kernel?.createSession(typeof title === 'string' ? title : 'ATeam session'),
  )
  ipcMain.handle('kernel:prompt', (_event, input: unknown) => {
    const payload = input as { sessionId?: unknown; text?: unknown } | null
    if (!payload || typeof payload.sessionId !== 'string' || typeof payload.text !== 'string') {
      throw new Error('invalid prompt payload')
    }
    return kernel?.prompt(payload.sessionId, payload.text)
  })
  ipcMain.handle('kernel:messages', (_event, sessionId: unknown) =>
    typeof sessionId === 'string' ? kernel?.messages(sessionId) : [],
  )
  ipcMain.handle('kernel:interrupt', (_event, sessionId: unknown) =>
    typeof sessionId === 'string' ? kernel?.interrupt(sessionId) : undefined,
  )
  ipcMain.handle('kernel:restart', () => kernel?.restart())
  ipcMain.handle('kernel:models', () => kernel?.listModels() ?? [])
  ipcMain.handle('kernel:permissions', (_event, sessionId: unknown) =>
    typeof sessionId === 'string' ? (kernel?.listPermissions(sessionId) ?? []) : [],
  )
  ipcMain.handle('kernel:reply-permission', (_event, input: unknown) => {
    const payload = input as
      | { sessionId?: unknown; requestId?: unknown; decision?: unknown; message?: unknown }
      | null
    const decision = payload?.decision
    if (
      !payload ||
      typeof payload.sessionId !== 'string' ||
      typeof payload.requestId !== 'string' ||
      (decision !== 'once' && decision !== 'always' && decision !== 'reject')
    ) {
      throw new Error('invalid permission payload')
    }
    return kernel?.replyPermission(
      payload.sessionId,
      payload.requestId,
      decision,
      typeof payload.message === 'string' ? payload.message : undefined,
    )
  })
  ipcMain.handle('kernel:switch-model', (_event, input: unknown) => {
    const payload = input as
      | { sessionId?: unknown; model?: { id?: unknown; providerID?: unknown } }
      | null
    if (
      !payload ||
      typeof payload.sessionId !== 'string' ||
      !payload.model ||
      typeof payload.model.id !== 'string' ||
      typeof payload.model.providerID !== 'string'
    ) {
      throw new Error('invalid model payload')
    }
    return kernel?.switchModel(payload.sessionId, { id: payload.model.id, providerID: payload.model.providerID })
  })
  ipcMain.handle('provider:get', () => providerConfig())
  ipcMain.handle('provider:set', async (_event, input: unknown) => {
    const payload = input as { kind?: unknown; model?: unknown; apiKey?: unknown } | null
    if (!payload || payload.kind !== 'opencode-go' || typeof payload.model !== 'string' || !payload.model.trim()) {
      throw new Error('invalid provider payload')
    }
    const saved = saveProvider({
      kind: 'opencode-go',
      model: payload.model.trim(),
      apiKey: typeof payload.apiKey === 'string' ? payload.apiKey : undefined,
    })
    await kernel?.restart()
    return saved
  })
  ipcMain.handle('provider:test', () => kernel?.testProvider() ?? { ok: false, message: '内核未启动' })
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:choose', () => chooseProject(BrowserWindow.getFocusedWindow()))
  ipcMain.handle('projects:select', (_event, id: unknown) =>
    typeof id === 'string' ? selectProject(id) : listProjects(),
  )
  ipcMain.handle('projects:remove', (_event, id: unknown) =>
    typeof id === 'string' ? removeProject(id) : listProjects(),
  )
  ipcMain.handle('projects:rename', (_event, input: unknown) => {
    const payload = input as { id?: unknown; name?: unknown } | null
    if (!payload || typeof payload.id !== 'string' || typeof payload.name !== 'string') {
      throw new Error('invalid project payload')
    }
    return renameProject(payload.id, payload.name)
  })
  void kernel.start()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  void kernel?.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
