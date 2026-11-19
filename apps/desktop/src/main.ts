import { app, BrowserWindow, ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

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

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
