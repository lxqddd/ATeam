import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SnapshotStore } from './snapshots'

let directory: string
let workspace: string
let store: SnapshotStore

async function write(filePath: string, content: string | Buffer): Promise<void> {
  const target = path.join(workspace, filePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

async function read(filePath: string): Promise<string> {
  return fs.readFile(path.join(workspace, filePath), 'utf8')
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(workspace, filePath))
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-snapshots-')))
  workspace = path.join(directory, 'workspace')
  await fs.mkdir(workspace, { recursive: true })
  store = new SnapshotStore(directory)
  await store.init()
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('SnapshotStore', () => {
  it('captures workspace files in an external blob store and ignores .git', async () => {
    await write('a.txt', 'one')
    await write('dir/b.txt', 'two')
    await write('.git/config', '[core]')

    const snapshot = await store.create(workspace)

    expect(snapshot.root).toBe(workspace)
    expect(Object.keys(snapshot.files).sort()).toEqual(['a.txt', 'dir/b.txt'])
    const blob = path.join(directory, 'agent', 'snapshots', 'blobs', snapshot.files['a.txt'])
    expect(await fs.readFile(blob, 'utf8')).toBe('one')
  })

  it('persists snapshots across store reloads', async () => {
    await write('a.txt', 'one')
    const snapshot = await store.create(workspace)

    const reloaded = new SnapshotStore(directory)
    await reloaded.init()

    expect(await reloaded.get(snapshot.id)).toEqual(snapshot)
    expect(await reloaded.get('missing')).toBeNull()
  })

  it('restores modified, deleted and added files without touching .git', async () => {
    await write('a.txt', 'one')
    await write('dir/b.txt', 'two')
    await write('.git/config', 'original')
    const snapshot = await store.create(workspace)

    await write('a.txt', 'changed')
    await fs.rm(path.join(workspace, 'dir/b.txt'))
    await write('c.txt', 'new')
    await write('.git/config', 'changed git')

    const result = await store.restore(workspace, snapshot.id)

    expect(await read('a.txt')).toBe('one')
    expect(await read('dir/b.txt')).toBe('two')
    expect(await exists('c.txt')).toBe(false)
    expect(await read('.git/config')).toBe('changed git')
    expect(result.written.sort()).toEqual(['a.txt', 'dir/b.txt'])
    expect(result.removed).toEqual(['c.txt'])
  })

  it('computes added, modified and deleted paths between snapshots', async () => {
    await write('a.txt', 'one')
    await write('dir/b.txt', 'two')
    const first = await store.create(workspace)

    await write('a.txt', 'changed')
    await fs.rm(path.join(workspace, 'dir/b.txt'))
    await write('c.txt', 'new')
    const second = await store.create(workspace)

    expect(await store.diff(first.id, second.id)).toEqual({
      added: ['c.txt'],
      modified: ['a.txt'],
      deleted: ['dir/b.txt']
    })
  })

  it('round-trips binary files', async () => {
    const content = Buffer.from([0, 1, 2, 255, 0, 42])
    await write('data.bin', content)
    const snapshot = await store.create(workspace)
    await fs.rm(path.join(workspace, 'data.bin'))

    await store.restore(workspace, snapshot.id)

    expect(await fs.readFile(path.join(workspace, 'data.bin'))).toEqual(content)
  })

  it('treats a missing source or target snapshot as an empty side', async () => {
    await write('a.txt', 'one')
    const snapshot = await store.create(workspace)

    expect(await store.diff(null, snapshot.id)).toEqual({
      added: ['a.txt'],
      modified: [],
      deleted: []
    })
    expect(await store.diff(snapshot.id, null)).toEqual({
      added: [],
      modified: [],
      deleted: ['a.txt']
    })
  })
})
