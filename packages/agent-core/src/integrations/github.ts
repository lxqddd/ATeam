import { z } from 'zod'
import type {
  GitHubCommentResult,
  GitHubCreatePullInput,
  GitHubCreatePullResult,
  GitHubItemContext,
  GitHubItemKind,
  GitHubItemRef,
  GitHubItemSummary,
  GitHubPullFile,
  GitHubPullSummary,
  GitHubRepoRef
} from '@ateam/shared'

const DEFAULT_API_BASE_URL = 'https://api.github.com'
const DEFAULT_USER_AGENT = 'ATeam'
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_BODY_CHARS = 20_000
const MAX_FILES = 50
const MAX_LIST_ITEMS = 30
const MAX_ERROR_DETAIL_CHARS = 200

export type GitHubErrorCode =
  | 'GITHUB_TOKEN_MISSING'
  | 'GITHUB_UNAUTHORIZED'
  | 'GITHUB_FORBIDDEN'
  | 'GITHUB_RATE_LIMITED'
  | 'GITHUB_NOT_FOUND'
  | 'GITHUB_UNPROCESSABLE'
  | 'GITHUB_API_ERROR'
  | 'GITHUB_NETWORK_ERROR'
  | 'GITHUB_INVALID_RESPONSE'
  | 'GITHUB_INVALID_REF'

/** Error carrying a stable code that the UI and CLI translate into a message. */
export class GitHubError extends Error {
  readonly code: GitHubErrorCode
  readonly status: number | null

  constructor(code: GitHubErrorCode, message: string, status: number | null = null) {
    // Electron IPC drops custom error properties; keep the code readable in the message.
    super(`${code}: ${message}`)
    this.name = 'GitHubError'
    this.code = code
    this.status = status
  }
}

const UserSchema = z.object({ login: z.string() })
const LabelSchema = z.union([z.object({ name: z.string() }), z.string()])
const IssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  state: z.string(),
  user: UserSchema.nullable().optional(),
  labels: z.array(LabelSchema).optional(),
  comments: z.number().optional(),
  updated_at: z.string().optional(),
  body: z.string().nullable().optional(),
  pull_request: z.unknown().optional()
})
const PullSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  state: z.string(),
  user: UserSchema.nullable().optional(),
  labels: z.array(LabelSchema).optional(),
  comments: z.number().optional(),
  updated_at: z.string().optional(),
  body: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  merged: z.boolean().optional(),
  base: z.object({ ref: z.string() }),
  head: z.object({ ref: z.string() }),
  additions: z.number().optional(),
  deletions: z.number().optional(),
  changed_files: z.number().optional(),
  commits: z.number().optional()
})
const PullFileSchema = z.object({
  filename: z.string(),
  status: z.string().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional()
})
const ViewerSchema = z.object({ login: z.string() })
const CommentSchema = z.object({ html_url: z.string() })
const CreatedPullSchema = z.object({ number: z.number(), html_url: z.string() })

export interface GitHubIssue {
  number: number
  title: string
  url: string
  state: string
  author: string
  labels: string[]
  comments: number
  updatedAt: string
  body: string
  isPullRequest: boolean
}

export interface GitHubPull {
  number: number
  title: string
  url: string
  state: string
  author: string
  labels: string[]
  comments: number
  updatedAt: string
  body: string
  draft: boolean
  merged: boolean
  baseBranch: string
  headBranch: string
  additions: number
  deletions: number
  changedFiles: number
  commits: number
}

export interface GitHubClient {
  getViewer(): Promise<{ login: string }>
  getIssue(repo: GitHubRepoRef, number: number): Promise<GitHubIssue>
  getPull(repo: GitHubRepoRef, number: number): Promise<GitHubPull>
  getPullFiles(repo: GitHubRepoRef, number: number): Promise<GitHubPullFile[]>
  listOpenItems(repo: GitHubRepoRef, kind: GitHubItemKind): Promise<GitHubItemSummary[]>
  createComment(repo: GitHubRepoRef, number: number, body: string): Promise<GitHubCommentResult>
  createPull(input: GitHubCreatePullInput): Promise<GitHubCreatePullResult>
}

export interface GitHubClientOptions {
  token?: string | null
  apiBaseUrl?: string
  userAgent?: string
  fetch?: typeof fetch
  timeoutMs?: number
}

function labelNames(labels: Array<{ name: string } | string> | undefined): string[] {
  return (labels ?? [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter((name) => name.length > 0)
}

function requireNumber(value: number): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new GitHubError('GITHUB_INVALID_REF', 'Invalid GitHub issue or pull request number')
  return value
}

function repoPath(repo: GitHubRepoRef): string {
  return `${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`
}

/**
 * Parses `owner/repo`, with an optional GitHub URL prefix or `.git` suffix.
 * Returns null for anything that is not a GitHub repository reference.
 */
export function parseGitHubRepo(value: string): GitHubRepoRef | null {
  const cleaned = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(cleaned)
  if (!match) return null
  const [, owner, repo] = match
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null
  return { owner, repo }
}

/**
 * Parses an issue/PR URL, `owner/repo#123`, or `owner/repo/issues|pull/123`.
 * `kind` supplies the kind for the ambiguous `#123` form.
 */
export function parseGitHubItemRef(
  value: string,
  kind: GitHubItemKind = 'issue'
): GitHubItemRef | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const urlMatch =
    /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/(\d+)(?:[/?#].*)?$/i.exec(
      trimmed
    )
  if (urlMatch) {
    const [, owner, repo, segment, number] = urlMatch
    return {
      owner,
      repo,
      kind: segment.toLowerCase() === 'pull' ? 'pull' : 'issue',
      number: Number.parseInt(number, 10)
    }
  }

  const shortMatch = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(trimmed)
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      kind,
      number: Number.parseInt(shortMatch[3], 10)
    }
  }

  const pathMatch = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/(\d+)$/i.exec(trimmed)
  if (pathMatch) {
    return {
      owner: pathMatch[1],
      repo: pathMatch[2],
      kind: pathMatch[3].toLowerCase() === 'pull' ? 'pull' : 'issue',
      number: Number.parseInt(pathMatch[4], 10)
    }
  }

  return null
}

/** Parses an `origin` remote (https, ssh or git protocol) into a GitHub repo. */
export function parseGitHubRemote(remoteUrl: string): GitHubRepoRef | null {
  const trimmed = remoteUrl.trim()
  if (!trimmed) return null

  const httpsMatch =
    /^https?:\/\/(?:[^@/]+@)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(
      trimmed
    )
  if (httpsMatch) return parseGitHubRepo(`${httpsMatch[1]}/${httpsMatch[2]}`)

  const scpMatch = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i.exec(
    trimmed
  )
  if (scpMatch) return parseGitHubRepo(`${scpMatch[1]}/${scpMatch[2]}`)

  const sshMatch =
    /^ssh:\/\/git@github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(trimmed)
  if (sshMatch) return parseGitHubRepo(`${sshMatch[1]}/${sshMatch[2]}`)

  const gitMatch =
    /^git:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(trimmed)
  if (gitMatch) return parseGitHubRepo(`${gitMatch[1]}/${gitMatch[2]}`)

  return null
}

function truncateBody(body: string): { body: string; bodyTruncated: boolean } {
  if (body.length <= MAX_BODY_CHARS) return { body, bodyTruncated: false }
  return { body: body.slice(0, MAX_BODY_CHARS), bodyTruncated: true }
}

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
  const token = options.token?.trim() || null
  const apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '')
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT
  const fetchImpl = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  function requireToken(): string {
    if (!token) {
      throw new GitHubError(
        'GITHUB_TOKEN_MISSING',
        'A GitHub token is required. Set GITHUB_TOKEN/GH_TOKEN or save one in Settings → GitHub.'
      )
    }
    return token
  }

  function headers(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': userAgent,
      Authorization: `Bearer ${requireToken()}`
    }
  }

  async function errorFor(response: Response): Promise<GitHubError> {
    const status = response.status
    const detail = await response
      .json()
      .then((body) =>
        body &&
        typeof body === 'object' &&
        typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message.trim().slice(0, MAX_ERROR_DETAIL_CHARS) || null
          : null
      )
      .catch(() => null)
    const message = detail
      ? `GitHub API error (HTTP ${status}): ${detail}`
      : `GitHub API error (HTTP ${status})`
    if (status === 401) return new GitHubError('GITHUB_UNAUTHORIZED', message, status)
    if (status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining')
      if (remaining === '0') return new GitHubError('GITHUB_RATE_LIMITED', message, status)
      return new GitHubError('GITHUB_FORBIDDEN', message, status)
    }
    if (status === 429) return new GitHubError('GITHUB_RATE_LIMITED', message, status)
    if (status === 404) return new GitHubError('GITHUB_NOT_FOUND', message, status)
    if (status === 422) return new GitHubError('GITHUB_UNPROCESSABLE', message, status)
    return new GitHubError('GITHUB_API_ERROR', message, status)
  }

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {}
  ): Promise<T> {
    // Resolve headers first so a missing token is not wrapped as a network error.
    const requestHeaders = {
      ...headers(),
      ...(init.headers as Record<string, string> | undefined)
    }
    let response: Response
    try {
      response = await fetchImpl(`${apiBaseUrl}${path}`, {
        ...init,
        headers: requestHeaders,
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      throw new GitHubError(
        'GITHUB_NETWORK_ERROR',
        `GitHub request failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (!response.ok) throw await errorFor(response)
    const parsed = schema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) {
      throw new GitHubError('GITHUB_INVALID_RESPONSE', 'GitHub returned an unexpected response')
    }
    return parsed.data
  }

  function toIssue(data: z.infer<typeof IssueSchema>): GitHubIssue {
    return {
      number: data.number,
      title: data.title,
      url: data.html_url,
      state: data.state,
      author: data.user?.login ?? 'unknown',
      labels: labelNames(data.labels),
      comments: data.comments ?? 0,
      updatedAt: data.updated_at ?? '',
      body: data.body ?? '',
      isPullRequest: data.pull_request !== undefined && data.pull_request !== null
    }
  }

  function toPull(data: z.infer<typeof PullSchema>): GitHubPull {
    return {
      number: data.number,
      title: data.title,
      url: data.html_url,
      state: data.state,
      author: data.user?.login ?? 'unknown',
      labels: labelNames(data.labels),
      comments: data.comments ?? 0,
      updatedAt: data.updated_at ?? '',
      body: data.body ?? '',
      draft: data.draft ?? false,
      merged: data.merged ?? false,
      baseBranch: data.base.ref,
      headBranch: data.head.ref,
      additions: data.additions ?? 0,
      deletions: data.deletions ?? 0,
      changedFiles: data.changed_files ?? 0,
      commits: data.commits ?? 0
    }
  }

  return {
    async getViewer() {
      const data = await request('/user', ViewerSchema)
      return { login: data.login }
    },

    async getIssue(repo, number) {
      const data = await request(
        `/repos/${repoPath(repo)}/issues/${requireNumber(number)}`,
        IssueSchema
      )
      return toIssue(data)
    },

    async getPull(repo, number) {
      const data = await request(
        `/repos/${repoPath(repo)}/pulls/${requireNumber(number)}`,
        PullSchema
      )
      return toPull(data)
    },

    async getPullFiles(repo, number) {
      const items = await request(
        `/repos/${repoPath(repo)}/pulls/${requireNumber(number)}/files?per_page=100`,
        z.array(PullFileSchema)
      )
      return items.map((item) => ({
        filename: item.filename,
        status: item.status ?? 'modified',
        additions: item.additions ?? 0,
        deletions: item.deletions ?? 0
      }))
    },

    async listOpenItems(repo, kind) {
      const params = new URLSearchParams({
        state: 'open',
        sort: 'updated',
        direction: 'desc',
        per_page: String(MAX_LIST_ITEMS)
      })
      const items = await request(
        `/repos/${repoPath(repo)}/issues?${params.toString()}`,
        z.array(IssueSchema)
      )
      return items
        .filter((item) =>
          kind === 'pull'
            ? item.pull_request !== undefined && item.pull_request !== null
            : item.pull_request === undefined || item.pull_request === null
        )
        .slice(0, MAX_LIST_ITEMS)
        .map((item) => {
          const issue = toIssue(item)
          return {
            owner: repo.owner,
            repo: repo.repo,
            kind,
            number: issue.number,
            title: issue.title,
            url: issue.url,
            state: issue.state,
            author: issue.author,
            labels: issue.labels,
            comments: issue.comments,
            updatedAt: issue.updatedAt
          }
        })
    },

    async createComment(repo, number, body) {
      const trimmed = body.trim()
      if (!trimmed) throw new GitHubError('GITHUB_INVALID_REF', 'Comment body cannot be empty')
      const data = await request(
        `/repos/${repoPath(repo)}/issues/${requireNumber(number)}/comments`,
        CommentSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: trimmed })
        }
      )
      return { url: data.html_url }
    },

    async createPull(input) {
      const repo = parseGitHubRepo(input.repo)
      if (!repo) throw new GitHubError('GITHUB_INVALID_REF', `Invalid repository: ${input.repo}`)
      const title = input.title.trim()
      const base = input.base.trim()
      const head = input.head.trim()
      if (!title || !base || !head) {
        throw new GitHubError(
          'GITHUB_INVALID_REF',
          'Pull request title, base and head are required'
        )
      }
      const data = await request(`/repos/${repoPath(repo)}/pulls`, CreatedPullSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body: input.body,
          base,
          head,
          draft: input.draft
        })
      })
      return { number: data.number, url: data.html_url }
    }
  }
}

/** Loads the issue/PR and, for pull requests, its change summary. */
export async function loadGitHubContext(
  client: GitHubClient,
  ref: GitHubItemRef
): Promise<GitHubItemContext> {
  requireNumber(ref.number)
  const issue = await client.getIssue(ref, ref.number)
  const kind: GitHubItemKind = issue.isPullRequest ? 'pull' : 'issue'
  const { body, bodyTruncated } = truncateBody(issue.body)

  let pull: GitHubPullSummary | null = null
  if (kind === 'pull') {
    const [details, allFiles] = await Promise.all([
      client.getPull(ref, ref.number),
      client.getPullFiles(ref, ref.number)
    ])
    const files = allFiles.slice(0, MAX_FILES)
    pull = {
      number: details.number,
      title: details.title,
      state: details.state,
      draft: details.draft,
      merged: details.merged,
      baseBranch: details.baseBranch,
      headBranch: details.headBranch,
      additions: details.additions,
      deletions: details.deletions,
      changedFiles: details.changedFiles,
      commits: details.commits,
      files,
      filesTruncated: allFiles.length > MAX_FILES || details.changedFiles > allFiles.length
    }
  }

  return {
    owner: ref.owner,
    repo: ref.repo,
    kind,
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    author: issue.author,
    labels: issue.labels,
    comments: issue.comments,
    updatedAt: issue.updatedAt,
    body,
    bodyTruncated,
    pull
  }
}

/** Renders the context as a Markdown block suitable for the first message. */
export function buildGitHubPrompt(context: GitHubItemContext): string {
  const label = context.kind === 'pull' ? 'pull request' : 'issue'
  const lines = [
    `## GitHub ${label} ${context.owner}/${context.repo}#${context.number}: ${context.title}`,
    '',
    `- URL: ${context.url}`,
    `- Author: @${context.author}`,
    `- Labels: ${context.labels.length > 0 ? context.labels.join(', ') : 'none'}`,
    `- Comments: ${context.comments}`
  ]

  if (context.pull) {
    const pull = context.pull
    const state = pull.merged
      ? `${pull.state} (merged)`
      : pull.draft
        ? `${pull.state} (draft)`
        : pull.state
    lines.push(
      `- State: ${state}`,
      `- Base: \`${pull.baseBranch}\` ← \`${pull.headBranch}\``,
      `- Commits: ${pull.commits}`,
      `- Changes: +${pull.additions} −${pull.deletions} across ${pull.changedFiles} files`
    )
  } else {
    lines.push(`- State: ${context.state}`)
  }

  lines.push('', '### Description', '', context.body.trim() || '_No description provided._')
  if (context.bodyTruncated) lines.push('', '_Description truncated._')

  if (context.pull) {
    lines.push('', '### Changed files', '')
    if (context.pull.files.length === 0) {
      lines.push('_No changed files reported._')
    } else {
      for (const file of context.pull.files) {
        lines.push(`- \`${file.filename}\` (${file.status}) +${file.additions} −${file.deletions}`)
      }
      if (context.pull.filesTruncated) {
        lines.push(
          `- …and ${Math.max(context.pull.changedFiles - context.pull.files.length, 0)} more files (truncated)`
        )
      }
    }
  }

  return lines.join('\n')
}
