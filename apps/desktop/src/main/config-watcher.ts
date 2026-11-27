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

/** Global agent files whose external edits are reported as `global` changes. */
const GLOBAL_WATCHED_FILES = ['config.json', 'permissions.json', 'mcp.json'] as const

function normalizeFilename(filename: string | Buffer | null): string | null {
  if (filename === null) return null
  return typeof filename === 'string' ? filename : filename.toString()
}

function contentHash(content: Buffer | string): string {
  return createHash('sha1').update(content).digest('hex')
}

/**
 * Watches the global `userData/agent/{config,permissions,mcp}.json` and project
 * `ateam.json(c)` files for external edits. Directories are watched instead of
 * files because atomic saves replace the file (tmp + rename), which would drop
 * a file watch. Project roots are leased by sessions, so switching or deleting
 * a session releases roots no other session or `trackWorkspace` caller needs.
 */
export class ConfigWatcher {
  private readonly globalDir: string
  private readonly globalFiles: Set<string>
  private readonly projects = new Map<string, ProjectWatch>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly mtimes = new Map<string, number>()
  private readonly selfWrites = new Map<
    string,
    { hash: Promise<string | null>; expiresAt: number }
  >()
  /** Session id -> resolved workspace path, to skip repeated root resolution. */
  private readonly sessionPaths = new Map<string, string>()
  /** Session id -> project root currently leased. */
  private readonly sessionRoots = new Map<string, string>()
  /** Project root -> sessions holding a lease. */
  private readonly rootSessions = new Map<string, Set<string>>()
  /** Roots tracked through `trackWorkspace`; sessions never release them. */
  private readonly persistentRoots = new Set<string>()
  private readonly debounceMs: number
  private readonly selfWriteWindowMs: number
  private readonly maxProjectRoots: number
  private rootChain: Promise<void> = Promise.resolve()
  private globalWatcher: fs.FSWatcher | null = null
  private disposed = false

  constructor(private readonly options: ConfigWatcherOptions) {
    this.globalDir = path.join(options.userDataPath, 'agent')
    this.globalFiles = new Set(
      GLOBAL_WATCHED_FILES.map((name) => path.resolve(path.join(this.globalDir, name)))
    )
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
   * Starts watching the project root that owns `workspacePath` as a persistent
   * lease. Idempotent: workspaces under the same root share one watcher.
   */
  trackWorkspace(workspacePath: string): Promise<void> {
    return this.enqueueRootTask(async () => {
      if (this.disposed) return
      const root = await this.resolveRoot(workspacePath)
      this.persistentRoots.add(root)
      this.ensureProjectWatcher(root)
    })
  }

  /**
   * Leases the project root of a session's workspace. Passing `null` (or moving
   * to another workspace) releases the previous lease; the root is closed once
   * no session owns it and `trackWorkspace` did not claim it.
   */
  setSessionWorkspace(sessionId: string, workspacePath: string | null): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const target = workspacePath ? path.resolve(workspacePath) : null
    if ((this.sessionPaths.get(sessionId) ?? null) === target) {
      const root = this.sessionRoots.get(sessionId)
      const entry = root ? this.projects.get(root) : undefined
      if (entry) entry.lastUsed = Date.now()
      return Promise.resolve()
    }
    return this.enqueueRootTask(async () => {
      if (this.disposed) return
      this.releaseSessionRoot(sessionId)
      if (!target) {
        this.sessionPaths.delete(sessionId)
        return
      }
      const root = await this.resolveRoot(target)
      this.sessionPaths.set(sessionId, target)
      this.sessionRoots.set(sessionId, root)
      let owners = this.rootSessions.get(root)
      if (!owners) {
        owners = new Set()
        this.rootSessions.set(root, owners)
      }
      owners.add(sessionId)
      this.ensureProjectWatcher(root)
    })
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
    this.sessionPaths.clear()
    this.sessionRoots.clear()
    this.rootSessions.clear()
    this.persistentRoots.clear()
    this.rootChain = Promise.resolve()
    this.globalWatcher?.close()
    this.globalWatcher = null
    for (const entry of this.projects.values()) entry.watcher.close()
    this.projects.clear()
  }

  private enqueueRootTask(task: () => Promise<void>): Promise<void> {
    const run = this.rootChain.then(task, task)
    this.rootChain = run.catch(() => undefined)
    return run
  }

  private async resolveRoot(workspacePath: string): Promise<string> {
    try {
      return await findProjectRoot(workspacePath)
    } catch {
      return path.resolve(workspacePath)
    }
  }

  private ensureProjectWatcher(root: string): void {
    if (this.disposed) return
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

  private releaseSessionRoot(sessionId: string): void {
    const root = this.sessionRoots.get(sessionId)
    this.sessionRoots.delete(sessionId)
    if (!root) return
    const owners = this.rootSessions.get(root)
    owners?.delete(sessionId)
    if (!owners || owners.size > 0) return
    this.rootSessions.delete(root)
    if (!this.persistentRoots.has(root)) this.closeProjectRoot(root)
  }

  private closeProjectRoot(root: string): void {
    const entry = this.projects.get(root)
    if (entry) {
      entry.watcher.close()
      this.projects.delete(root)
    }
    this.persistentRoots.delete(root)
    const prefix = `${root}${path.sep}`
    for (const [file, timer] of this.timers) {
      if (!file.startsWith(prefix)) continue
      clearTimeout(timer)
      this.timers.delete(file)
    }
    for (const file of [...this.mtimes.keys()]) {
      if (file.startsWith(prefix)) this.mtimes.delete(file)
    }
    for (const file of [...this.selfWrites.keys()]) {
      if (file.startsWith(prefix)) this.selfWrites.delete(file)
    }
  }

  private handleGlobalEvent(filename: string | Buffer | null): void {
    if (this.disposed) return
    const name = normalizeFilename(filename)
    if (name === null) {
      void this.scheduleWhenChanged([...this.globalFiles])
      return
    }
    const file = path.resolve(path.join(this.globalDir, name))
    if (this.globalFiles.has(file)) this.schedule(file)
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
    const global = this.globalFiles.has(path.resolve(file))
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
    // Keep the entry for the rest of the window: platforms may deliver several
    // events for a single write, and every one of them must be dropped.
    return true
  }

  private evictProjects(): void {
    if (this.projects.size <= this.maxProjectRoots) return
    const oldest = [...this.projects.entries()]
      .filter(([root]) => (this.rootSessions.get(root)?.size ?? 0) === 0)
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed)
    for (const [root] of oldest) {
      if (this.projects.size <= this.maxProjectRoots) break
      this.closeProjectRoot(root)
    }
  }
}
