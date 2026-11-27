import type { FileChangeStatus, FileDiffHunk } from './agent-types'

/** Which baseline a Git diff is compared against. */
export type VcsDiffMode = 'working' | 'branch' | 'committed'

/** Why a Git diff result was cut short. */
export type VcsDiffReason = 'files' | 'bytes'

export interface VcsInfo {
  isRepository: boolean
  /** Absolute repository root, or null when the workspace is not a Git repository. */
  root: string | null
  /** Current branch; null when HEAD is detached. */
  branch: string | null
  /** Default branch inferred from the remote or local configuration. */
  defaultBranch: string | null
  /** `remote.origin.url` with userinfo stripped; null when it is not set. */
  remoteUrl: string | null
}

export interface VcsStatusFile {
  path: string
  status: FileChangeStatus
}

export interface VcsStatus {
  info: VcsInfo
  files: VcsStatusFile[]
  truncated: boolean
}

export interface VcsFileDiff {
  path: string
  status: FileChangeStatus
  binary: boolean
  truncated: boolean
  additions: number
  deletions: number
  hunks: FileDiffHunk[]
}

export interface VcsDiffOptions {
  /** Defaults to `working`. */
  mode?: VcsDiffMode
  /** Explicit base revision for `branch` mode; defaults to the default branch. */
  base?: string
  /** Repository-relative path filter. */
  path?: string
}

export interface VcsDiffResult {
  isRepository: boolean
  mode: VcsDiffMode
  /** Revision the diff was compared against; null when there is nothing to compare. */
  base: string | null
  files: VcsFileDiff[]
  truncated: boolean
  reason: VcsDiffReason | null
}
