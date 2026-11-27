/**
 * Wire types for the Server API workspace file routes.
 *
 * Every path in these payloads is relative to the session workspace and uses
 * forward slashes so clients on other platforms can pass it back verbatim.
 */

/** File-system entry kind reported by the listing route. */
export type WorkspaceFileType = 'file' | 'directory'

export interface WorkspaceFileEntry {
  /** Path relative to the session workspace. */
  path: string
  /** Final path segment. */
  name: string
  type: WorkspaceFileType
  /** File size in bytes; null for directories. */
  size: number | null
}

export interface WorkspaceFileList {
  sessionId: string
  /** Directory that was listed, relative to the workspace (`''` is the root). */
  path: string
  entries: WorkspaceFileEntry[]
  /** True when the entry limit stopped the walk early. */
  truncated: boolean
}

export interface WorkspaceFileContent {
  sessionId: string
  /** Path relative to the session workspace. */
  path: string
  content: string
  /** Full file size in bytes, even when `content` was truncated. */
  size: number
  /** True when the content was cut at the read byte limit. */
  truncated: boolean
}

export interface WorkspaceFileFindResult {
  sessionId: string
  /** Search root, relative to the workspace (`''` is the root). */
  root: string
  pattern: string
  /** Matching files, relative to the workspace. */
  matches: string[]
  /** True when the result or time limit stopped the search early. */
  truncated: boolean
}

export interface WorkspaceFileMatch {
  /** Matching file, relative to the workspace. */
  path: string
  /** 1-based line number. */
  line: number
  /** Full text of the matching line. */
  text: string
}

export interface WorkspaceFileGrepResult {
  sessionId: string
  /** Search root, relative to the workspace (`''` is the root). */
  root: string
  pattern: string
  matches: WorkspaceFileMatch[]
  /** True when the result or time limit stopped the search early. */
  truncated: boolean
}

/**
 * Hard limits enforced by the Server API file routes. Clients can request
 * smaller values but never larger ones.
 */
export const WORKSPACE_FILE_LIMITS = {
  /** Maximum bytes returned by the read route. */
  readBytes: 512 * 1_024,
  /** Maximum entries returned by the list route. */
  listEntries: 2_000,
  /** Maximum matches returned by the find and grep routes. */
  searchResults: 500,
  /** Maximum directory depth the list route will recurse into. */
  listDepth: 8,
  /** Files larger than this are skipped by the grep route. */
  grepFileBytes: 1_000_000,
  /** Wall-clock budget for one find or grep request. */
  searchMs: 10_000
} as const
