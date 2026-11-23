import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  sanitizeWorktreeName,
  worktreeRootFor
} from './worktrees'

const execFileAsync = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

let directory: string
let repo: string
let root: string

beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-worktree-')))
  repo = path.join(directory, 'project')
  root = worktreeRootFor(directory, repo)
  await fs.mkdir(repo, { recursive: true })
  await git(repo, 'init', '-b', 'main')
  await git(repo, 'config', 'user.email', 'test@example.com')
  await git(repo, 'config', 'user.name', 'Test')
  await fs.writeFile(path.join(repo, 'README.md'), 'hello')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-m', 'init')
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('worktrees', () => {
  it('lists the main worktree', async () => {
    const worktrees = await listWorktrees(repo)
    expect(worktrees).toHaveLength(1)
    expect(worktrees[0]).toMatchObject({ branch: 'main', main: true })
    expect(worktrees[0].path).toBe(await fs.realpath(repo))
  })

  it('creates and removes a managed worktree', async () => {
    const created = await createWorktree(repo, { name: 'feature/login' }, { root })
    expect(created).toMatchObject({ branch: 'feature/login', main: false })
    expect(created.path).toBe(path.join(root, 'feature-login'))
    await expect(fs.readFile(path.join(created.path, 'README.md'), 'utf8')).resolves.toBe('hello')

    const listed = await listWorktrees(repo)
    expect(listed.map((entry) => entry.branch)).toEqual(['main', 'feature/login'])

    await removeWorktree(repo, created.path, { root })
    await expect(fs.stat(created.path)).rejects.toThrow()
    expect(await listWorktrees(repo)).toHaveLength(1)
  })

  it('reuses an existing branch and bases on a requested ref', async () => {
    await git(repo, 'branch', 'release')
    const created = await createWorktree(repo, { name: 'release' }, { root })
    expect(created.branch).toBe('release')

    await git(repo, 'branch', 'topic')
    await fs.writeFile(path.join(repo, 'next.txt'), 'next')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-m', 'next')
    const based = await createWorktree(repo, { name: 'topic-2', base: 'HEAD~1' }, { root })
    expect(based.branch).toBe('topic-2')
    await expect(fs.stat(path.join(based.path, 'next.txt'))).rejects.toThrow()
  })

  it('refuses to remove the main worktree or paths outside the managed root', async () => {
    await expect(removeWorktree(repo, repo, { root })).rejects.toThrow('WORKTREE_MAIN')

    const created = await createWorktree(repo, { name: 'outside' }, { root })
    const otherRoot = path.join(directory, 'other')
    await expect(removeWorktree(repo, created.path, { root: otherRoot })).rejects.toThrow(
      'WORKTREE_OUTSIDE_ROOT'
    )
  })

  it('requires force to discard uncommitted changes', async () => {
    const created = await createWorktree(repo, { name: 'dirty' }, { root })
    await fs.writeFile(path.join(created.path, 'draft.txt'), 'draft')
    await expect(removeWorktree(repo, created.path, { root })).rejects.toThrow()
    await removeWorktree(repo, created.path, { root, force: true })
    await expect(fs.stat(created.path)).rejects.toThrow()
  })

  it('reports a clear error outside a git repository and rejects bad names', async () => {
    const plain = path.join(directory, 'plain')
    await fs.mkdir(plain)
    await expect(listWorktrees(plain)).rejects.toThrow('NOT_A_GIT_REPOSITORY')
    await expect(createWorktree(plain, { name: 'x' }, { root })).rejects.toThrow(
      'NOT_A_GIT_REPOSITORY'
    )
    await expect(createWorktree(repo, { name: '   ' }, { root })).rejects.toThrow(
      'INVALID_WORKTREE_NAME'
    )
  })

  it('rejects option-like base revisions', async () => {
    await expect(
      createWorktree(repo, { name: 'injected', base: '--force' }, { root })
    ).rejects.toThrow('INVALID_WORKTREE_BASE')
    await expect(createWorktree(repo, { name: 'injected', base: '-b' }, { root })).rejects.toThrow(
      'INVALID_WORKTREE_BASE'
    )
  })

  it('keeps managed roots separate for same-named repositories', () => {
    const first = worktreeRootFor(directory, path.join(directory, 'one', 'project'))
    const second = worktreeRootFor(directory, path.join(directory, 'two', 'project'))
    expect(first).not.toBe(second)
  })

  it('sanitizes names into branch-safe slugs', () => {
    expect(sanitizeWorktreeName('Feature Login')).toBe('Feature-Login')
    expect(sanitizeWorktreeName('feature/login')).toBe('feature-login')
    expect(sanitizeWorktreeName('../../etc/passwd')).toBe('etc-passwd')
    expect(sanitizeWorktreeName('***')).toBe('')
    expect(sanitizeWorktreeName('a'.repeat(120))).toHaveLength(80)
  })
})
