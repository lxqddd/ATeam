import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createVcs, type VcsExec } from './vcs'

const execFileAsync = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

async function gitRaw(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

async function initRepo(directory: string, branch = 'main'): Promise<string> {
  await fs.mkdir(directory, { recursive: true })
  await git(directory, 'init', '-b', branch)
  await git(directory, 'config', 'user.email', 'test@example.com')
  await git(directory, 'config', 'user.name', 'Test')
  await fs.writeFile(path.join(directory, 'tracked.txt'), 'one\ntwo\n')
  await fs.writeFile(path.join(directory, 'README.md'), 'hello\n')
  await git(directory, 'add', '.')
  await git(directory, 'commit', '-m', 'init')
  return directory
}

async function commitAll(repo: string, message: string): Promise<void> {
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-m', message)
}

interface FakeOutput {
  numstat?: string
  patch?: string | Error
  status?: string
  branch?: string
  locals?: string
  remotes?: string
}

function fakeExec(output: FakeOutput = {}): VcsExec {
  type ExecOutput = { stdout: string; stderr: string; code: number }
  return async (args) => {
    const [command] = args
    const ok = (stdout: string): ExecOutput => ({ stdout, stderr: '', code: 0 })
    const fail = (): ExecOutput => ({ stdout: '', stderr: '', code: 1 })
    if (command === 'rev-parse' && args.includes('--show-toplevel')) return ok('/repo')
    if (command === 'rev-parse') return ok('deadbeef')
    if (command === 'symbolic-ref') {
      if (args.includes('refs/remotes/origin/HEAD')) {
        return ok(output.remotes ? `origin/${output.remotes}` : '')
      }
      return ok(output.branch ?? 'main')
    }
    if (command === 'for-each-ref') {
      return ok(args.includes('refs/remotes') ? '' : (output.locals ?? 'main'))
    }
    if (command === 'config') return fail()
    if (command === 'status') return ok(output.status ?? '')
    if (command === 'diff' || command === 'show') {
      if (args.includes('--numstat')) return ok(output.numstat ?? '')
      if (output.patch instanceof Error) throw output.patch
      return ok(output.patch ?? '')
    }
    return fail()
  }
}

let directory: string
let repo: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-vcs-')))
  repo = await initRepo(path.join(directory, 'project'))
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('vcs service', () => {
  it('reports a non-repository workspace without throwing', async () => {
    const plain = path.join(directory, 'plain')
    await fs.mkdir(plain)
    const vcs = createVcs(plain)

    await expect(vcs.info()).resolves.toEqual({
      isRepository: false,
      root: null,
      branch: null,
      defaultBranch: null
    })
    await expect(vcs.status()).resolves.toEqual({
      info: { isRepository: false, root: null, branch: null, defaultBranch: null },
      files: [],
      truncated: false
    })
    await expect(vcs.diff()).resolves.toMatchObject({
      isRepository: false,
      mode: 'working',
      base: null,
      files: [],
      truncated: false,
      reason: null
    })
    await expect(vcs.apply('anything')).rejects.toThrow('VCS_NOT_A_REPOSITORY')
  })

  it('reports repository info and a clean status', async () => {
    const vcs = createVcs(repo)
    const info = await vcs.info()
    expect(info).toEqual({
      isRepository: true,
      root: await fs.realpath(repo),
      branch: 'main',
      defaultBranch: 'main'
    })
    await expect(vcs.status()).resolves.toEqual({
      info,
      files: [],
      truncated: false
    })
    const diff = await vcs.diff()
    expect(diff).toMatchObject({ isRepository: true, mode: 'working', base: 'HEAD', files: [] })
  })

  it('maps status letters for untracked, staged, modified and deleted files', async () => {
    await fs.writeFile(path.join(repo, 'new.txt'), 'new\n')
    await fs.writeFile(path.join(repo, 'staged.txt'), 'staged\n')
    await git(repo, 'add', 'staged.txt')
    await fs.writeFile(path.join(repo, 'tracked.txt'), 'changed\n')
    await fs.rm(path.join(repo, 'README.md'))

    const status = await createVcs(repo).status()
    expect(Object.fromEntries(status.files.map((file) => [file.path, file.status]))).toEqual({
      'README.md': 'deleted',
      'new.txt': 'added',
      'staged.txt': 'added',
      'tracked.txt': 'modified'
    })
    expect(status.truncated).toBe(false)
  })

  it('builds working diffs with hunks, untracked synthesis and deletions', async () => {
    await fs.writeFile(path.join(repo, 'new.txt'), 'new\n')
    await fs.writeFile(path.join(repo, 'tracked.txt'), 'one\nchanged\n')
    await fs.rm(path.join(repo, 'README.md'))

    const diff = await createVcs(repo).diff()
    const byPath = Object.fromEntries(diff.files.map((file) => [file.path, file]))

    expect(byPath['tracked.txt']).toMatchObject({
      status: 'modified',
      additions: 1,
      deletions: 1,
      binary: false
    })
    expect(byPath['tracked.txt'].hunks).toHaveLength(1)
    expect(byPath['tracked.txt'].hunks[0].lines).toEqual(
      expect.arrayContaining(['-two', '+changed'])
    )

    expect(byPath['new.txt']).toMatchObject({
      status: 'added',
      additions: 1,
      deletions: 0,
      binary: false
    })
    expect(byPath['new.txt'].hunks[0]).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1 })
    expect(byPath['new.txt'].hunks[0].lines).toEqual(['+new'])

    expect(byPath['README.md']).toMatchObject({
      status: 'deleted',
      additions: 0,
      deletions: 1
    })
    expect(byPath['README.md'].hunks[0].lines).toEqual(['-hello'])
  })

  it('diffs a repository with no commits from the worktree', async () => {
    const empty = path.join(directory, 'empty')
    await fs.mkdir(empty)
    await git(empty, 'init', '-b', 'main')
    await git(empty, 'config', 'user.email', 'test@example.com')
    await git(empty, 'config', 'user.name', 'Test')
    await fs.writeFile(path.join(empty, 'a.txt'), 'first\nsecond\n')

    const diff = await createVcs(empty).diff()
    expect(diff).toMatchObject({ isRepository: true, mode: 'working', base: null })
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toMatchObject({ path: 'a.txt', status: 'added', additions: 2 })
    expect(diff.files[0].hunks[0].lines).toEqual(['+first', '+second'])
  })

  it('diffs a branch against its merge base', async () => {
    await git(repo, 'switch', '-c', 'feature')
    await fs.writeFile(path.join(repo, 'tracked.txt'), 'feature\n')
    await commitAll(repo, 'feature change')
    await fs.writeFile(path.join(repo, 'extra.txt'), 'extra\n')

    const diff = await createVcs(repo).diff({ mode: 'branch' })
    expect(diff.base).toBe(await git(repo, 'merge-base', 'main', 'HEAD'))
    const byPath = Object.fromEntries(diff.files.map((file) => [file.path, file]))
    expect(byPath['tracked.txt']).toMatchObject({ status: 'modified', additions: 1, deletions: 2 })
    expect(byPath['extra.txt']).toMatchObject({ status: 'added', additions: 1 })
    expect(byPath['extra.txt'].hunks[0].lines).toEqual(['+extra'])
  })

  it('requires a base when no default branch exists', async () => {
    const exec = fakeExec({ branch: 'trunk', locals: '', remotes: '' })
    await expect(createVcs('/repo', { exec }).diff({ mode: 'branch' })).rejects.toThrow(
      'VCS_BASE_REQUIRED'
    )

    const solo = await initRepo(path.join(directory, 'solo'), 'trunk')
    const vcs = createVcs(solo)
    await expect(vcs.diff({ mode: 'branch', base: '--force' })).rejects.toThrow('VCS_INVALID_BASE')
    await expect(vcs.diff({ mode: 'branch', base: 'missing' })).rejects.toThrow(
      'VCS_BASE_NOT_FOUND'
    )
  })

  it('diffs the last commit and the root commit', async () => {
    await fs.writeFile(path.join(repo, 'tracked.txt'), 'next\n')
    await commitAll(repo, 'second')

    const diff = await createVcs(repo).diff({ mode: 'committed' })
    expect(diff).toMatchObject({ mode: 'committed', base: 'HEAD~1' })
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toMatchObject({ path: 'tracked.txt', status: 'modified' })

    const root = await initRepo(path.join(directory, 'root'))
    const rootDiff = await createVcs(root).diff({ mode: 'committed' })
    expect(rootDiff.base).toBeNull()
    const rootFiles = Object.fromEntries(rootDiff.files.map((file) => [file.path, file]))
    expect(rootFiles['tracked.txt']).toMatchObject({ status: 'added', additions: 2 })
    expect(rootFiles['README.md']).toMatchObject({ status: 'added', additions: 1 })
  })

  it('marks binary files', async () => {
    await fs.writeFile(path.join(repo, 'logo.bin'), Buffer.from([0, 1, 2, 0]))
    await commitAll(repo, 'binary')
    await fs.writeFile(path.join(repo, 'logo.bin'), Buffer.from([0, 3, 4, 0]))

    const diff = await createVcs(repo).diff()
    const file = diff.files.find((entry) => entry.path === 'logo.bin')
    expect(file).toMatchObject({ status: 'modified', binary: true, hunks: [] })

    await fs.writeFile(path.join(repo, 'untracked.bin'), Buffer.from([0, 9]))
    const withUntracked = await createVcs(repo).diff()
    expect(withUntracked.files.find((entry) => entry.path === 'untracked.bin')).toMatchObject({
      status: 'added',
      binary: true,
      hunks: []
    })
  })

  it('filters diffs by path and rejects paths outside the repository', async () => {
    await fs.mkdir(path.join(repo, 'src'))
    await fs.writeFile(path.join(repo, 'src', 'a.txt'), 'a\n')
    await fs.writeFile(path.join(repo, 'top.txt'), 'top\n')

    const vcs = createVcs(repo)
    const filtered = await vcs.diff({ path: 'src' })
    expect(filtered.files.map((file) => file.path)).toEqual(['src/a.txt'])
    await expect(vcs.diff({ path: '../outside' })).rejects.toThrow('VCS_INVALID_PATH')
    await expect(vcs.diff({ path: path.join(repo, 'src') })).rejects.toThrow('VCS_INVALID_PATH')
  })

  it('applies a patch to the worktree', async () => {
    await fs.writeFile(path.join(repo, 'tracked.txt'), 'one\nchanged\n')
    const patch = await gitRaw(repo, 'diff', '--', 'tracked.txt')
    await git(repo, 'checkout', '--', 'tracked.txt')

    const applied = await createVcs(repo).apply(patch)
    expect(applied.files).toEqual(['tracked.txt'])
    await expect(fs.readFile(path.join(repo, 'tracked.txt'), 'utf8')).resolves.toBe(
      'one\nchanged\n'
    )
  })

  it('rejects invalid patches', async () => {
    const vcs = createVcs(repo)

    await expect(vcs.apply('not a patch')).rejects.toThrow('VCS_EMPTY_PATCH')
    await expect(vcs.apply('x'.repeat(2 * 1024 * 1024 + 1))).rejects.toThrow('VCS_PATCH_TOO_LARGE')
    await expect(
      vcs.apply('diff --git foo.txt foo.txt\n--- foo.txt\n+++ foo.txt\n@@ -1 +1 @@\n-a\n+b\n')
    ).rejects.toThrow('VCS_INVALID_PATCH')
    await expect(
      vcs.apply(
        'diff --git a/../escape.txt b/../escape.txt\n--- a/../escape.txt\n+++ b/../escape.txt\n@@ -0,0 +1 @@\n+escape\n'
      )
    ).rejects.toThrow('VCS_INVALID_PATH')

    const mismatched = [
      'diff --git a/tracked.txt b/tracked.txt',
      '--- a/tracked.txt',
      '+++ b/tracked.txt',
      '@@ -1 +1 @@',
      '-not the actual content',
      '+replacement',
      ''
    ].join('\n')
    await expect(vcs.apply(mismatched)).rejects.toThrow('VCS_APPLY_FAILED')
    await expect(fs.readFile(path.join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('one\ntwo\n')
  })

  it('caps the file list and degrades when git output is too large', async () => {
    const numstat = Array.from({ length: 250 }, (_, index) => `1\t0\tfile-${index}.txt\0`).join('')
    const capped = await createVcs('/repo', { exec: fakeExec({ numstat }) }).diff()
    expect(capped.files).toHaveLength(200)
    expect(capped.truncated).toBe(true)
    expect(capped.reason).toBe('files')

    const degraded = await createVcs('/repo', {
      exec: fakeExec({ numstat: '5\t0\tfile.txt\0', patch: new Error('VCS_OUTPUT_TOO_LARGE') })
    }).diff()
    expect(degraded.truncated).toBe(true)
    expect(degraded.reason).toBe('bytes')
    expect(degraded.files).toHaveLength(1)
    expect(degraded.files[0]).toMatchObject({ path: 'file.txt', additions: 5, truncated: true })
  })
})
