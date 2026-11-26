import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ConfigFileChange } from '@ateam/shared'
import { PROJECT_CONFIG_FILENAMES, findProjectRoot } from '@ateam/agent-core/config'

export interface ConfigWatcherOptions {
  userDataPath: string
  /** Called once per debounced change, after app writes are filtered out. */
  onChange: (change: ConfigFileChange) => void
  /** Per-file debounce before a change is reported. */
  debounceMs?: number
  /** Window in which a write made by the app itself is ignored. */
  selfWriteWindowMs?: number
  /** Maximum watched project roots; the least recently used one is dropped. */
  maxProjectRoots?: number
}

interface ProjectWatch {
  watcher: fs.FSWatcher
  lastUsed: number
}

const GLOBAL_CONFIG_NAME = 'config.json'

function normalizeFilename(filename: string | Buffer | null): string | null {
  if (filename === null) return null
  return typeof filename === 'string' ? filename : filename.toString()
}

function contentHash(content: Buffer | string): string {
  return createHash('sha1').update(content).digest('hex')
}

/**
 * Watches the global `userData/agent/config.json` and project `ateam.json(c)`
 * files for external edits. Directories are watched instead of files because
 * atomic saves replace the file (tmp + rename), which would drop a file watch.
 */
export class ConfigWatcher {
  private readonly globalDir: string
  private readonly globalFile: string
  private readonly projects = new Map<string, ProjectWatch>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly mtimes = new Map<string, number>()
  private readonly selfWrites = new Map<
    string,
    { hash: Promise<string | null>; expiresAt: number }
  >()
  private readonly debounceMs: number
  private readonly selfWriteWindowMs: number
  private readonly maxProjectRoots: number
  private globalWatcher: fs.FSWatcher | null = null
  private disposed = false

  constructor(private readonly options: ConfigWatcherOptions) {
    this.globalDir = path.join(options.userDataPath, 'agent')
    this.globalFile = path.join(this.globalDir, GLOBAL_CONFIG_NAME)
    this.debounceMs = options.debounceMs ?? 200
    this.selfWriteWindowMs = options.selfWriteWindowMs ?? 5_000
    this.maxProjectRoots = options.maxProjectRoots ?? 32
    try {
      fs.mkdirSync(this.globalDir, { recursive: true })
      this.globalWatcher = fs.watch(this.globalDir, { persistent: false }, (_event, filename) => {
        this.handleGlobalEvent(filename)
      })
      this.globalWatcher.on('error', () => {
        this.globalWatcher?.close()
        this.globalWatcher = null
      })
    } catch {
      this.globalWatcher = null
    }
  }

  /**
   * Starts watching the project root that owns `workspacePath`. Idempotent:
   * workspaces under the same root share one watcher.
   */
  async trackWorkspace(workspacePath: string): Promise<void> {
    if (this.disposed) return
    let root: string
    try {
      root = await findProjectRoot(workspacePath)
    } catch {
      root = path.resolve(workspacePath)
    }
    const existing = this.projects.get(root)
    if (existing) {
      existing.lastUsed = Date.now()
      return
    }
    let watcher: fs.FSWatcher
    try {
      watcher = fs.watch(root, { persistent: false }, (_event, filename) => {
        this.handleProjectEvent(root, filename)
      })
    } catch {
      return
    }
    watcher.on('error', () => {
      watcher.close()
      this.projects.delete(root)
    })
    this.projects.set(root, { watcher, lastUsed: Date.now() })
    this.evictProjects()
  }

  /**
   * Records a write made by the app itself. The matching watch event is
   * dropped when the file still has this content within the suppression window.
   * The entry is registered synchronously so a debounced event that fires while
   * the hash is still being computed waits for it instead of reporting.
   */
  noteSelfWrite(filePath: string): void {
    const key = path.resolve(filePath)
    const hash = fsp
      .readFile(key)
      .then((content) => contentHash(content))
      .catch(() => null)
    this.selfWrites.set(key, { hash, expiresAt: Date.now() + this.selfWriteWindowMs })
  }

  dispose(): void {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.selfWrites.clear()
    this.mtimes.clear()
    this.globalWatcher?.close()
    this.globalWatcher = null
    for (const entry of this.projects.values()) entry.watcher.close()
    this.projects.clear()
  }

  private handleGlobalEvent(filename: string | Buffer | null): void {
    if (this.disposed) return
    const name = normalizeFilename(filename)
    if (name === null) {
      void this.scheduleWhenChanged([this.globalFile])
      return
    }
    if (name === GLOBAL_CONFIG_NAME) this.schedule(this.globalFile)
  }

  private handleProjectEvent(root: string, filename: string | Buffer | null): void {
    if (this.disposed) return
    const name = normalizeFilename(filename)
    if (name === null) {
      void this.scheduleWhenChanged(PROJECT_CONFIG_FILENAMES.map((entry) => path.join(root, entry)))
      return
    }
    if ((PROJECT_CONFIG_FILENAMES as readonly string[]).includes(name)) {
      this.schedule(path.join(root, name))
    }
  }

  /** Falls back to mtime comparison when the platform reports no filename. */
  private async scheduleWhenChanged(files: string[]): Promise<void> {
    for (const file of files) {
      let mtime = 0
      try {
        mtime = (await fsp.stat(file)).mtimeMs
      } catch {
        mtime = 0
      }
      const previous = this.mtimes.get(file)
      this.mtimes.set(file, mtime)
      if (mtime !== previous) this.schedule(file)
    }
  }

  private schedule(file: string): void {
    if (this.disposed) return
    const existing = this.timers.get(file)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.timers.delete(file)
      void this.emit(file)
    }, this.debounceMs)
    timer.unref?.()
    this.timers.set(file, timer)
  }

  private async emit(file: string): Promise<void> {
    if (this.disposed) return
    if (await this.isSelfWrite(file)) return
    const global = path.resolve(file) === path.resolve(this.globalFile)
    const change: ConfigFileChange = global
      ? { global: true, workspaces: [], files: [file] }
      : { global: false, workspaces: [path.dirname(file)], files: [file] }
    try {
      this.options.onChange(change)
    } catch {
      /* a throwing listener must not stop future events */
    }
  }

  private async isSelfWrite(file: string): Promise<boolean> {
    const key = path.resolve(file)
    const entry = this.selfWrites.get(key)
    if (!entry) return false
    if (entry.expiresAt < Date.now()) {
      this.selfWrites.delete(key)
      return false
    }
    const expected = await entry.hash
    if (expected === null) {
      this.selfWrites.delete(key)
      return false
    }
    let hash: string
    try {
      hash = contentHash(await fsp.readFile(key))
    } catch {
      this.selfWrites.delete(key)
      return false
    }
    if (hash !== expected) return false
    this.selfWrites.delete(key)
    return true
  }

  private evictProjects(): void {
    if (this.projects.size <= this.maxProjectRoots) return
    const excess = this.projects.size - this.maxProjectRoots
    const oldest = [...this.projects.entries()]
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed)
      .slice(0, excess)
    for (const [root, entry] of oldest) {
      entry.watcher.close()
      this.projects.delete(root)
    }
  }
}
