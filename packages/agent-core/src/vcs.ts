import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type {
  FileChangeStatus,
  FileDiffHunk,
  VcsDiffMode,
  VcsDiffOptions,
  VcsDiffReason,
  VcsDiffResult,
  VcsFileDiff,
  VcsInfo,
  VcsStatus,
  VcsStatusFile
} from '@ateam/shared'
import { parsePatch } from 'diff'
import { isPathInside } from './worktrees'

/** Runs git and resolves with the exit code instead of rejecting on failure. */
export type VcsExec = (
  args: string[],
  cwd: string,
  stdin?: string
) => Promise<{ stdout: string; stderr: string; code: number }>

export interface VcsOptions {
  exec?: VcsExec
  timeoutMs?: number
}

export interface VcsService {
  info(): Promise<VcsInfo>
  status(): Promise<VcsStatus>
  diff(options?: VcsDiffOptions): Promise<VcsDiffResult>
  apply(patch: string): Promise<{ files: string[] }>
}

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_STATUS_FILES = 200
const MAX_DIFF_FILES = 200
const MAX_FILE_TEXT_BYTES = 512 * 1024
const MAX_FILE_TEXT_LINES = 5_000
const MAX_DIFF_TEXT_BYTES = 5 * 1024 * 1024
const MAX_UNTRACKED_FILES = 50
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024
const MAX_APPLY_BYTES = 2 * 1024 * 1024
const BINARY_SNIFF_BYTES = 8_000
const GIT_GLOBAL_ARGS = ['-c', 'core.quotepath=false']

const DIFF_FLAGS = ['diff', '--no-color', '--no-ext-diff', '--no-renames', '--unified=3']
const NUMSTAT_FLAGS = ['diff', '--numstat', '-z', '--no-renames']
const SHOW_FLAGS = [
  'show',
  '--format=',
  '--no-color',
  '--no-ext-diff',
  '--no-renames',
  '--unified=3'
]
const SHOW_NUMSTAT_FLAGS = ['show', '--format=', '--numstat', '-z', '--no-renames']

function defaultExec(timeoutMs: number): VcsExec {
  return (args, cwd, stdin) =>
    new Promise((resolve, reject) => {
      const child = spawn('git', [...GIT_GLOBAL_ARGS, ...args], {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const outDecoder = new StringDecoder('utf8')
      const errDecoder = new StringDecoder('utf8')
      let stdout = ''
      let stderr = ''
      let outputBytes = 0
      let settled = false
      let timer: NodeJS.Timeout | null = null
      const finish = (error: Error | null, code: number): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        stdout += outDecoder.end()
        stderr += errDecoder.end()
        if (error) reject(error)
        else resolve({ stdout, stderr, code })
      }
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(new Error('VCS_TIMEOUT'), -1)
      }, timeoutMs)
      const collect = (chunk: Buffer, target: 'stdout' | 'stderr'): void => {
        outputBytes += chunk.byteLength
        if (target === 'stdout') stdout += outDecoder.write(chunk)
        else stderr += errDecoder.write(chunk)
        if (outputBytes > MAX_OUTPUT_BYTES) {
          child.kill('SIGKILL')
          finish(new Error('VCS_OUTPUT_TOO_LARGE'), -1)
        }
      }
      child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout'))
      child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'))
      child.on('error', () => finish(new Error('VCS_GIT_UNAVAILABLE'), -1))
      child.on('close', (code) => finish(null, code ?? -1))
      child.stdin.on('error', () => undefined)
      child.stdin.end(stdin ?? '')
    })
}

interface StatusEntry {
  path: string
  status: FileChangeStatus
  untracked: boolean
}

interface NumstatEntry {
  additions: number
  deletions: number
  binary: boolean
}

interface ParsedDiff {
  hunks: FileDiffHunk[]
  oldPath: string | null
  newPath: string | null
}

function mapStatus(x: string, y: string): FileChangeStatus {
  if (x === '?' && y === '?') return 'added'
  const primary = y !== ' ' && y !== '?' ? y : x
  if (primary === 'A' || primary === '?') return 'added'
  if (primary === 'D') return 'deleted'
  return 'modified'
}

function parseStatus(output: string): StatusEntry[] {
  const entries: StatusEntry[] = []
  for (const chunk of output.split('\0')) {
    if (chunk.length < 4) continue
    const x = chunk[0]
    const y = chunk[1]
    const filePath = chunk.slice(3)
    if (!filePath) continue
    entries.push({ path: filePath, status: mapStatus(x, y), untracked: x === '?' && y === '?' })
  }
  return entries
}

function parseNumstat(output: string): Map<string, NumstatEntry> {
  const entries = new Map<string, NumstatEntry>()
  for (const chunk of output.split('\0')) {
    const first = chunk.indexOf('\t')
    if (first === -1) continue
    const second = chunk.indexOf('\t', first + 1)
    if (second === -1) continue
    const additions = chunk.slice(0, first)
    const deletions = chunk.slice(first + 1, second)
    const filePath = chunk.slice(second + 1)
    if (!filePath) continue
    const binary = additions === '-' || deletions === '-'
    entries.set(filePath, {
      additions: binary ? 0 : Number.parseInt(additions, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(deletions, 10) || 0,
      binary
    })
  }
  return entries
}

function stripGitPrefix(value: string | null | undefined): string | null {
  if (!value || value === '/dev/null') return null
  if (value.startsWith('a/') || value.startsWith('b/')) return value.slice(2)
  return value
}

function parseDiff(output: string): Map<string, ParsedDiff> {
  const files = new Map<string, ParsedDiff>()
  for (const parsed of parsePatch(output)) {
    const oldPath = stripGitPrefix(parsed.oldFileName)
    const newPath = stripGitPrefix(parsed.newFileName)
    const filePath = newPath ?? oldPath
    if (!filePath) continue
    files.set(filePath, {
      oldPath,
      newPath,
      hunks: parsed.hunks.map((hunk) => ({
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        lines: [...hunk.lines]
      }))
    })
  }
  return files
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)
}

function firstLine(value: string): string {
  return value.trim().split('\n')[0] ?? ''
}

function normalizeFilter(repoRoot: string, value?: string): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (path.isAbsolute(trimmed)) throw new Error('VCS_INVALID_PATH')
  const absolute = path.resolve(repoRoot, trimmed)
  if (absolute === repoRoot) return null
  if (!isPathInside(repoRoot, absolute)) throw new Error('VCS_INVALID_PATH')
  return path.relative(repoRoot, absolute).split(path.sep).join('/')
}

export function createVcs(root: string, options: VcsOptions = {}): VcsService {
  const workspace = path.resolve(root)
  const exec = options.exec ?? defaultExec(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  async function git(
    args: string[],
    cwd: string,
    stdin?: string
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return exec(args, cwd, stdin)
  }

  async function repositoryRoot(): Promise<string | null> {
    const result = await git(['rev-parse', '--show-toplevel'], workspace)
    const value = result.stdout.trim()
    if (result.code !== 0 || !value) return null
    return path.resolve(value)
  }

  async function currentBranch(repoRoot: string): Promise<string | null> {
    const result = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot)
    const value = result.stdout.trim()
    return result.code === 0 && value ? value : null
  }

  async function defaultBranch(repoRoot: string): Promise<string | null> {
    const origin = await git(
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      repoRoot
    )
    const originValue = origin.stdout.trim()
    if (origin.code === 0 && originValue) return originValue.replace(/^origin\//, '')

    const remoteHeads = await git(['for-each-ref', '--format=%(refname)', 'refs/remotes'], repoRoot)
    if (remoteHeads.code === 0) {
      for (const ref of remoteHeads.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)) {
        if (!ref.endsWith('/HEAD')) continue
        const target = await git(['symbolic-ref', '--quiet', '--short', ref], repoRoot)
        const value = target.stdout.trim()
        if (target.code === 0 && value) return value.replace(/^[^/]+\//, '')
      }
    }

    const configured = await git(['config', '--get', 'init.defaultBranch'], repoRoot)
    const configuredValue = configured.stdout.trim()
    if (configured.code === 0 && configuredValue) return configuredValue

    const locals = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], repoRoot)
    if (locals.code === 0) {
      const names = locals.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (names.includes('main')) return 'main'
      if (names.includes('master')) return 'master'
    }
    return null
  }

  async function infoFor(repoRoot: string): Promise<VcsInfo> {
    return {
      isRepository: true,
      root: repoRoot,
      branch: await currentBranch(repoRoot),
      defaultBranch: await defaultBranch(repoRoot)
    }
  }

  async function readStatus(repoRoot: string): Promise<StatusEntry[]> {
    const result = await git(
      ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'],
      repoRoot
    )
    if (result.code !== 0) {
      throw new Error(`VCS_STATUS_FAILED: ${firstLine(result.stderr)}`)
    }
    return parseStatus(result.stdout)
  }

  return {
    async info(): Promise<VcsInfo> {
      const repoRoot = await repositoryRoot()
      if (!repoRoot) return { isRepository: false, root: null, branch: null, defaultBranch: null }
      return infoFor(repoRoot)
    },

    async status(): Promise<VcsStatus> {
      const repoRoot = await repositoryRoot()
      if (!repoRoot) {
        return {
          info: { isRepository: false, root: null, branch: null, defaultBranch: null },
          files: [],
          truncated: false
        }
      }
      const entries = await readStatus(repoRoot)
      const files: VcsStatusFile[] = entries
        .slice(0, MAX_STATUS_FILES)
        .map((entry) => ({ path: entry.path, status: entry.status }))
      return {
        info: await infoFor(repoRoot),
        files,
        truncated: entries.length > MAX_STATUS_FILES
      }
    },

    async diff(diffOptions: VcsDiffOptions = {}): Promise<VcsDiffResult> {
      const mode: VcsDiffMode = diffOptions.mode ?? 'working'
      const repoRoot = await repositoryRoot()
      if (!repoRoot) {
        return {
          isRepository: false,
          mode,
          base: null,
          files: [],
          truncated: false,
          reason: null
        }
      }

      const info = mode === 'branch' ? await infoFor(repoRoot) : null
      const filter = normalizeFilter(repoRoot, diffOptions.path)
      const statusEntries = mode === 'committed' ? [] : await readStatus(repoRoot)
      const statusMap = new Map(statusEntries.map((entry) => [entry.path, entry]))
      const matchesFilter = (filePath: string): boolean =>
        !filter || filePath === filter || filePath.startsWith(`${filter}/`)

      const hasHead = (await git(['rev-parse', '--verify', '--quiet', 'HEAD'], repoRoot)).code === 0
      let base: string | null = null
      let patchArgs: string[] | null = null
      let numstatArgs: string[] | null = null

      if (mode === 'working') {
        if (hasHead) {
          base = 'HEAD'
          patchArgs = [...DIFF_FLAGS, 'HEAD']
          numstatArgs = [...NUMSTAT_FLAGS, 'HEAD']
        }
      } else if (mode === 'branch') {
        const requested = diffOptions.base?.trim()
        if (requested?.startsWith('-')) throw new Error('VCS_INVALID_BASE')
        const baseName = requested || info?.defaultBranch
        if (!baseName || !hasHead) throw new Error('VCS_BASE_REQUIRED')
        const mergeBase = await git(['merge-base', baseName, 'HEAD'], repoRoot)
        const mergeBaseValue = mergeBase.stdout.trim()
        if (mergeBase.code !== 0 || !mergeBaseValue) throw new Error('VCS_BASE_NOT_FOUND')
        base = mergeBaseValue
        patchArgs = [...DIFF_FLAGS, mergeBaseValue]
        numstatArgs = [...NUMSTAT_FLAGS, mergeBaseValue]
      } else if (hasHead) {
        const parent = await git(['rev-parse', '--verify', '--quiet', 'HEAD~1'], repoRoot)
        if (parent.code === 0) {
          base = 'HEAD~1'
          patchArgs = [...DIFF_FLAGS, 'HEAD~1', 'HEAD']
          numstatArgs = [...NUMSTAT_FLAGS, 'HEAD~1', 'HEAD']
        } else {
          patchArgs = [...SHOW_FLAGS, 'HEAD']
          numstatArgs = [...SHOW_NUMSTAT_FLAGS, 'HEAD']
        }
      }

      const withPath = (args: string[]): string[] => (filter ? [...args, '--', filter] : args)
      let truncated = false
      let reason: VcsDiffReason | null = null
      let textBytes = 0

      const numstat = new Map<string, NumstatEntry>()
      if (numstatArgs) {
        const result = await git(withPath(numstatArgs), repoRoot)
        if (result.code !== 0) {
          throw new Error(`VCS_DIFF_FAILED: ${firstLine(result.stderr)}`)
        }
        for (const [filePath, entry] of parseNumstat(result.stdout)) numstat.set(filePath, entry)
      }

      let parsed = new Map<string, ParsedDiff>()
      if (patchArgs) {
        try {
          const result = await git(withPath(patchArgs), repoRoot)
          if (result.code !== 0) {
            throw new Error(`VCS_DIFF_FAILED: ${firstLine(result.stderr)}`)
          }
          parsed = parseDiff(result.stdout)
        } catch (error) {
          if (error instanceof Error && error.message === 'VCS_OUTPUT_TOO_LARGE') {
            truncated = true
            reason = 'bytes'
          } else {
            throw error
          }
        }
      }

      const files: VcsFileDiff[] = []

      const attachHunks = (file: VcsFileDiff, hunks: FileDiffHunk[]): VcsFileDiff => {
        if (hunks.length === 0) return file
        const lines = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0)
        const bytes = hunks.reduce(
          (sum, hunk) => sum + hunk.lines.reduce((size, line) => size + line.length + 1, 0),
          0
        )
        const overFileLimit = lines > MAX_FILE_TEXT_LINES || bytes > MAX_FILE_TEXT_BYTES
        const overTotalLimit = textBytes + bytes > MAX_DIFF_TEXT_BYTES
        if (overFileLimit || overTotalLimit) {
          file.truncated = true
          if (overTotalLimit) {
            truncated = true
            reason ??= 'bytes'
          }
          return file
        }
        textBytes += bytes
        file.hunks = hunks
        return file
      }

      const addTracked = (filePath: string): void => {
        if (files.length >= MAX_DIFF_FILES) {
          truncated = true
          reason ??= 'files'
          return
        }
        const stats = numstat.get(filePath)
        const status = statusMap.get(filePath)?.status
        const entry = parsed.get(filePath)
        const file: VcsFileDiff = {
          path: filePath,
          status:
            status ??
            (entry && !entry.oldPath && entry.newPath
              ? 'added'
              : entry && entry.oldPath && !entry.newPath
                ? 'deleted'
                : 'modified'),
          binary: stats?.binary ?? false,
          truncated: false,
          additions: stats?.additions ?? 0,
          deletions: stats?.deletions ?? 0,
          hunks: []
        }
        if (reason === 'bytes') file.truncated = true
        if (!file.binary && entry) attachHunks(file, entry.hunks)
        files.push(file)
      }

      const addUntracked = async (filePath: string): Promise<void> => {
        if (files.length >= MAX_DIFF_FILES) {
          truncated = true
          reason ??= 'files'
          return
        }
        const file: VcsFileDiff = {
          path: filePath,
          status: 'added',
          binary: false,
          truncated: false,
          additions: 0,
          deletions: 0,
          hunks: []
        }
        const absolute = path.join(repoRoot, filePath)
        const stat = await fs.lstat(absolute).catch(() => null)
        if (!stat?.isFile()) {
          files.push(file)
          return
        }
        if (stat.size > MAX_UNTRACKED_BYTES) {
          files.push({ ...file, truncated: true })
          return
        }
        const buffer = await fs.readFile(absolute).catch(() => null)
        if (!buffer) {
          files.push(file)
          return
        }
        if (isBinaryBuffer(buffer)) {
          files.push({ ...file, binary: true })
          return
        }
        const text = buffer.toString('utf8')
        if (text.length === 0) {
          files.push(file)
          return
        }
        const lines = text.split('\n')
        if (lines[lines.length - 1] === '') lines.pop()
        const hunks: FileDiffHunk[] = [
          {
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: lines.length,
            lines: lines.map((line) => `+${line}`)
          }
        ]
        const withHunks = attachHunks({ ...file, additions: lines.length }, hunks)
        files.push(withHunks)
      }

      if (!hasHead && mode !== 'committed') {
        // No HEAD yet: every tracked or untracked file is new relative to the empty repository.
        for (const entry of statusEntries) {
          if (!matchesFilter(entry.path)) continue
          if (files.length >= MAX_DIFF_FILES) {
            truncated = true
            reason ??= 'files'
            break
          }
          if (entry.status === 'added') {
            await addUntracked(entry.path)
          } else {
            files.push({
              path: entry.path,
              status: entry.status,
              binary: false,
              truncated: false,
              additions: 0,
              deletions: 0,
              hunks: []
            })
          }
        }
      } else {
        for (const filePath of numstat.keys()) addTracked(filePath)
        if (mode !== 'committed') {
          let untrackedCount = 0
          for (const entry of statusEntries) {
            if (!entry.untracked || !matchesFilter(entry.path)) continue
            if (untrackedCount >= MAX_UNTRACKED_FILES) {
              truncated = true
              reason ??= 'files'
              break
            }
            untrackedCount += 1
            await addUntracked(entry.path)
          }
        }
      }

      return { isRepository: true, mode, base, files, truncated, reason }
    },

    async apply(patch: string): Promise<{ files: string[] }> {
      const repoRoot = await repositoryRoot()
      if (!repoRoot) throw new Error('VCS_NOT_A_REPOSITORY')
      if (Buffer.byteLength(patch, 'utf8') > MAX_APPLY_BYTES) {
        throw new Error('VCS_PATCH_TOO_LARGE')
      }
      const files = new Set<string>()
      for (const parsed of parsePatch(patch)) {
        for (const name of [parsed.oldFileName, parsed.newFileName]) {
          if (!name || name === '/dev/null') continue
          if (!name.startsWith('a/') && !name.startsWith('b/')) {
            throw new Error('VCS_INVALID_PATCH')
          }
          files.add(name.slice(2))
        }
      }
      if (files.size === 0) throw new Error('VCS_EMPTY_PATCH')
      for (const filePath of files) {
        if (
          !filePath ||
          path.isAbsolute(filePath) ||
          filePath.split('/').includes('..') ||
          !isPathInside(repoRoot, path.resolve(repoRoot, filePath))
        ) {
          throw new Error('VCS_INVALID_PATH')
        }
      }
      const check = await git(['apply', '--check', '-'], repoRoot, patch)
      if (check.code !== 0) {
        throw new Error(`VCS_APPLY_FAILED: ${firstLine(check.stderr)}`)
      }
      const applied = await git(['apply', '-'], repoRoot, patch)
      if (applied.code !== 0) {
        throw new Error(`VCS_APPLY_FAILED: ${firstLine(applied.stderr)}`)
      }
      return { files: [...files] }
    }
  }
}
