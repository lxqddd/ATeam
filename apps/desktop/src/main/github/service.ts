import path from 'node:path'
import type {
  GitHubCommentInput,
  GitHubCommentResult,
  GitHubContextResult,
  GitHubCreatePullInput,
  GitHubCreatePullResult,
  GitHubItemKind,
  GitHubItemSummary,
  GitHubRepoInfo
} from '@ateam/shared'
import { createVcs, type VcsService } from '@ateam/agent-core'
import {
  GitHubError,
  buildGitHubPrompt,
  createGitHubClient,
  loadGitHubContext,
  parseGitHubItemRef,
  parseGitHubRemote,
  parseGitHubRepo,
  type GitHubClient
} from '@ateam/agent-core/integrations'
import type { GitHubTokenStore } from './token-store'

export interface GitHubServiceOptions {
  store: GitHubTokenStore
  workspacePath: string
  fetch?: typeof fetch
  userAgent?: string
  createVcsImpl?: (root: string) => VcsService
}

/** Main-process gateway to the GitHub REST API; the renderer never talks to GitHub. */
export class GitHubService {
  private readonly fetchImpl: typeof fetch | undefined
  private readonly userAgent: string | undefined
  private readonly createVcsImpl: (root: string) => VcsService

  constructor(private readonly options: GitHubServiceOptions) {
    this.fetchImpl = options.fetch
    this.userAgent = options.userAgent
    this.createVcsImpl = options.createVcsImpl ?? ((root) => createVcs(root))
  }

  private client(): GitHubClient {
    const token = this.options.store.runtimeToken()
    if (!token) {
      throw new GitHubError(
        'GITHUB_TOKEN_MISSING',
        'No GitHub token configured. Save one in Settings → GitHub or set GITHUB_TOKEN/GH_TOKEN.'
      )
    }
    return createGitHubClient({
      token,
      fetch: this.fetchImpl,
      userAgent: this.userAgent
    })
  }

  private rootFor(directory?: string | null): string {
    const value = directory?.trim()
    if (!value) return this.options.workspacePath
    if (!path.isAbsolute(value)) {
      throw new GitHubError('GITHUB_INVALID_REF', 'Workspace directory must be absolute')
    }
    return path.resolve(value)
  }

  /** Detects the GitHub repository behind a workspace; null when there is none. */
  async repo(directory?: string | null): Promise<GitHubRepoInfo | null> {
    const root = this.rootFor(directory)
    let info: Awaited<ReturnType<VcsService['info']>>
    try {
      info = await this.createVcsImpl(root).info()
    } catch {
      return null
    }
    if (!info.isRepository || !info.remoteUrl) return null
    const parsed = parseGitHubRemote(info.remoteUrl)
    if (!parsed) return null
    return {
      ...parsed,
      remoteUrl: info.remoteUrl,
      branch: info.branch,
      defaultBranch: info.defaultBranch
    }
  }

  async list(repo: string, kind: GitHubItemKind = 'issue'): Promise<GitHubItemSummary[]> {
    const parsed = parseGitHubRepo(repo)
    if (!parsed) throw new GitHubError('GITHUB_INVALID_REF', `Invalid repository: ${repo}`)
    return this.client().listOpenItems(parsed, kind)
  }

  async context(ref: string): Promise<GitHubContextResult> {
    const parsed = parseGitHubItemRef(ref)
    if (!parsed)
      throw new GitHubError('GITHUB_INVALID_REF', `Invalid issue or pull request: ${ref}`)
    const context = await loadGitHubContext(this.client(), parsed)
    return { context, prompt: buildGitHubPrompt(context) }
  }

  async comment(input: GitHubCommentInput): Promise<GitHubCommentResult> {
    const parsed = parseGitHubItemRef(input.ref)
    if (!parsed) {
      throw new GitHubError('GITHUB_INVALID_REF', `Invalid issue or pull request: ${input.ref}`)
    }
    const body = input.body.trim()
    if (!body) throw new GitHubError('GITHUB_INVALID_REF', 'Comment body cannot be empty')
    return this.client().createComment(parsed, parsed.number, body)
  }

  async createPull(input: GitHubCreatePullInput): Promise<GitHubCreatePullResult> {
    return this.client().createPull(input)
  }
}
