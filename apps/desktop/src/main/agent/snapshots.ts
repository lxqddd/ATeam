import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { readJsonFile, writeJsonAtomic } from './atomic-json'

export interface WorkspaceSnapshot {
  id: string
  createdAt: string
  root: string
  files: Record<string, string>
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

  async create(workspacePath: string): Promise<WorkspaceSnapshot> {
    const root = path.resolve(workspacePath)
    const files = await walkFiles(root)
    for (const [relative, blob] of Object.entries(files)) {
      const content = await fs.readFile(path.join(root, relative))
      await fs.writeFile(path.join(this.blobsDirectory, blob), content)
    }
    const snapshot: WorkspaceSnapshot = {
      id: randomUUID(),
      createdAt: nowIso(),
      root,
      files
    }
    await writeJsonAtomic(this.manifestPath(snapshot.id), snapshot)
    return snapshot
  }

  async get(id: string): Promise<WorkspaceSnapshot | null> {
    return readJsonFile<WorkspaceSnapshot>(this.manifestPath(id))
  }

  async restore(workspacePath: string, id: string): Promise<RestoreResult> {
    const snapshot = await this.get(id)
    if (!snapshot) throw new Error('SNAPSHOT_NOT_FOUND')
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
