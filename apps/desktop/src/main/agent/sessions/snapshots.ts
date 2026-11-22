import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
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

function nowIso(): string {
  return new Date().toISOString()
}

function hash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

async function walkFiles(
  root: string,
  directory = '',
  files: Record<string, string> = {}
): Promise<Record<string, string>> {
  const absolute = path.join(root, directory)
  const entries = await fs.readdir(absolute, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue
    const relative = directory ? `${directory}/${entry.name}` : entry.name
    const entryPath = path.join(root, relative)
    if (entry.isDirectory()) {
      await walkFiles(root, relative, files)
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
    for (const reference of references) {
      const referenceRoot = path.resolve(reference.root)
      if (captured.some((entry) => entry.alias === reference.alias)) continue
      let referenceFiles: Record<string, string>
      try {
        referenceFiles = (await isGitRepository(referenceRoot))
          ? await hashPaths(referenceRoot, await listGitFiles(referenceRoot))
          : await walkFiles(referenceRoot)
      } catch {
        referenceFiles = {}
      }
      captured.push({ alias: reference.alias, root: referenceRoot })
      for (const [relative, blob] of Object.entries(referenceFiles)) {
        files[`refs/${reference.alias}/${relative}`] = blob
      }
    }

    for (const [relative, blob] of Object.entries(files)) {
      const source = relative.startsWith('refs/')
        ? path.join(
            captured.find((entry) => relative.startsWith(`refs/${entry.alias}/`))?.root ?? root,
            relative.split('/').slice(2).join('/')
          )
        : path.join(root, relative)
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
      if (!remaining.has(blob)) await fs.rm(path.join(this.blobsDirectory, blob), { force: true })
    }
    return removed
  }

  async get(id: string): Promise<WorkspaceSnapshot | null> {
    return readJsonFile<WorkspaceSnapshot>(this.manifestPath(id))
  }

  async restore(workspacePath: string, id: string): Promise<RestoreResult> {
    const snapshot = await this.get(id)
    if (!snapshot) throw new Error('SNAPSHOT_NOT_FOUND')
    if (path.resolve(snapshot.root) !== path.resolve(workspacePath)) {
      throw new Error('SNAPSHOT_WORKSPACE_MISMATCH')
    }
    const root = path.resolve(workspacePath)
    const current = await walkFiles(root)
    const removed: string[] = []
    const written: string[] = []

    for (const relative of Object.keys(current)) {
      if (snapshot.files[relative]) continue
      await fs.rm(path.join(root, relative), { force: true })
      removed.push(relative)
    }
    if (removed.length > 0) await removeEmptyDirectories(root)

    for (const [relative, blob] of Object.entries(snapshot.files)) {
      if (current[relative] === blob) continue
      const content = await fs.readFile(path.join(this.blobsDirectory, blob))
      const target = path.join(root, relative)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
      written.push(relative)
    }

    return { written: written.sort(), removed: removed.sort() }
  }

  private targetFor(
    snapshot: WorkspaceSnapshot,
    workspaceRoot: string,
    relative: string
  ): { target: string; root: string } | null {
    const parts = relative.split('/')
    if (parts[0] === 'refs') {
      const alias = parts[1]
      const subPath = parts.slice(2).join('/')
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

  async restorePaths(workspacePath: string, id: string, paths: string[]): Promise<RestoreResult> {
    const snapshot = await this.get(id)
    if (!snapshot) throw new Error('SNAPSHOT_NOT_FOUND')
    if (path.resolve(snapshot.root) !== path.resolve(workspacePath)) {
      throw new Error('SNAPSHOT_WORKSPACE_MISMATCH')
    }
    const root = path.resolve(workspacePath)
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
        await fs.mkdir(path.dirname(resolved.target), { recursive: true })
        await fs.writeFile(resolved.target, content)
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
