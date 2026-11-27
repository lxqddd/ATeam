import { z } from 'zod'

const refSchema = z.string().trim().min(1).max(2048)

export const githubTokenSchema = z.object({
  token: z.string().trim().min(1).max(1024)
})

export const githubRepoRequestSchema = z.object({
  directory: z.string().trim().min(1).max(4096).nullable().optional()
})

export const githubListSchema = z.object({
  repo: refSchema,
  kind: z.enum(['issue', 'pull']).optional()
})

export const githubContextSchema = z.object({
  ref: refSchema
})

export const githubCommentSchema = z.object({
  ref: refSchema,
  body: z.string().trim().min(1).max(65_536)
})

export const githubCreatePullSchema = z.object({
  repo: refSchema,
  title: z.string().trim().min(1).max(256),
  body: z.string().max(65_536),
  base: refSchema.max(256),
  head: refSchema.max(256),
  draft: z.boolean()
})
