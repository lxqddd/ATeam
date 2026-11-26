import { z } from 'zod'

const referenceSchema = z.object({
  alias: z.string().min(1).max(64),
  path: z.string().max(1_000).nullable().optional(),
  repository: z.string().max(500).nullable().optional(),
  branch: z.string().max(200).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  hidden: z.boolean().optional()
})

export const agentConfigResolveSchema = z.object({
  directory: z.string().max(2_000).optional()
})

export const projectConfigUpdateSchema = z.object({
  directory: z.string().max(2_000).nullable().optional(),
  content: z.string().max(1_000_000)
})

/** Top-level project keys the structured editors are allowed to touch. */
const PROJECT_EDIT_TOP_LEVEL_KEYS = new Set([
  'providers',
  'lsp',
  'lspEnabled',
  'lspInstall',
  'formatters',
  'formattersEnabled',
  'formatterOverrides',
  'commands',
  'skills'
])

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_PROJECT_EDIT_BYTES = 200_000

const projectConfigEditPathSchema = z
  .array(z.union([z.string().min(1).max(200), z.number().int().min(0).max(10_000)]))
  .min(1)
  .max(8)

export const projectConfigEditSchema = z
  .object({
    directory: z.string().max(2_000).nullable().optional(),
    edits: z
      .array(
        z.object({
          path: projectConfigEditPathSchema,
          value: z.unknown().optional()
        })
      )
      .min(1)
      .max(100)
  })
  .superRefine((input, ctx) => {
    input.edits.forEach((edit, index) => {
      const [head] = edit.path
      if (typeof head !== 'string' || !PROJECT_EDIT_TOP_LEVEL_KEYS.has(head)) {
        ctx.addIssue({
          code: 'custom',
          path: ['edits', index, 'path', 0],
          message: `unsupported project config field: ${String(head)}`
        })
      }
      if (
        edit.path.some(
          (segment) => typeof segment === 'string' && FORBIDDEN_PATH_SEGMENTS.has(segment)
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['edits', index, 'path'],
          message: 'unsafe path segment'
        })
      }
    })
    if (JSON.stringify(input.edits).length > MAX_PROJECT_EDIT_BYTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['edits'],
        message: 'project config edits are too large'
      })
    }
  })

const retryPatchSchema = z.object({
  maxRetries: z.number().int().min(0).max(10).optional(),
  maxDelayMs: z.number().int().min(0).max(600_000).optional(),
  timeoutMs: z.number().int().min(0).max(3_600_000).optional()
})

const environmentPatchSchema = z.object({
  timezone: z.string().max(100).optional(),
  notes: z.string().max(4_000).optional()
})

export const agentConfigPatchSchema = z.object({
  snapshots: z.boolean().optional(),
  instructions: z.array(z.string().max(2_000)).max(50).optional(),
  lsp: z.boolean().optional(),
  formatters: z.boolean().optional(),
  formatterOverrides: z.record(z.string().max(16), z.string().max(40)).optional(),
  references: z.array(referenceSchema).max(50).optional(),
  retry: retryPatchSchema.optional(),
  environment: environmentPatchSchema.optional(),
  systemPrompt: z.string().max(20_000).optional()
})
