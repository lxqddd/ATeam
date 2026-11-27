import { AGENT_CHANNELS } from '@ateam/shared'
import type {
  GitHubCommentResult,
  GitHubContextResult,
  GitHubCreatePullResult,
  GitHubItemSummary,
  GitHubRepoInfo,
  GitHubTokenStatus
} from '@ateam/shared'
import {
  githubCommentSchema,
  githubContextSchema,
  githubCreatePullSchema,
  githubListSchema,
  githubRepoRequestSchema,
  githubTokenSchema
} from '../github-schema'
import type { AgentIpcContext } from './context'

/** Registers GitHub token, import and write-back channels. */
export function registerGitHubHandlers(ctx: AgentIpcContext): void {
  const { githubStore, githubService, handle } = ctx

  handle(AGENT_CHANNELS.githubStatus, (): GitHubTokenStatus => githubStore.get())

  handle(AGENT_CHANNELS.githubTokenUpdate, async (payload): Promise<GitHubTokenStatus> =>
    githubStore.update(githubTokenSchema.parse(payload).token)
  )

  handle(AGENT_CHANNELS.githubTokenClear, (): Promise<GitHubTokenStatus> => githubStore.clear())

  handle(AGENT_CHANNELS.githubRepo, (payload): Promise<GitHubRepoInfo | null> =>
    githubService.repo(githubRepoRequestSchema.parse(payload).directory)
  )

  handle(AGENT_CHANNELS.githubList, async (payload): Promise<GitHubItemSummary[]> => {
    const input = githubListSchema.parse(payload)
    return githubService.list(input.repo, input.kind ?? 'issue')
  })

  handle(AGENT_CHANNELS.githubContext, (payload): Promise<GitHubContextResult> =>
    githubService.context(githubContextSchema.parse(payload).ref)
  )

  handle(AGENT_CHANNELS.githubComment, (payload): Promise<GitHubCommentResult> =>
    githubService.comment(githubCommentSchema.parse(payload))
  )

  handle(AGENT_CHANNELS.githubCreatePull, (payload): Promise<GitHubCreatePullResult> =>
    githubService.createPull(githubCreatePullSchema.parse(payload))
  )
}
