import { app, shell, BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  AGENT_EVENT_CHANNEL,
  APP_ID,
  APP_NAME,
  CONFIG_CHANGE_CHANNEL,
  THEME_CHANNEL,
  UPDATE_EVENT_CHANNEL,
  type AgentEventEnvelope
} from '@ateam/shared'
import { AgentConfigStore } from '@ateam/agent-core/config'
import { AgentManager } from './agent-host/agent-manager'
import { BrowserController } from './browser/browser-controller'
import { ConfigWatcher } from './config-watcher'
import { ModelConfigStore } from './settings/model-config-store'
import { ModelCatalogStore } from './providers/catalog-store'
import { WebSearchConfigStore } from './settings/websearch-config-store'
import { McpAuthStore } from './credentials/mcp-auth-store'
import { ProviderAuthStore } from './providers/provider-auth-store'
import { runtimeModelsWithOAuth } from './providers/runtime-config'
import { registerAgentIpc } from './ipc/agent/register'
import { registerModelsIpc } from './ipc/models'
import { registerUpdatesIpc } from './ipc/updates'
import { createTrustedSender } from './ipc/trusted-sender'
import { ReleaseUpdater } from './updates/release-updater'
import icon from '../../resources/icon.png?asset'

const TITLE_BAR_HEIGHT = 44
const TITLE_BAR_COLORS = {
  light: { color: '#faf9f6', symbolColor: '#211d19' },
  dark: { color: '#141414', symbolColor: '#f2f2f2' }
} as const

let mainWindow: BrowserWindow | null = null
let agentManager: AgentManager | null = null
let browserController: BrowserController | null = null
let configWatcher: ConfigWatcher | null = null
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
    void browserController?.dispose()
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

    const providerAuthStore = new ProviderAuthStore(userDataPath)
    const modelsStore = new ModelConfigStore(userDataPath, providerAuthStore)
    try {
      await modelsStore.init()
    } catch (error) {
      console.error('[models] failed to load the model configuration', error)
    }
    const webSearchStore = new WebSearchConfigStore(userDataPath)
    try {
      await webSearchStore.init()
    } catch (error) {
      console.error('[websearch] failed to load the web search configuration', error)
    }
    const mcpAuthStore = new McpAuthStore(userDataPath)
    try {
      await mcpAuthStore.init()
    } catch (error) {
      console.error('[mcp-auth] failed to load OAuth credentials', error)
    }
    const catalogStore = new ModelCatalogStore({ userDataPath })
    try {
      await mkdir(workspacePath, { recursive: true })
    } catch (error) {
      console.error('[workspace] failed to create the agent workspace', error)
    }

    const configStore = new AgentConfigStore(userDataPath)
    const configReady = configStore.init().catch((error: unknown) => {
      console.error('[config] failed to load the agent configuration', error)
    })
    const watcher = new ConfigWatcher({
      userDataPath,
      onChange: (change) => {
        const window = mainWindow
        if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(CONFIG_CHANGE_CHANNEL, change)
        }
        if (change.global) {
          void configStore.reload()
          void agentManager?.request('config.reload').catch(() => undefined)
          return
        }
        for (const workspace of change.workspaces) {
          void agentManager?.request('config.reload', { workspace }).catch(() => undefined)
        }
      }
    })
    configWatcher = watcher

    browserController = new BrowserController()
    const manager = new AgentManager({
      workerPath: join(__dirname, 'agent.js'),
      userDataPath,
      workspacePath,
      appVersion: app.getVersion(),
      mcpAuth: () => mcpAuthStore.list(),
      providerAuth: () => providerAuthStore.runtimeAuth(),
      onMcpAuth: (auth) => {
        void mcpAuthStore.set(auth).catch((error) => {
          console.error('[mcp-auth] failed to store refreshed credentials', error)
        })
      },
      browserRequest: (sessionId, method, params, deadline) =>
        browserController?.handle(sessionId, method, params, deadline) ??
        Promise.reject(new Error('BROWSER_NOT_AVAILABLE')),
      onEvent: (envelope: AgentEventEnvelope) => {
        const window = mainWindow
        if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(AGENT_EVENT_CHANNEL, envelope)
        }
        if (envelope.event.type === 'session.upsert' && envelope.event.session.directory) {
          void watcher.trackWorkspace(envelope.event.session.directory)
        }
      }
    })
    agentManager = manager
    void watcher.trackWorkspace(workspacePath)

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
    registerAgentIpc({
      manager,
      modelsStore,
      webSearchStore,
      mcpAuthStore,
      providerAuthStore,
      workspacePath,
      isTrustedSender,
      configStore,
      configReady,
      configWatcher: watcher
    })
    registerModelsIpc({
      manager,
      modelsStore,
      providerAuthStore,
      catalogStore,
      isTrustedSender
    })
    registerUpdatesIpc({
      updater: new ReleaseUpdater({
        currentVersion: app.getVersion(),
        downloadsPath: app.getPath('downloads'),
        repo: process.env.ATEAM_GITHUB_REPO,
        token: process.env.ATEAM_GITHUB_TOKEN,
        apiBaseUrl: process.env.ATEAM_GITHUB_API_URL,
        onProgress: (progress) => {
          const window = mainWindow
          if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send(UPDATE_EVENT_CHANNEL, progress)
          }
        },
        openInstaller: async (filePath) => (await shell.openPath(filePath)) === ''
      }),
      isTrustedSender
    })

    // Default development shortcuts (F12 for DevTools, etc.).
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    void manager
      .start(
        runtimeModelsWithOAuth(modelsStore.runtimeConfig(), providerAuthStore),
        webSearchStore.runtimeConfig()
      )
      .catch((error: unknown) => {
        console.error('[agent] failed to start', error)
      })

    app.on('activate', function () {
      if (!mainWindow) createWindow()
    })
  })
}

app.on('before-quit', (event) => {
  if (quitting || !agentManager) return
  quitting = true
  event.preventDefault()
  const manager = agentManager
  const browser = browserController
  agentManager = null
  browserController = null
  configWatcher?.dispose()
  configWatcher = null
  void Promise.all([manager.stop(), browser?.dispose().catch(() => undefined)]).finally(() => {
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
