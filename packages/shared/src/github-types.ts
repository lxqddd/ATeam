/** GitHub repository reference in `owner/repo` form. */
export interface GitHubRepoRef {
  owner: string
  repo: string
}

/** Kind of GitHub item a session can be started from. */
export type GitHubItemKind = 'issue' | 'pull'

/** A single issue or pull request inside a repository. */
export interface GitHubItemRef extends GitHubRepoRef {
  kind: GitHubItemKind
  number: number
}

/** Where the active GitHub token comes from. */
export type GitHubTokenSource = 'store' | 'env' | 'none'

/** Public token state; never carries the token itself. */
export interface GitHubTokenStatus {
  hasToken: boolean
  source: GitHubTokenSource
  /** Authenticated login when it has been verified against the API. */
  login: string | null
  /** ISO timestamp of the last save; null for tokens read from the environment. */
  updatedAt: string | null
}

/** Repository detected from a workspace, with the remote used to find it. */
export interface GitHubRepoInfo extends GitHubRepoRef {
  /** Remote URL with userinfo stripped; null when the workspace has no GitHub remote. */
  remoteUrl: string | null
  branch: string | null
  defaultBranch: string | null
}

/** List entry for an open issue or pull request. */
export interface GitHubItemSummary extends GitHubItemRef {
  title: string
  url: string
  state: string
  author: string
  labels: string[]
  comments: number
  updatedAt: string
  /** Pull requests only. */
  draft?: boolean
  /** Pull requests only. */
  merged?: boolean
}

/** One changed file in a pull request. */
export interface GitHubPullFile {
  filename: string
  status: string
  additions: number
  deletions: number
}

/** Change summary attached to a pull request context. */
export interface GitHubPullSummary {
  number: number
  title: string
  state: string
  draft: boolean
  merged: boolean
  baseBranch: string
  headBranch: string
  additions: number
  deletions: number
  changedFiles: number
  commits: number
  files: GitHubPullFile[]
  filesTruncated: boolean
}

/** Full context injected into the first message of an imported session. */
export interface GitHubItemContext extends GitHubItemSummary {
  body: string
  bodyTruncated: boolean
  pull: GitHubPullSummary | null
}

export interface GitHubContextResult {
  context: GitHubItemContext
  /** Markdown block ready to prefill the composer. */
  prompt: string
}

export interface GitHubCommentInput {
  /** Issue/PR URL, `owner/repo#123`, or `owner/repo` + number form. */
  ref: string
  body: string
}

export interface GitHubCommentResult {
  url: string
}

export interface GitHubCreatePullInput {
  /** Repository in `owner/repo` form. */
  repo: string
  title: string
  body: string
  base: string
  head: string
  draft: boolean
}

export interface GitHubCreatePullResult {
  number: number
  url: string
}
