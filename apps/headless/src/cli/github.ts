import {
  buildGitHubPrompt,
  createGitHubClient,
  GitHubError,
  loadGitHubContext,
  parseGitHubItemRef
} from '@ateam/agent-core/integrations'
import type { GitHubClient } from '@ateam/agent-core/integrations'
import type { GitHubCommentResult, GitHubItemRef } from '@ateam/shared'

export interface GitHubCliOptions {
  env?: NodeJS.ProcessEnv
  fetch?: typeof fetch
}

export interface GitHubCliContext {
  ref: GitHubItemRef
  prompt: string
  label: string
}

/** Token for CLI/Action runs: environment only, never the desktop store. */
export function githubTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim()
  return token || null
}

export function parseGitHubCliRef(value: string): GitHubItemRef {
  const ref = parseGitHubItemRef(value)
  if (!ref) {
    throw new GitHubError('GITHUB_INVALID_REF', `Invalid GitHub issue/PR reference: ${value}`)
  }
  return ref
}

function createCliClient(options: GitHubCliOptions): GitHubClient {
  const token = githubTokenFromEnv(options.env)
  if (!token) {
    throw new GitHubError(
      'GITHUB_TOKEN_MISSING',
      'A GitHub token is required. Set GITHUB_TOKEN or GH_TOKEN for --github-issue/--github-comment.'
    )
  }
  return createGitHubClient({
    token,
    ...(options.fetch ? { fetch: options.fetch } : {})
  })
}

/** Loads the issue/PR context and renders it as the run prompt. */
export async function loadGitHubPrompt(
  value: string,
  options: GitHubCliOptions = {}
): Promise<GitHubCliContext> {
  const ref = parseGitHubCliRef(value)
  const context = await loadGitHubContext(createCliClient(options), ref)
  return {
    ref,
    prompt: buildGitHubPrompt(context),
    label: `${context.owner}/${context.repo}#${context.number}`
  }
}

/** Posts the assistant's final text back as a comment on the issue/PR. */
export async function postGitHubComment(
  value: string,
  body: string,
  options: GitHubCliOptions = {}
): Promise<GitHubCommentResult> {
  const text = body.trim()
  if (!text) {
    throw new Error('No assistant text is available to post as a comment.')
  }
  const ref = parseGitHubCliRef(value)
  return createCliClient(options).createComment(
    { owner: ref.owner, repo: ref.repo },
    ref.number,
    text
  )
}
