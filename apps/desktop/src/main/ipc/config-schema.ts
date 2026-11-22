import { z } from 'zod'

export const agentConfigPatchSchema = z.object({
  snapshots: z.boolean().optional(),
  instructions: z.array(z.string().max(2_000)).max(50).optional(),
  lsp: z.boolean().optional(),
  formatters: z.boolean().optional(),
  formatterOverrides: z.record(z.string().max(16), z.string().max(40)).optional()
})
