import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SnapshotStore, referenceSnapshotKey } from './snapshots'

const run = promisify(execFile)

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

    const result = await store.restore(snapshot.id)

    expect(await read('a.txt')).toBe('one')
    expect(await read('dir/b.txt')).toBe('two')
    expect(await exists('c.txt')).toBe(false)
    expect(await read('.git/config')).toBe('changed git')
    expect(result.written.sort()).toEqual(['a.txt', 'dir/b.txt'])
    expect(result.removed).toEqual(['c.txt'])
  })

  it('restores only the requested paths and leaves everything else alone', async () => {
    await write('a.txt', 'one')
    await write('keep.txt', 'keep')
    const snapshot = await store.create(workspace)

    await write('a.txt', 'changed')
    await write('b.txt', 'new')
    await write('outside.txt', 'outside')
    await write('keep.txt', 'keep changed')

    const result = await store.restorePaths(snapshot.id, ['a.txt', 'b.txt'])

    expect(await read('a.txt')).toBe('one')
    expect(await exists('b.txt')).toBe(false)
    expect(await read('outside.txt')).toBe('outside')
    expect(await read('keep.txt')).toBe('keep changed')
    expect(result).toEqual({ written: ['a.txt'], removed: ['b.txt'] })
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

    await store.restore(snapshot.id)

    expect(await fs.readFile(path.join(workspace, 'data.bin'))).toEqual(content)
  })

  it('respects Git ignores and the untracked file size limit', async () => {
    await run('git', ['init'], { cwd: workspace })
    await write('.gitignore', 'ignored.txt\n')
    await write('tracked.txt', 'tracked')
    await write('untracked.txt', 'untracked')
    await write('ignored.txt', 'ignored')
    await write('large-untracked.bin', Buffer.alloc(2 * 1024 * 1024 + 1))
    await write('large-tracked.bin', Buffer.alloc(2 * 1024 * 1024 + 1))
    await run('git', ['add', '.gitignore', 'tracked.txt', 'large-tracked.bin'], {
      cwd: workspace
    })

    const snapshot = await store.create(workspace)

    expect(Object.keys(snapshot.files).sort()).toEqual([
      '.gitignore',
      'large-tracked.bin',
      'tracked.txt',
      'untracked.txt'
    ])
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

  it('fully restores workspace and reference files together', async () => {
    const reference = path.join(directory, 'reference')
    await fs.mkdir(reference, { recursive: true })
    await fs.writeFile(path.join(reference, 'guide.md'), 'first')
    await write('a.txt', 'one')
    const snapshot = await store.create(workspace, 'session-1', [
      { alias: 'docs', root: reference }
    ])

    await write('a.txt', 'two')
    await fs.writeFile(path.join(reference, 'guide.md'), 'second')
    await store.restore(snapshot.id)

    await expect(read('a.txt')).resolves.toBe('one')
    await expect(fs.readFile(path.join(reference, 'guide.md'), 'utf8')).resolves.toBe('first')
  })

  it('refuses to write through a symlink during restore', async () => {
    await write('a.txt', 'one')
    const snapshot = await store.create(workspace)
    const outside = path.join(directory, 'outside.txt')
    await fs.writeFile(outside, 'outside')
    await fs.rm(path.join(workspace, 'a.txt'))
    await fs.symlink(outside, path.join(workspace, 'a.txt'))

    await expect(store.restorePaths(snapshot.id, ['a.txt'])).rejects.toThrow(
      'SNAPSHOT_TARGET_IS_SYMLINK'
    )
    await expect(fs.readFile(outside, 'utf8')).resolves.toBe('outside')
  })

  it('captures and restores files inside references', async () => {
    const reference = path.join(directory, 'reference')
    await fs.mkdir(reference, { recursive: true })
    await fs.writeFile(path.join(reference, 'guide.md'), 'first')
    await write('a.txt', 'one')

    const snapshot = await store.create(workspace, 'session-1', [
      { alias: 'docs', root: reference }
    ])
    expect(snapshot.files[referenceSnapshotKey('docs', 'guide.md')]).toBeTruthy()

    await fs.writeFile(path.join(reference, 'guide.md'), 'second')
    const after = await store.create(workspace, 'session-1', [{ alias: 'docs', root: reference }])
    const diff = await store.diff(snapshot.id, after.id)
    expect(diff.modified).toContain(referenceSnapshotKey('docs', 'guide.md'))

    await store.restorePaths(snapshot.id, [referenceSnapshotKey('docs', 'guide.md')])
    await expect(fs.readFile(path.join(reference, 'guide.md'), 'utf8')).resolves.toBe('first')
  })

  it('restores into the snapshot root even when the caller workspace changed', async () => {
    await write('a.txt', 'one')
    const snapshot = await store.create(workspace)
    await write('a.txt', 'two')
    const other = path.join(directory, 'other')
    await fs.mkdir(other, { recursive: true })
    await fs.writeFile(path.join(other, 'a.txt'), 'other')

    await store.restorePaths(snapshot.id, ['a.txt'])
    await expect(read('a.txt')).resolves.toBe('one')
    await expect(fs.readFile(path.join(other, 'a.txt'), 'utf8')).resolves.toBe('other')
  })

  it('removes a session snapshots and unreferenced blobs', async () => {
    await write('a.txt', 'one')
    const first = await store.create(workspace, 'session-1')
    const oldBlob = first.files['a.txt']
    await write('a.txt', 'two')
    const second = await store.create(workspace, 'session-2')
    const newBlob = second.files['a.txt']

    expect(await store.removeSession('session-1')).toBe(1)

    expect(await store.get(first.id)).toBeNull()
    expect(await store.get(second.id)).not.toBeNull()
    await expect(
      fs.stat(path.join(directory, 'agent', 'snapshots', 'blobs', oldBlob))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(
      await fs.readFile(path.join(directory, 'agent', 'snapshots', 'blobs', newBlob), 'utf8')
    ).toBe('two')
  })
})

describe('SnapshotStore changes', () => {
  it('returns added, modified and deleted files with line hunks', async () => {
    await write('keep.txt', 'same')
    await write('modify.txt', 'one\ntwo\n')
    await write('delete.txt', 'gone')
    const before = await store.create(workspace, 'session-1')

    await write('modify.txt', 'one\nTWO\nthree\n')
    await write('added.txt', 'new\n')
    await fs.rm(path.join(workspace, 'delete.txt'))
    const after = await store.create(workspace, 'session-1')

    const result = await store.changes(before.id, after.id)
    const files = new Map(result.files.map((file) => [file.path, file]))

    expect([...files.keys()].sort()).toEqual(['added.txt', 'delete.txt', 'modify.txt'])
    expect(files.get('added.txt')).toMatchObject({ status: 'added', additions: 1, deletions: 0 })
    expect(files.get('delete.txt')).toMatchObject({ status: 'deleted', additions: 0, deletions: 1 })
    expect(files.get('modify.txt')).toMatchObject({ status: 'modified' })
    expect(files.get('modify.txt')?.hunks.flatMap((hunk) => hunk.lines)).toEqual(
      expect.arrayContaining(['-two', '+TWO', '+three'])
    )
    expect(result.truncated).toBe(false)
  })

  it('compares the latest snapshot against the current workspace when requested', async () => {
    await write('a.txt', 'before')
    const before = await store.create(workspace, 'session-1')
    await write('a.txt', 'agent')
    const after = await store.create(workspace, 'session-1')

    await write('a.txt', 'manual')
    const live = await store.changes(before.id, after.id, { current: true })
    expect(live.files[0]).toMatchObject({ path: 'a.txt', status: 'modified' })
    expect(live.files[0].hunks.flatMap((hunk) => hunk.lines)).toContain('+manual')

    await write('a.txt', 'before')
    const reverted = await store.changes(before.id, after.id, { current: true })
    expect(reverted.files).toEqual([])
  })

  it('ignores files the turn did not change when comparing with the current workspace', async () => {
    await write('agent.txt', 'before')
    await write('manual.txt', 'same')
    const before = await store.create(workspace)
    await write('agent.txt', 'agent')
    const after = await store.create(workspace)
    await write('manual.txt', 'edited outside the turn')

    const live = await store.changes(before.id, after.id, { current: true })

    expect(live.files.map((file) => file.path)).toEqual(['agent.txt'])
  })

  it('does not let unchanged files crowd out changed files', async () => {
    for (let index = 0; index < 205; index += 1) {
      await write(`bulk/${String(index).padStart(3, '0')}.txt`, 'same')
    }
    await write('z-last.txt', 'before')
    const before = await store.create(workspace)
    await write('z-last.txt', 'after')
    const after = await store.create(workspace)

    const result = await store.changes(before.id, after.id)

    expect(result.files.map((file) => file.path)).toEqual(['z-last.txt'])
    expect(result.truncated).toBe(false)
  })

  it('marks binary files without generating a text diff', async () => {
    await write('image.bin', Buffer.from([0, 1, 2]))
    const before = await store.create(workspace)
    await write('image.bin', Buffer.from([0, 3, 4]))
    const after = await store.create(workspace)

    const [file] = (await store.changes(before.id, after.id)).files

    expect(file).toMatchObject({ path: 'image.bin', status: 'modified', binary: true })
    expect(file.hunks).toEqual([])
  })

  it('truncates diffs for very large files', async () => {
    await write('large.txt', 'a'.repeat(600_000))
    const before = await store.create(workspace)
    await write('large.txt', 'b'.repeat(600_000))
    const after = await store.create(workspace)

    const [file] = (await store.changes(before.id, after.id)).files

    expect(file).toMatchObject({ path: 'large.txt', status: 'modified', truncated: true })
    expect(file.hunks).toEqual([])
  })

  it('labels reference files with their alias', async () => {
    const reference = path.join(directory, 'reference')
    await fs.mkdir(reference, { recursive: true })
    await fs.writeFile(path.join(reference, 'guide.md'), 'first')
    const before = await store.create(workspace, 'session-1', [{ alias: 'docs', root: reference }])
    await fs.writeFile(path.join(reference, 'guide.md'), 'second')
    const after = await store.create(workspace, 'session-1', [{ alias: 'docs', root: reference }])

    const [file] = (await store.changes(before.id, after.id)).files

    expect(file).toMatchObject({
      path: '@docs/guide.md',
      snapshotPath: referenceSnapshotKey('docs', 'guide.md'),
      status: 'modified'
    })
  })
})
