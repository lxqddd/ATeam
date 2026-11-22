import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { WorktreeInfo } from '@ateam/shared'

const execFileAsync = promisify(execFile)
const TIMEOUT_MS = 120_000

export type WorktreeExec = (
  args: string[],
  cwd: string
) => Promise<{ stdout: string; stderr: string }>

export interface WorktreeOptions {
  /** Directory under which ATeam creates and manages worktrees. */
  root: string
  exec?: WorktreeExec
}

async function git(
  args: string[],
  cwd: string,
  exec?: WorktreeExec
): Promise<{ stdout: string; stderr: string }> {
  if (exec) return exec(args, cwd)
  return execFileAsync('git', args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
}

export async function repositoryRoot(workspace: string, exec?: WorktreeExec): Promise<string> {
  try {
    const { stdout } = await git(['rev-parse', '--show-toplevel'], workspace, exec)
    const root = stdout.trim()
    if (!root) throw new Error('empty')
    return root
  } catch {
    throw new Error('NOT_A_GIT_REPOSITORY')
  }
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
}

export function sanitizeWorktreeName(name: string): string {
  return slug(name.replace(/\//g, '-')).slice(0, 80)
}

export function worktreeRootFor(userDataPath: string, repoRoot: string): string {
  const name = slug(path.basename(repoRoot)) || 'workspace'
  const hash = createHash('sha1').update(path.resolve(repoRoot)).digest('hex').slice(0, 8)
  return path.join(userDataPath, 'worktrees', `${name}-${hash}`)
}

function branchName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, '-')
  const cleaned = trimmed
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[-./]+|[-./]+$/g, '')
    .slice(0, 200)
  if (!cleaned || cleaned.includes('..') || cleaned.endsWith('.lock')) {
    throw new Error('INVALID_WORKTREE_NAME')
  }
  return cleaned
}

function parseList(output: string, mainPath: string): WorktreeInfo[] {
  const entries: WorktreeInfo[] = []
  for (const block of output.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((line) => line.trim())
    const worktreeLine = lines.find((line) => line.startsWith('worktree '))
    if (!worktreeLine) continue
    const entry: WorktreeInfo = {
      path: worktreeLine.slice('worktree '.length),
      branch: null,
      head: null,
      main: false,
      detached: false
    }
    for (const line of lines) {
      if (line.startsWith('HEAD ')) entry.head = line.slice(5)
      if (line.startsWith('branch ')) {
        entry.branch = line.slice(7).replace(/^refs\/heads\//, '')
      }
      if (line === 'detached') entry.detached = true
      if (line === 'bare') entry.branch = null
    }
    entries.push(entry)
  }
  entries.forEach((entry, index) => {
    entry.main = index === 0 || entry.path === mainPath
  })
  return entries
}

export async function listWorktrees(
  workspace: string,
  options: { exec?: WorktreeExec } = {}
): Promise<WorktreeInfo[]> {
  await repositoryRoot(workspace, options.exec)
  const { stdout } = await git(['worktree', 'list', '--porcelain'], workspace, options.exec)
  const main = await fs.realpath(workspace).catch(() => path.resolve(workspace))
  return parseList(stdout, main)
}

async function branchExists(
  workspace: string,
  branch: string,
  exec?: WorktreeExec
): Promise<boolean> {
  try {
    await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], workspace, exec)
    return true
  } catch {
    return false
  }
}

export async function createWorktree(
  workspace: string,
  input: { name: string; base?: string | null },
  options: WorktreeOptions
): Promise<WorktreeInfo> {
  const branch = branchName(input.name)
  if (input.base !== undefined && input.base !== null && input.base.trim().startsWith('-')) {
    throw new Error('INVALID_WORKTREE_BASE')
  }
  const repoRoot = await repositoryRoot(workspace, options.exec)
  const slugName = sanitizeWorktreeName(input.name)
  if (!slugName) throw new Error('INVALID_WORKTREE_NAME')
  const directory = path.join(options.root, slugName)

  try {
    await fs.stat(directory)
    throw new Error('WORKTREE_EXISTS')
  } catch (error) {
    if (error instanceof Error && error.message === 'WORKTREE_EXISTS') throw error
  }

  const args = ['worktree', 'add']
  if (await branchExists(repoRoot, branch, options.exec)) {
    args.push(directory, branch)
  } else {
    args.push('-b', branch, directory, input.base?.trim() || 'HEAD')
  }
  await git(args, repoRoot, options.exec)

  const real = await fs.realpath(directory).catch(() => directory)
  return {
    path: real,
    branch,
    head: null,
    main: false,
    detached: false
  }
}

export function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export async function removeWorktree(
  workspace: string,
  target: string,
  options: WorktreeOptions & { force?: boolean }
): Promise<void> {
  const repoRoot = await repositoryRoot(workspace, options.exec)
  const worktrees = await listWorktrees(repoRoot, { exec: options.exec })
  const real = await fs.realpath(target).catch(() => path.resolve(target))
  const entry = worktrees.find((candidate) => {
    const candidatePath = path.resolve(candidate.path)
    return candidatePath === real || candidatePath === path.resolve(target)
  })
  if (!entry) throw new Error('WORKTREE_NOT_FOUND')
  if (entry.main) throw new Error('WORKTREE_MAIN')
  if (!isPathInside(options.root, entry.path)) throw new Error('WORKTREE_OUTSIDE_ROOT')

  const args = ['worktree', 'remove']
  if (options.force) args.push('--force')
  args.push(entry.path)
  await git(args, repoRoot, options.exec)
  await git(['worktree', 'prune'], repoRoot, options.exec).catch(() => undefined)
}
