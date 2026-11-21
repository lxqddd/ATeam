import { app, shell, BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  AGENT_EVENT_CHANNEL,
  APP_ID,
  APP_NAME,
  THEME_CHANNEL,
  type AgentEventEnvelope
} from '@ateam/shared'
import { AgentManager } from './agent/agent-manager'
import { ModelsStore } from './stores/models'
import { WebSearchStore } from './stores/websearch'
import { registerAgentIpc } from './ipc/agent'
import { registerModelsIpc } from './ipc/models'
import { createTrustedSender } from './ipc/trusted-sender'
import icon from '../../resources/icon.png?asset'

const TITLE_BAR_HEIGHT = 44
const TITLE_BAR_COLORS = {
  light: { color: '#faf9f6', symbolColor: '#211d19' },
  dark: { color: '#141414', symbolColor: '#f2f2f2' }
} as const

let mainWindow: BrowserWindow | null = null
let agentManager: AgentManager | null = null
let quitting = false

function getWindowChrome(): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 14 }
    }
  }

  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      ...TITLE_BAR_COLORS.light,
      height: TITLE_BAR_HEIGHT
    }
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...getWindowChrome(),
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: false
    }
  })

  mainWindow = window

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler((details) => {
    if (/^https?:/i.test(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  const devUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL'] ? process.env['ELECTRON_RENDERER_URL'] : null
  const rendererFile = pathToFileURL(join(__dirname, '../renderer/index.html')).href
  window.webContents.on('will-navigate', (event, url) => {
    let allowed = false
    if (devUrl) {
      try {
        allowed = new URL(url).origin === new URL(devUrl).origin
      } catch {
        allowed = false
      }
    } else {
      allowed = url.startsWith(rendererFile)
    }
    if (allowed) return
    event.preventDefault()
    if (/^https?:/i.test(url)) {
      void shell.openExternal(url)
    }
  })

  // HMR for the renderer is provided by electron-vite during development.
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.setName(APP_NAME)

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId(APP_ID)

    const userDataPath = app.getPath('userData')
    const workspacePath = join(userDataPath, 'agent-workspace')

    const modelsStore = new ModelsStore(userDataPath)
    try {
      await modelsStore.init()
    } catch (error) {
      console.error('[models] failed to load the model configuration', error)
    }
    const webSearchStore = new WebSearchStore(userDataPath)
    try {
      await webSearchStore.init()
    } catch (error) {
      console.error('[websearch] failed to load the web search configuration', error)
    }
    try {
      await mkdir(workspacePath, { recursive: true })
    } catch (error) {
      console.error('[workspace] failed to create the agent workspace', error)
    }

    const manager = new AgentManager({
      workerPath: join(__dirname, 'agent.js'),
      userDataPath,
      workspacePath,
      appVersion: app.getVersion(),
      onEvent: (envelope: AgentEventEnvelope) => {
        const window = mainWindow
        if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(AGENT_EVENT_CHANNEL, envelope)
        }
      }
    })
    agentManager = manager

    ipcMain.on(THEME_CHANNEL, (event, theme: unknown) => {
      if (process.platform === 'darwin') return
      if (theme !== 'light' && theme !== 'dark') return

      const target = BrowserWindow.fromWebContents(event.sender)
      if (!target) return

      try {
        target.setTitleBarOverlay({
          ...TITLE_BAR_COLORS[theme],
          height: TITLE_BAR_HEIGHT
        })
      } catch {
        // Not every Linux window manager supports the window controls overlay.
      }
    })

    const isTrustedSender = createTrustedSender(() => mainWindow)
    registerAgentIpc({ manager, modelsStore, webSearchStore, workspacePath, isTrustedSender })
    registerModelsIpc({ manager, modelsStore, isTrustedSender })

    // Default development shortcuts (F12 for DevTools, etc.).
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    void manager
      .start(modelsStore.runtimeConfig(), webSearchStore.runtimeConfig())
      .catch((error: unknown) => {
        console.error('[agent] failed to start', error)
      })

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', (event) => {
  if (quitting || !agentManager) return
  quitting = true
  event.preventDefault()
  const manager = agentManager
  agentManager = null
  void manager.stop().finally(() => {
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
