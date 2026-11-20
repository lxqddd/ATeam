import { app, shell, BrowserWindow, ipcMain, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME, THEME_CHANNEL } from '@ateam/shared'
import icon from '../../resources/icon.png?asset'

const TITLE_BAR_HEIGHT = 44
const TITLE_BAR_COLORS = {
  light: { color: '#faf9f6', symbolColor: '#211d19' },
  dark: { color: '#141414', symbolColor: '#f2f2f2' }
} as const

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

function createWindow(): void {
  const mainWindow = new BrowserWindow({
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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for the renderer is provided by electron-vite during development.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.setName(APP_NAME)

app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_ID)

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

  // Default development shortcuts (F12 for DevTools, etc.).
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
