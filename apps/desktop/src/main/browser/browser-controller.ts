import { BrowserWindow } from 'electron'
import {
  clickScript,
  evalResult,
  formatSnapshot,
  snapshotScript,
  typeScript,
  validateBrowserUrl,
  type BrowserSnapshot
} from './scripts'

const LOAD_TIMEOUT_MS = 30_000
const EVAL_TIMEOUT_MS = 15_000
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024

interface PageEntry {
  window: BrowserWindow
  consoleLines: string[]
}

interface InteractionResult {
  ok: boolean
  error?: string
  title?: string
  url?: string
}

export class BrowserController {
  private readonly pages = new Map<string, PageEntry>()
  private readonly queues = new Map<string, Promise<unknown>>()

  handle(
    sessionId: string,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => this.dispatch(sessionId, method, params))
    this.queues.set(sessionId, next)
    return next.finally(() => {
      if (this.queues.get(sessionId) === next) this.queues.delete(sessionId)
    })
  }

  private async dispatch(
    sessionId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case 'open':
        return this.open(sessionId, String(params.url ?? ''))
      case 'snapshot':
        return this.snapshot(sessionId)
      case 'click':
        return this.click(sessionId, String(params.ref ?? ''))
      case 'type':
        return this.type(
          sessionId,
          String(params.ref ?? ''),
          String(params.text ?? ''),
          params.submit === true
        )
      case 'screenshot':
        return this.screenshot(sessionId)
      case 'eval':
        return this.evaluate(sessionId, String(params.code ?? ''))
      case 'close':
        return this.close(sessionId)
      default:
        throw new Error(`UNKNOWN_BROWSER_METHOD: ${method}`)
    }
  }

  async dispose(): Promise<void> {
    for (const entry of this.pages.values()) {
      if (!entry.window.isDestroyed()) entry.window.destroy()
    }
    this.pages.clear()
  }

  private create(sessionId: string): PageEntry {
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        partition: 'persist:ateam-browser'
      }
    })
    const entry: PageEntry = { window, consoleLines: [] }
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = validateBrowserUrl(url)
        void window.loadURL(target)
      } catch {
        /* ignore non-web popups */
      }
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event, url) => {
      try {
        validateBrowserUrl(url)
      } catch {
        event.preventDefault()
      }
    })
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false)
    )
    window.webContents.on('console-message', (details) => {
      entry.consoleLines.push(`[${details.level}] ${details.message}`)
      if (entry.consoleLines.length > 50) entry.consoleLines.shift()
    })
    window.on('closed', () => {
      if (this.pages.get(sessionId)?.window === window) this.pages.delete(sessionId)
    })
    this.pages.set(sessionId, entry)
    return entry
  }

  private page(sessionId: string): PageEntry {
    const existing = this.pages.get(sessionId)
    if (existing && !existing.window.isDestroyed()) return existing
    return this.create(sessionId)
  }

  private async open(sessionId: string, rawUrl: string): Promise<string> {
    const url = validateBrowserUrl(rawUrl)
    const entry = this.page(sessionId)
    const contents = entry.window.webContents
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('BROWSER_TIMEOUT'))
      }, LOAD_TIMEOUT_MS)
      const cleanup = (): void => {
        clearTimeout(timer)
        contents.off('did-finish-load', onLoad)
        contents.off('did-fail-load', onFail)
      }
      const onLoad = (): void => {
        cleanup()
        resolve()
      }
      const onFail = (
        _event: unknown,
        code: number,
        description: string,
        failedUrl: string
      ): void => {
        if (code === -3) return
        cleanup()
        reject(new Error(`BROWSER_LOAD_FAILED: ${description} (${failedUrl})`))
      }
      contents.on('did-finish-load', onLoad)
      contents.on('did-fail-load', onFail)
    })
    await entry.window.loadURL(url)
    await loaded
    return `Opened ${contents.getTitle() || '(untitled)'} (${contents.getURL()})`
  }

  private async snapshot(sessionId: string): Promise<string> {
    const entry = this.page(sessionId)
    const snapshot = (await entry.window.webContents.executeJavaScript(
      snapshotScript(),
      true
    )) as BrowserSnapshot
    return formatSnapshot(snapshot, entry.consoleLines)
  }

  private formatInteraction(action: string, ref: string, result: InteractionResult): string {
    if (!result.ok) return `Could not ${action} [${ref}]: ${result.error ?? 'unknown error'}`
    return `${action} [${ref}] -> ${result.title || '(untitled)'} (${result.url})`
  }

  private async click(sessionId: string, ref: string): Promise<string> {
    const entry = this.page(sessionId)
    const result = (await entry.window.webContents.executeJavaScript(
      clickScript(ref),
      true
    )) as InteractionResult
    return this.formatInteraction('Clicked', ref, result)
  }

  private async type(
    sessionId: string,
    ref: string,
    text: string,
    submit: boolean
  ): Promise<string> {
    const entry = this.page(sessionId)
    const result = (await entry.window.webContents.executeJavaScript(
      typeScript(ref, text, submit),
      true
    )) as InteractionResult
    return this.formatInteraction(submit ? 'Typed and submitted' : 'Typed into', ref, result)
  }

  private async screenshot(
    sessionId: string
  ): Promise<{ summary: string; image: { mimeType: string; data: string } } | string> {
    const entry = this.page(sessionId)
    const contents = entry.window.webContents
    const image = await contents.capturePage()
    const png = image.toPNG()
    if (png.byteLength > MAX_SCREENSHOT_BYTES) return 'Error: screenshot exceeds 5 MB'
    return {
      summary: `Screenshot: ${contents.getTitle() || '(untitled)'} (${contents.getURL()})`,
      image: { mimeType: 'image/png', data: png.toString('base64') }
    }
  }

  private async evaluate(sessionId: string, code: string): Promise<string> {
    if (!code.trim()) return 'Error: code is required'
    const entry = this.page(sessionId)
    let timer: NodeJS.Timeout | undefined
    try {
      const value = await Promise.race([
        entry.window.webContents.executeJavaScript(code, true),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('BROWSER_EVAL_TIMEOUT')), EVAL_TIMEOUT_MS)
        })
      ])
      return evalResult(value)
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private close(sessionId: string): string {
    const entry = this.pages.get(sessionId)
    if (!entry) return 'Browser is not open.'
    this.pages.delete(sessionId)
    if (!entry.window.isDestroyed()) entry.window.destroy()
    return 'Browser closed.'
  }
}
