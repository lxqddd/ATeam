import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { FileChange, FileChangeStatus } from '@ateam/shared'
import { structuredPatch } from 'diff'
import { readJsonFile, writeJsonAtomic } from '../atomic-json'

const execFileAsync = promisify(execFile)

export interface SnapshotReference {
  alias: string
  root: string
}

export interface WorkspaceSnapshot {
  id: string
  createdAt: string
  root: string
  sessionId?: string
  files: Record<string, string>
  references?: SnapshotReference[]
}

export interface SnapshotDiff {
  added: string[]
  modified: string[]
  deleted: string[]
}

export interface RestoreResult {
  written: string[]
  removed: string[]
}

const SNAPSHOT_DIR = 'snapshots'
const BLOB_DIR = 'blobs'
const IGNORED_NAMES = new Set(['.git'])
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024
const MAX_REFERENCE_FILES = 5_000
const REFERENCE_KEY_PREFIX = '\u0000refs/'
const MAX_DIFF_BYTES = 512 * 1024
const MAX_DIFF_LINES = 5_000
const MAX_DIFF_FILES = 200

export function referenceSnapshotKey(alias: string, relative: string): string {
  return `${REFERENCE_KEY_PREFIX}${alias}/${relative}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function hash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

async function walkFiles(
  root: string,
  directory = '',
  files: Record<string, string> = {},
  limit = Number.POSITIVE_INFINITY
): Promise<Record<string, string>> {
  if (Object.keys(files).length >= limit) return files
  const absolute = path.join(root, directory)
  const entries = await fs.readdir(absolute, { withFileTypes: true })
  for (const entry of entries) {
    if (Object.keys(files).length >= limit) break
    if (IGNORED_NAMES.has(entry.name)) continue
    const relative = directory ? `${directory}/${entry.name}` : entry.name
    const entryPath = path.join(root, relative)
    if (entry.isDirectory()) {
      await walkFiles(root, relative, files, limit)
    } else if (entry.isFile()) {
      files[relative] = hash(await fs.readFile(entryPath))
    }
  }
  return files
}

async function removeEmptyDirectories(root: string, directory = ''): Promise<void> {
  const absolute = path.join(root, directory)
  const entries = await fs.readdir(absolute, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_NAMES.has(entry.name)) continue
    const relative = directory ? `${directory}/${entry.name}` : entry.name
    await removeEmptyDirectories(root, relative)
    try {
      await fs.rmdir(path.join(root, relative))
    } catch {
      /* not empty */
    }
  }
}

async function isGitRepository(root: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(root, '.git'))
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

async function gitPaths(root: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    maxBuffer: 20 * 1024 * 1024
  })
  return stdout.split('\0').filter(Boolean)
}

async function listGitFiles(root: string): Promise<string[]> {
  const tracked = new Set(await gitPaths(root, ['ls-files', '-z', '--cached']))
  const untracked = await gitPaths(root, ['ls-files', '-z', '--others', '--exclude-standard'])
  const files: string[] = []
  for (const relative of new Set([...tracked, ...untracked])) {
    const entry = await fs.lstat(path.join(root, relative)).catch(() => null)
    if (!entry?.isFile()) continue
    if (!tracked.has(relative) && entry.size > MAX_UNTRACKED_BYTES) continue
    files.push(relative)
  }
  return files
}

async function hashPaths(root: string, paths: string[]): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const relative of paths) {
    try {
      files[relative] = hash(await fs.readFile(path.join(root, relative)))
    } catch {
      /* file disappeared */
    }
  }
  return files
}

export class SnapshotStore {
  private readonly snapshotsDirectory: string
  private readonly blobsDirectory: string
  private readonly pendingBlobs = new Map<string, number>()

  constructor(userDataPath: string) {
    this.snapshotsDirectory = path.join(userDataPath, 'agent', SNAPSHOT_DIR)
    this.blobsDirectory = path.join(this.snapshotsDirectory, BLOB_DIR)
  }

  async init(): Promise<void> {
    await fs.mkdir(this.blobsDirectory, { recursive: true })
  }

  async create(
    workspacePath: string,
    sessionId?: string,
    references: SnapshotReference[] = []
  ): Promise<WorkspaceSnapshot> {
    const root = path.resolve(workspacePath)
    let files: Record<string, string>
    try {
      files = (await isGitRepository(root))
        ? await hashPaths(root, await listGitFiles(root))
        : await walkFiles(root)
    } catch {
      files = await walkFiles(root)
    }

    const captured: SnapshotReference[] = []
    const referenceSources = new Map<string, string>()
    for (const reference of references) {
      const referenceRoot = path.resolve(reference.root)
      if (captured.some((entry) => entry.alias === reference.alias)) continue
      let referenceFiles: Record<string, string>
      try {
        referenceFiles = (await isGitRepository(referenceRoot))
          ? await hashPaths(
              referenceRoot,
              (await listGitFiles(referenceRoot)).slice(0, MAX_REFERENCE_FILES)
            )
          : await walkFiles(referenceRoot, '', {}, MAX_REFERENCE_FILES)
      } catch {
        referenceFiles = {}
      }
      captured.push({ alias: reference.alias, root: referenceRoot })
      for (const [relative, blob] of Object.entries(referenceFiles)) {
        const key = referenceSnapshotKey(reference.alias, relative)
        files[key] = blob
        referenceSources.set(key, path.join(referenceRoot, relative))
      }
    }

    const written = new Set(Object.values(files))
    try {
      for (const [relative, blob] of Object.entries(files)) {
        this.pendingBlobs.set(blob, (this.pendingBlobs.get(blob) ?? 0) + 1)
        const source = referenceSources.get(relative) ?? path.join(root, relative)
        const content = await fs.readFile(source)
        await fs.writeFile(path.join(this.blobsDirectory, blob), content)
      }
      const snapshot: WorkspaceSnapshot = {
        id: randomUUID(),
        createdAt: nowIso(),
        root,
        sessionId,
        files,
        ...(captured.length > 0 ? { references: captured } : {})
      }
      await writeJsonAtomic(this.manifestPath(snapshot.id), snapshot)
      return snapshot
    } finally {
      for (const blob of written) {
        const count = (this.pendingBlobs.get(blob) ?? 1) - 1
        if (count > 0) this.pendingBlobs.set(blob, count)
        else this.pendingBlobs.delete(blob)
      }
    }
  }

  async removeSession(sessionId: string): Promise<number> {
    const files = await fs.readdir(this.snapshotsDirectory)
    const remaining = new Set<string>()
    let removed = 0

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const snapshot = await readJsonFile<WorkspaceSnapshot>(
        path.join(this.snapshotsDirectory, file)
      )
      if (!snapshot) continue
      if (snapshot.sessionId === sessionId) {
        await fs.rm(path.join(this.snapshotsDirectory, file), { force: true })
        removed += 1
      } else {
        for (const blob of Object.values(snapshot.files)) remaining.add(blob)
      }
    }

    const blobs = await fs.readdir(this.blobsDirectory)
    for (const blob of blobs) {
      if (remaining.has(blob) || this.pendingBlobs.has(blob)) continue
      await fs.rm(path.join(this.blobsDirectory, blob), { force: true })
    }
    return removed
  }

  async get(id: string): Promise<WorkspaceSnapshot | null> {
    return readJsonFile<WorkspaceSnapshot>(this.manifestPath(id))
  }

  private async collectCurrent(snapshot: WorkspaceSnapshot): Promise<Record<string, string>> {
    const root = path.resolve(snapshot.root)
    let files: Record<string, string>
    try {
      files = (await isGitRepository(root))
        ? await hashPaths(root, await listGitFiles(root))
        : await walkFiles(root)
    } catch {
      files = await walkFiles(root)
    }
    for (const reference of snapshot.references ?? []) {
      const referenceRoot = path.resolve(reference.root)
      try {
        const referenceFiles = (await isGitRepository(referenceRoot))
          ? await hashPaths(
              referenceRoot,
              (await listGitFiles(referenceRoot)).slice(0, MAX_REFERENCE_FILES)
            )
          : await walkFiles(referenceRoot, '', {}, MAX_REFERENCE_FILES)
        for (const [relative, blob] of Object.entries(referenceFiles)) {
          files[referenceSnapshotKey(reference.alias, relative)] = blob
        }
      } catch {
        /* a missing reference is treated as empty */
      }
    }
    return files
  }

  private async safeWrite(target: string, root: string, content: Buffer): Promise<void> {
    const existing = await fs.lstat(target).catch(() => null)
    if (existing?.isSymbolicLink()) throw new Error('SNAPSHOT_TARGET_IS_SYMLINK')
    const parent = path.dirname(target)
    await fs.mkdir(parent, { recursive: true })
    const realRoot = await fs.realpath(root)
    const realParent = await fs.realpath(parent)
    if (realParent !== realRoot && !realParent.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error('SNAPSHOT_TARGET_ESCAPES_ROOT')
    }
    await fs.writeFile(target, content)
  }

  async restore(id: string): Promise<RestoreResult> {
    const snapshot = await this.get(id)
    if (!snapshot) throw new Error('SNAPSHOT_NOT_FOUND')
    const root = path.resolve(snapshot.root)
    const current = await this.collectCurrent(snapshot)
    const removed: string[] = []
    const written: string[] = []

    for (const relative of Object.keys(current)) {
      if (snapshot.files[relative]) continue
      const resolved = this.targetFor(snapshot, root, relative)
      if (!resolved) continue
      await fs.rm(resolved.target, { force: true })
      removed.push(relative)
    }

    for (const [relative, blob] of Object.entries(snapshot.files)) {
      if (current[relative] === blob) continue
      const resolved = this.targetFor(snapshot, root, relative)
      if (!resolved) continue
      const content = await fs.readFile(path.join(this.blobsDirectory, blob))
      await this.safeWrite(resolved.target, resolved.root, content)
      written.push(relative)
    }

    if (removed.length > 0) {
      await removeEmptyDirectories(root)
      for (const reference of snapshot.references ?? []) {
        await removeEmptyDirectories(path.resolve(reference.root)).catch(() => undefined)
      }
    }

    return { written: written.sort(), removed: removed.sort() }
  }

  private targetFor(
    snapshot: WorkspaceSnapshot,
    workspaceRoot: string,
    relative: string
  ): { target: string; root: string } | null {
    if (relative.startsWith(REFERENCE_KEY_PREFIX)) {
      const rest = relative.slice(REFERENCE_KEY_PREFIX.length)
      const slash = rest.indexOf('/')
      const alias = slash === -1 ? rest : rest.slice(0, slash)
      const subPath = slash === -1 ? '' : rest.slice(slash + 1)
      const reference = snapshot.references?.find((entry) => entry.alias === alias)
      if (!reference || !subPath || subPath.split('/').includes('..')) return null
      const root = path.resolve(reference.root)
      const target = path.join(root, subPath)
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null
      return { target, root }
    }
    const target = path.join(workspaceRoot, relative)
    if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) return null
    return { target, root: workspaceRoot }
  }

  async changes(
    fromId: string | null,
    toId: string | null,
    options: { current?: boolean; paths?: string[] } = {}
  ): Promise<{ files: FileChange[]; truncated: boolean }> {
    const from = fromId ? await this.get(fromId) : null
    const to = toId ? await this.get(toId) : null
    if ((fromId && !from) || (toId && !to)) throw new Error('SNAPSHOT_NOT_FOUND')
    const referenceSnapshot = to ?? from
    if (!referenceSnapshot) throw new Error('SNAPSHOT_NOT_FOUND')

    const fromFiles = from?.files ?? {}
    const toFiles = to?.files ?? {}
    const providedPaths = options.paths ?? []
    if (!to && providedPaths.length === 0) return { files: [], truncated: false }
    const changedKeys = new Set(providedPaths)
    if (to) {
      for (const key of Object.keys(toFiles)) {
        if (fromFiles[key] !== toFiles[key]) changedKeys.add(key)
      }
      for (const key of Object.keys(fromFiles)) {
        if (!Object.prototype.hasOwnProperty.call(toFiles, key)) changedKeys.add(key)
      }
    }
    const keys = [...changedKeys].sort()
    const files: FileChange[] = []
    for (const key of keys.slice(0, MAX_DIFF_FILES)) {
      const beforeExists = Object.prototype.hasOwnProperty.call(fromFiles, key)
      const afterBlob = options.current
        ? null
        : Object.prototype.hasOwnProperty.call(toFiles, key)
          ? toFiles[key]
          : null
      let before: Buffer | null = null
      let after: Buffer | null = null
      let error: string | null = null
      if (beforeExists) {
        try {
          before = await fs.readFile(path.join(this.blobsDirectory, fromFiles[key]))
        } catch {
          error = 'SNAPSHOT_BLOB_MISSING'
        }
      }
      if (options.current) {
        after = await this.readCurrentFile(referenceSnapshot, key)
      } else if (afterBlob) {
        try {
          after = await fs.readFile(path.join(this.blobsDirectory, afterBlob))
        } catch {
          error = 'SNAPSHOT_BLOB_MISSING'
        }
      }
      if (!before && !after) continue
      if (before && after && before.equals(after)) continue
      const status: FileChangeStatus = !before ? 'added' : !after ? 'deleted' : 'modified'
      files.push(this.buildFileChange(key, status, before, after, error))
    }
    return { files, truncated: keys.length > MAX_DIFF_FILES }
  }

  private async readCurrentFile(snapshot: WorkspaceSnapshot, key: string): Promise<Buffer | null> {
    const target = this.targetFor(snapshot, path.resolve(snapshot.root), key)
    if (!target) return null
    return fs.readFile(target.target).catch(() => null)
  }

  private buildFileChange(
    key: string,
    status: FileChangeStatus,
    before: Buffer | null,
    after: Buffer | null,
    error: string | null
  ): FileChange {
    const displayPath = key.startsWith(REFERENCE_KEY_PREFIX)
      ? `@${key.slice(REFERENCE_KEY_PREFIX.length)}`
      : key
    const base = {
      path: displayPath,
      snapshotPath: key,
      status,
      binary: false,
      truncated: false,
      additions: 0,
      deletions: 0,
      hunks: [] as FileChange['hunks'],
      error
    }
    if (error) return base
    const binary = [before, after].some((content) => content !== null && content.includes(0))
    if (binary) return { ...base, binary: true }
    const beforeLength = before?.length ?? 0
    const afterLength = after?.length ?? 0
    const beforeText = before?.toString('utf8') ?? ''
    const afterText = after?.toString('utf8') ?? ''
    if (
      beforeLength > MAX_DIFF_BYTES ||
      afterLength > MAX_DIFF_BYTES ||
      beforeText.split('\n').length > MAX_DIFF_LINES ||
      afterText.split('\n').length > MAX_DIFF_LINES
    ) {
      return { ...base, truncated: true }
    }
    try {
      const patch = structuredPatch(displayPath, displayPath, beforeText, afterText, '', '', {
        context: 3
      })
      const hunks = patch.hunks.map((hunk) => ({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: [...hunk.lines]
      }))
      let additions = 0
      let deletions = 0
      for (const hunk of hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith('+')) additions += 1
          else if (line.startsWith('-')) deletions += 1
        }
      }
      return { ...base, additions, deletions, hunks }
    } catch {
      return { ...base, error: 'DIFF_FAILED' }
    }
  }

  async restorePaths(id: string, paths: string[]): Promise<RestoreResult> {
    const snapshot = await this.get(id)
    if (!snapshot) throw new Error('SNAPSHOT_NOT_FOUND')
    const root = path.resolve(snapshot.root)
    const removed: string[] = []
    const written: string[] = []

    for (const raw of paths) {
      const relative = raw.replace(/\\/g, '/').replace(/^\.\//, '')
      if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) continue
      const resolved = this.targetFor(snapshot, root, relative)
      if (!resolved) continue
      const blob = snapshot.files[relative]
      if (blob) {
        const content = await fs.readFile(path.join(this.blobsDirectory, blob))
        await this.safeWrite(resolved.target, resolved.root, content)
        written.push(relative)
      } else {
        await fs.rm(resolved.target, { force: true })
        removed.push(relative)
      }
    }
    if (removed.length > 0) {
      await removeEmptyDirectories(root)
      for (const reference of snapshot.references ?? []) {
        await removeEmptyDirectories(path.resolve(reference.root)).catch(() => undefined)
      }
    }

    return { written: written.sort(), removed: removed.sort() }
  }

  async diff(fromId: string | null, toId: string | null): Promise<SnapshotDiff> {
    const from = fromId ? await this.get(fromId) : null
    const to = toId ? await this.get(toId) : null
    const fromFiles = from?.files ?? {}
    const toFiles = to?.files ?? {}
    const added: string[] = []
    const modified: string[] = []
    const deleted: string[] = []

    for (const relative of Object.keys(toFiles)) {
      if (!(relative in fromFiles)) added.push(relative)
      else if (fromFiles[relative] !== toFiles[relative]) modified.push(relative)
    }
    for (const relative of Object.keys(fromFiles)) {
      if (!(relative in toFiles)) deleted.push(relative)
    }

    return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() }
  }

  private manifestPath(id: string): string {
    return path.join(this.snapshotsDirectory, `${id}.json`)
  }
}
