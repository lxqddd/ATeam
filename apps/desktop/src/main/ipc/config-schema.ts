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

export const agentConfigPatchSchema = z.object({
  snapshots: z.boolean().optional(),
  instructions: z.array(z.string().max(2_000)).max(50).optional(),
  lsp: z.boolean().optional(),
  formatters: z.boolean().optional(),
  formatterOverrides: z.record(z.string().max(16), z.string().max(40)).optional(),
  references: z.array(referenceSchema).max(50).optional()
})
