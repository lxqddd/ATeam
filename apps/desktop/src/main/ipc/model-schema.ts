import { z } from 'zod'

const idSchema = z.string().min(1).max(100)
const contextWindowSchema = z.number().int().min(1_000).max(10_000_000)
const maxOutputTokensSchema = z.number().int().min(1).max(1_000_000)
const costSchema = z.number().min(0).max(1_000)

export const modelRefSchema = z.object({
  providerId: idSchema,
  modelId: z.string().min(1).max(200),
  variant: z.string().min(1).max(100).nullable().optional()
})

const variantSettingsSchema = z.object({
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxOutputTokens: maxOutputTokensSchema.nullable().optional()
})

const variantSchema = z.object({
  name: z.string().min(1).max(50),
  settings: variantSettingsSchema
})

export const modelCreateSchema = z.object({
  providerId: idSchema,
  modelId: z.string().min(1).max(200),
  name: z.string().max(100).optional(),
  contextWindow: contextWindowSchema.optional(),
  maxOutputTokens: maxOutputTokensSchema.optional(),
  reasoning: z.boolean().optional(),
  attachment: z.boolean().optional(),
  applyPatch: z.boolean().optional(),
  compaction: z.boolean().optional(),
  costInput: costSchema.optional(),
  costOutput: costSchema.optional(),
  variants: z.array(variantSchema).max(10).optional()
})

export const modelUpdateSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(100),
  contextWindow: contextWindowSchema.nullable().optional(),
  maxOutputTokens: maxOutputTokensSchema.nullable().optional(),
  reasoning: z.boolean().optional(),
  attachment: z.boolean().optional(),
  applyPatch: z.boolean().optional(),
  compaction: z.boolean().optional(),
  costInput: costSchema.nullable().optional(),
  costOutput: costSchema.nullable().optional(),
  variants: z.array(variantSchema).max(10).nullable().optional()
})
