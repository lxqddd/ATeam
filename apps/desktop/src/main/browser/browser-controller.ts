import { BrowserWindow, type Session } from 'electron'
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
const MAX_TABS = 8

interface NetworkEntry {
  id: number
  method: string
  url: string
  resourceType: string
  status: number | null
  error: string | null
}

interface PageEntry {
  tabId: string
  contentsId: number
  window: BrowserWindow
  consoleLines: string[]
  network: NetworkEntry[]
}

interface InteractionResult {
  ok: boolean
  error?: string
  title?: string
  url?: string
}

export class BrowserController {
  private readonly pages = new Map<string, Map<string, PageEntry>>()
  private readonly active = new Map<string, string>()
  private readonly byContents = new Map<number, PageEntry>()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly securedSessions = new WeakSet<Session>()
  private generation = 0
  private nextTab = 1

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

  private tabId(params: Record<string, unknown>): string | undefined {
    return typeof params.tabId === 'string' && params.tabId ? params.tabId : undefined
  }

  private async dispatch(
    sessionId: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const tabId = this.tabId(params)
    switch (method) {
      case 'open':
        return this.open(sessionId, String(params.url ?? ''), params.newTab === true, tabId)
      case 'tabs':
        return this.tabs(sessionId)
      case 'snapshot':
        return this.snapshot(sessionId, tabId)
      case 'click':
        return this.click(sessionId, String(params.ref ?? ''), tabId)
      case 'type':
        return this.type(
          sessionId,
          String(params.ref ?? ''),
          String(params.text ?? ''),
          params.submit === true,
          tabId
        )
      case 'screenshot':
        return this.screenshot(sessionId, tabId)
      case 'eval':
        return this.evaluate(sessionId, String(params.code ?? ''), tabId)
      case 'network':
        return this.network(sessionId, tabId)
      case 'upload':
        return this.upload(sessionId, String(params.ref ?? ''), String(params.path ?? ''), tabId)
      case 'close':
        return this.close(sessionId, tabId)
      default:
        throw new Error(`UNKNOWN_BROWSER_METHOD: ${method}`)
    }
  }

  async dispose(): Promise<void> {
    this.generation += 1
    for (const tabs of this.pages.values()) {
      for (const entry of tabs.values()) {
        if (!entry.window.isDestroyed()) entry.window.destroy()
      }
    }
    this.pages.clear()
    this.active.clear()
    this.byContents.clear()
  }

  private create(sessionId: string): PageEntry {
    const tabs = this.pages.get(sessionId)
    if (tabs && tabs.size >= MAX_TABS) {
      throw new Error(`BROWSER_TAB_LIMIT: at most ${MAX_TABS} tabs`)
    }
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
    const contents = window.webContents
    const entry: PageEntry = {
      tabId: `tab-${this.nextTab++}`,
      contentsId: contents.id,
      window,
      consoleLines: [],
      network: []
    }
    this.byContents.set(contents.id, entry)
    const browserSession = contents.session
    if (!this.securedSessions.has(browserSession)) {
      this.securedSessions.add(browserSession)
      browserSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false)
      )
      browserSession.on('will-download', (event) => {
        event.preventDefault()
      })
      browserSession.webRequest.onBeforeRequest((details, callback) => {
        const page =
          details.webContentsId === undefined
            ? undefined
            : this.byContents.get(details.webContentsId)
        if (page && /^https?:/i.test(details.url)) {
          page.network.push({
            id: details.id,
            method: details.method,
            url: details.url,
            resourceType: details.resourceType,
            status: null,
            error: null
          })
          if (page.network.length > 100) page.network.shift()
        }
        callback({})
      })
      browserSession.webRequest.onCompleted((details) => {
        const entry =
          details.webContentsId === undefined
            ? undefined
            : this.byContents
                .get(details.webContentsId)
                ?.network.find((item) => item.id === details.id)
        if (entry) entry.status = details.statusCode
      })
      browserSession.webRequest.onErrorOccurred((details) => {
        const entry =
          details.webContentsId === undefined
            ? undefined
            : this.byContents
                .get(details.webContentsId)
                ?.network.find((item) => item.id === details.id)
        if (entry) entry.error = details.error
      })
    }
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const target = validateBrowserUrl(url)
        void this.handle(sessionId, 'open', { url: target, newTab: true }).catch(() => undefined)
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
      this.forget(sessionId, entry)
    })

    const all = this.pages.get(sessionId) ?? new Map<string, PageEntry>()
    all.set(entry.tabId, entry)
    this.pages.set(sessionId, all)
    this.active.set(sessionId, entry.tabId)
    return entry
  }

  private page(sessionId: string, tabId?: string): PageEntry {
    const tabs = this.pages.get(sessionId)
    if (tabId) {
      const found = tabs?.get(tabId)
      if (!found || found.window.isDestroyed()) throw new Error('BROWSER_TAB_NOT_FOUND')
      this.active.set(sessionId, tabId)
      return found
    }
    const current = tabs && this.active.get(sessionId)
    const existing = current ? tabs?.get(current) : undefined
    if (existing && !existing.window.isDestroyed()) return existing
    return this.create(sessionId)
  }

  private findPage(sessionId: string, tabId?: string): PageEntry | null {
    const tabs = this.pages.get(sessionId)
    if (!tabs || tabs.size === 0) return null
    const wanted = tabId ?? this.active.get(sessionId)
    const entry = wanted ? tabs.get(wanted) : undefined
    return entry && !entry.window.isDestroyed() ? entry : null
  }

  private forget(sessionId: string, entry: PageEntry): void {
    this.byContents.delete(entry.contentsId)
    const tabs = this.pages.get(sessionId)
    if (!tabs) return
    tabs.delete(entry.tabId)
    if (tabs.size === 0) {
      this.pages.delete(sessionId)
      this.active.delete(sessionId)
    } else if (this.active.get(sessionId) === entry.tabId) {
      this.active.set(sessionId, [...tabs.keys()][0])
    }
  }

  private destroyPage(sessionId: string, entry: PageEntry): void {
    this.forget(sessionId, entry)
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

  private async open(
    sessionId: string,
    rawUrl: string,
    newTab: boolean,
    tabId?: string
  ): Promise<string> {
    const url = validateBrowserUrl(rawUrl)
    const generation = this.generation
    const entry = newTab ? this.create(sessionId) : this.page(sessionId, tabId)
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
      if (generation !== this.generation) {
        this.destroyPage(sessionId, entry)
        throw new Error('BROWSER_CLOSED')
      }
    } catch (error) {
      await loaded.catch(() => undefined)
      if (error instanceof Error && error.message === 'BROWSER_TIMEOUT') {
        this.destroyPage(sessionId, entry)
      }
      throw error
    }
    return `Opened ${contents.getTitle() || '(untitled)'} (${contents.getURL()}) [${entry.tabId}]`
  }

  private tabs(sessionId: string): string {
    const tabs = this.pages.get(sessionId)
    if (!tabs || tabs.size === 0) return 'No browser tabs are open.'
    const active = this.active.get(sessionId)
    return [
      'Browser tabs:',
      ...[...tabs.values()]
        .filter((entry) => !entry.window.isDestroyed())
        .map(
          (entry) =>
            `- [${entry.tabId}]${entry.tabId === active ? ' (active)' : ''} ${entry.window.webContents.getTitle() || '(untitled)'} (${entry.window.webContents.getURL()})`
        )
    ].join('\n')
  }

  private async snapshot(sessionId: string, tabId?: string): Promise<string> {
    let entry: PageEntry
    try {
      entry = this.page(sessionId, tabId)
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
    try {
      const snapshot = (await this.script(entry, snapshotScript())) as BrowserSnapshot
      return formatSnapshot(snapshot, entry.consoleLines)
    } catch (error) {
      return this.pageError(sessionId, entry, error)
    }
  }

  private pageError(sessionId: string, entry: PageEntry, error: unknown): string {
    if (error instanceof Error && error.message === 'BROWSER_TIMEOUT') {
      this.destroyPage(sessionId, entry)
      return 'Error: the page is not responding; the tab was reset.'
    }
    return `Error: ${error instanceof Error ? error.message : String(error)}`
  }

  private formatInteraction(action: string, ref: string, result: InteractionResult): string {
    if (!result.ok) return `Could not ${action} [${ref}]: ${result.error ?? 'unknown error'}`
    return `${action} [${ref}] -> ${result.title || '(untitled)'} (${result.url})`
  }

  private async interaction(
    sessionId: string,
    action: string,
    ref: string,
    source: string,
    tabId?: string
  ): Promise<string> {
    let entry: PageEntry
    try {
      entry = this.page(sessionId, tabId)
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
    try {
      const result = (await this.script(entry, source)) as InteractionResult
      return this.formatInteraction(action, ref, result)
    } catch (error) {
      return this.pageError(sessionId, entry, error)
    }
  }

  private click(sessionId: string, ref: string, tabId?: string): Promise<string> {
    return this.interaction(sessionId, 'Clicked', ref, clickScript(ref), tabId)
  }

  private type(
    sessionId: string,
    ref: string,
    text: string,
    submit: boolean,
    tabId?: string
  ): Promise<string> {
    return this.interaction(
      sessionId,
      submit ? 'Typed and submitted' : 'Typed into',
      ref,
      typeScript(ref, text, submit),
      tabId
    )
  }

  private async screenshot(
    sessionId: string,
    tabId?: string
  ): Promise<{ summary: string; image: { mimeType: string; data: string } } | string> {
    let entry: PageEntry
    try {
      entry = this.page(sessionId, tabId)
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
    const contents = entry.window.webContents
    try {
      const image = await this.withTimeout(contents.capturePage(), SCRIPT_TIMEOUT_MS)
      const png = image.toPNG()
      if (png.byteLength > MAX_SCREENSHOT_BYTES) return 'Error: screenshot exceeds 5 MB'
      return {
        summary: `Screenshot: ${contents.getTitle() || '(untitled)'} (${contents.getURL()}) [${entry.tabId}]`,
        image: { mimeType: 'image/png', data: png.toString('base64') }
      }
    } catch (error) {
      return this.pageError(sessionId, entry, error)
    }
  }

  private async evaluate(sessionId: string, code: string, tabId?: string): Promise<string> {
    if (!code.trim()) return 'Error: code is required'
    let entry: PageEntry
    try {
      entry = this.page(sessionId, tabId)
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
    try {
      const value = await this.script(entry, code, EVAL_TIMEOUT_MS)
      return evalResult(value)
    } catch (error) {
      return this.pageError(sessionId, entry, error)
    }
  }

  private network(sessionId: string, tabId?: string): string {
    const entry = this.findPage(sessionId, tabId)
    if (!entry) return 'Browser is not open.'
    if (entry.network.length === 0) return 'No network requests recorded.'
    return [
      'Network requests:',
      ...entry.network.map(
        (item) =>
          `${item.status ?? (item.error ? 'ERR' : '...')} ${item.method} ${item.url} (${item.resourceType})${item.error ? ` — ${item.error}` : ''}`
      )
    ].join('\n')
  }

  private async upload(
    sessionId: string,
    ref: string,
    filePath: string,
    tabId?: string
  ): Promise<string> {
    if (!/^\d{1,6}$/.test(ref) || !filePath.trim()) return 'Error: invalid upload request'
    const entry = this.findPage(sessionId, tabId)
    if (!entry) return 'Browser is not open.'
    const contents = entry.window.webContents
    let attached = false
    try {
      if (!contents.debugger.isAttached()) {
        contents.debugger.attach('1.3')
        attached = true
      }
      const document = (await contents.debugger.sendCommand('DOM.getDocument', {
        depth: -1
      })) as { root: { nodeId: number } }
      const found = (await contents.debugger.sendCommand('DOM.querySelector', {
        nodeId: document.root.nodeId,
        selector: `[data-ateam-ref="${ref}"]`
      })) as { nodeId: number }
      if (!found.nodeId) return `Could not upload [${ref}]: take a new snapshot first.`
      await contents.debugger.sendCommand('DOM.setFileInputFiles', {
        files: [filePath],
        nodeId: found.nodeId
      })
      return `Uploaded ${filePath} into [${ref}].`
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    } finally {
      if (attached && contents.debugger.isAttached()) {
        try {
          contents.debugger.detach()
        } catch {
          /* ignore */
        }
      }
    }
  }

  private close(sessionId: string, tabId?: string): string {
    if (tabId) {
      const entry = this.pages.get(sessionId)?.get(tabId)
      if (!entry) return `Browser tab ${tabId} is not open.`
      this.destroyPage(sessionId, entry)
      return `Browser tab ${tabId} closed.`
    }
    const tabs = this.pages.get(sessionId)
    if (!tabs || tabs.size === 0) return 'Browser is not open.'
    for (const entry of [...tabs.values()]) this.destroyPage(sessionId, entry)
    return 'Browser closed.'
  }
}
