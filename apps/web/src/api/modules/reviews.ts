import type { MergeRecord, Review, ReviewComment, RunWorkspace } from '@ateam/shared'
import { HttpClient } from '../http/client'

export interface CreateReviewInput {
  decision?: 'approve' | 'request_changes'
  comment?: string
  artifactIds?: string[]
}

export interface CreateCommentInput {
  artifactId?: string
  filePath?: string
  line?: number
  severity?: string
  body: string
}

export interface MergeInput {
  reviewId: string
  expectedHeadCommit: string
  targetBranch: string
  strategy: 'squash' | 'merge'
  confirm: boolean
}

export class ReviewApi {
  static listByRun(runId: string): Promise<Review[]> {
    return HttpClient.get<Review[]>(`/v1/runs/${runId}/reviews`)
  }

  static create(runId: string, input: CreateReviewInput): Promise<Review> {
    return HttpClient.post<Review>(`/v1/runs/${runId}/reviews`, input)
  }

  static decide(reviewId: string, decision: 'approve' | 'request_changes', comment: string): Promise<Review> {
    return HttpClient.post<Review>(`/v1/reviews/${reviewId}/decision`, { decision, comment })
  }

  static listComments(reviewId: string): Promise<ReviewComment[]> {
    return HttpClient.get<ReviewComment[]>(`/v1/reviews/${reviewId}/comments`)
  }

  static addComment(reviewId: string, input: CreateCommentInput): Promise<ReviewComment> {
    return HttpClient.post<ReviewComment>(`/v1/reviews/${reviewId}/comments`, input)
  }

  static resolveComment(commentId: string): Promise<ReviewComment> {
    return HttpClient.post<ReviewComment>(`/v1/review-comments/${commentId}/resolve`)
  }

  static workspace(runId: string): Promise<RunWorkspace> {
    return HttpClient.get<RunWorkspace>(`/v1/runs/${runId}/workspace`)
  }

  static merge(runId: string, input: MergeInput): Promise<MergeRecord> {
    return HttpClient.post<MergeRecord>(`/v1/runs/${runId}/merge`, input)
  }
}
