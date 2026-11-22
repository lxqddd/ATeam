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
const SCRIPT_TIMEOUT_MS = 20_000
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
  private readonly securedPartitions = new Set<string>()
  private generation = 0

  handle(
    sessionId: string,
    method: string,
    params: Record<string, unknown> = {},
    deadline?: number
  ): Promise<unknown> {
    const generation = this.generation
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => {
        if (generation !== this.generation) throw new Error('BROWSER_CLOSED')
        if (deadline !== undefined && Date.now() > deadline) {
          throw new Error('BROWSER_ABANDONED')
        }
        return this.dispatch(sessionId, method, params)
      })
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
    this.generation += 1
    for (const entry of this.pages.values()) {
      if (!entry.window.isDestroyed()) entry.window.destroy()
    }
    this.pages.clear()
    this.securedPartitions.clear()
  }

  private create(sessionId: string): PageEntry {
    const partition = `ateam-browser-${sessionId.replace(/[^A-Za-z0-9_-]/g, '')}`
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        partition
      }
    })
    const entry: PageEntry = { window, consoleLines: [] }
    const contents = window.webContents
    const browserSession = contents.session
    if (!this.securedPartitions.has(partition)) {
      this.securedPartitions.add(partition)
      browserSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false)
      )
      browserSession.on('will-download', (event) => {
        event.preventDefault()
      })
    }
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const target = validateBrowserUrl(url)
        void this.handle(sessionId, 'open', { url: target }).catch(() => undefined)
      } catch {
        /* ignore non-web popups */
      }
      return { action: 'deny' }
    })
    const guardNavigation = (event: { preventDefault: () => void }, url: string): void => {
      try {
        validateBrowserUrl(url)
      } catch {
        event.preventDefault()
      }
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
    contents.on('console-message', (details) => {
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

  private destroyPage(sessionId: string, entry: PageEntry): void {
    if (this.pages.get(sessionId) === entry) this.pages.delete(sessionId)
    if (!entry.window.isDestroyed()) entry.window.destroy()
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('BROWSER_TIMEOUT')), timeoutMs)
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        }
      )
    })
  }

  private script(
    entry: PageEntry,
    source: string,
    timeoutMs = SCRIPT_TIMEOUT_MS
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let active = true
      const timer = setTimeout(() => {
        active = false
        reject(new Error('BROWSER_TIMEOUT'))
      }, timeoutMs)
      entry.window.webContents.executeJavaScript(source, true).then(
        (value) => {
          if (!active) return
          active = false
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          if (!active) return
          active = false
          clearTimeout(timer)
          reject(error)
        }
      )
    })
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
        failedUrl: string,
        isMainFrame?: boolean
      ): void => {
        if (code === -3 || isMainFrame === false) return
        cleanup()
        reject(new Error(`BROWSER_LOAD_FAILED: ${description} (${failedUrl})`))
      }
      contents.on('did-finish-load', onLoad)
      contents.on('did-fail-load', onFail)
    })
    try {
      await entry.window.loadURL(url)
      await loaded
    } catch (error) {
      await loaded.catch(() => undefined)
      if (error instanceof Error && error.message === 'BROWSER_TIMEOUT') {
        this.destroyPage(sessionId, entry)
      }
      throw error
    }
    return `Opened ${contents.getTitle() || '(untitled)'} (${contents.getURL()})`
  }

  private async snapshot(sessionId: string): Promise<string> {
    const entry = this.page(sessionId)
    try {
      const snapshot = (await this.script(entry, snapshotScript())) as BrowserSnapshot
      return formatSnapshot(snapshot, entry.consoleLines)
    } catch (error) {
      if (error instanceof Error && error.message === 'BROWSER_TIMEOUT') {
        this.destroyPage(sessionId, entry)
        return 'Error: the page is not responding; the browser was reset.'
      }
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private formatInteraction(action: string, ref: string, result: InteractionResult): string {
    if (!result.ok) return `Could not ${action} [${ref}]: ${result.error ?? 'unknown error'}`
    return `${action} [${ref}] -> ${result.title || '(untitled)'} (${result.url})`
  }

  private async interaction(
    sessionId: string,
    action: string,
    ref: string,
    source: string
  ): Promise<string> {
    const entry = this.page(sessionId)
    try {
      const result = (await this.script(entry, source)) as InteractionResult
      return this.formatInteraction(action, ref, result)
    } catch (error) {
      if (error instanceof Error && error.message === 'BROWSER_TIMEOUT') {
        this.destroyPage(sessionId, entry)
        return 'Error: the page is not responding; the browser was reset.'
      }
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private click(sessionId: string, ref: string): Promise<string> {
    return this.interaction(sessionId, 'Clicked', ref, clickScript(ref))
  }

  private type(sessionId: string, ref: string, text: string, submit: boolean): Promise<string> {
    return this.interaction(
      sessionId,
      submit ? 'Typed and submitted' : 'Typed into',
      ref,
      typeScript(ref, text, submit)
    )
  }

  private async screenshot(
    sessionId: string
  ): Promise<{ summary: string; image: { mimeType: string; data: string } } | string> {
    const entry = this.page(sessionId)
    const contents = entry.window.webContents
    try {
      const image = await this.withTimeout(contents.capturePage(), SCRIPT_TIMEOUT_MS)
      const png = image.toPNG()
      if (png.byteLength > MAX_SCREENSHOT_BYTES) return 'Error: screenshot exceeds 5 MB'
      return {
        summary: `Screenshot: ${contents.getTitle() || '(untitled)'} (${contents.getURL()})`,
        image: { mimeType: 'image/png', data: png.toString('base64') }
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'BROWSER_TIMEOUT') {
        this.destroyPage(sessionId, entry)
        return 'Error: the page is not responding; the browser was reset.'
      }
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async evaluate(sessionId: string, code: string): Promise<string> {
    if (!code.trim()) return 'Error: code is required'
    const entry = this.page(sessionId)
    try {
      const value = await this.script(entry, code, EVAL_TIMEOUT_MS)
      return evalResult(value)
    } catch (error) {
      if (error instanceof Error && error.message === 'BROWSER_TIMEOUT') {
        this.destroyPage(sessionId, entry)
        return 'Error: the page did not respond in time; the browser was reset.'
      }
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private close(sessionId: string): string {
    const entry = this.pages.get(sessionId)
    if (!entry) return 'Browser is not open.'
    this.destroyPage(sessionId, entry)
    return 'Browser closed.'
  }
}
