import { z } from 'zod'
import { modelRefSchema } from '../model-schema'

export const idSchema = z.string().min(1).max(200)

export const renameSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).max(200)
})

export const idPayloadSchema = z.object({ id: idSchema })

export const authPayloadSchema = z.object({
  id: idSchema,
  directory: z.string().max(2_000).nullable().optional()
})

export const directoryPayloadSchema = z.object({
  directory: z.string().max(2_000).nullable().optional()
})

export const commandExpandSchema = z.object({
  template: z.string().max(100_000),
  args: z.string().max(10_000),
  directory: z.string().max(2_000).nullable().optional()
})

export const commandRunSchema = z.object({
  sessionId: idSchema,
  name: z.string().trim().min(1).max(200),
  args: z.string().max(10_000).optional()
})

export const mcpServerInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  type: z.enum(['local', 'remote']),
  command: z.string().max(500).nullable().optional(),
  args: z.array(z.string().max(2_000)).max(100).optional(),
  url: z.string().max(2_000).nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  timeout: z.number().int().min(100).max(600_000).nullable().optional(),
  cwd: z.string().max(2_000).nullable().optional(),
  oauthClientId: z.string().max(300).nullable().optional(),
  oauthScope: z.string().max(500).nullable().optional(),
  oauthRedirectUri: z.string().max(2_000).nullable().optional()
})

export const mcpUpdateSchema = z.object({
  id: idSchema,
  input: mcpServerInputSchema.partial()
})

export const mcpStatusesSchema = z.object({
  probe: z.boolean().optional(),
  directory: z.string().max(2_000).nullable().optional()
})

export const mcpPromptSchema = z.object({
  server: z.string().min(1).max(200),
  prompt: z.string().min(1).max(500),
  arguments: z.record(z.string(), z.string()).optional(),
  directory: z.string().max(2_000).nullable().optional()
})

export const sessionSetModelSchema = z.object({
  id: idSchema,
  model: modelRefSchema.nullable()
})

export const sessionSettingsSchema = z.object({
  reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).nullable(),
  permissionMode: z.enum(['plan', 'ask', 'acceptEdits', 'auto'])
})

export const sessionSetSettingsSchema = z.object({
  id: idSchema,
  settings: sessionSettingsSchema
})

export const sessionSetDirectorySchema = z.object({
  id: idSchema,
  directory: z.string().max(2_000).nullable()
})

export const sessionSetAgentSchema = z.object({
  id: idSchema,
  agent: z.string().min(1).max(100).nullable()
})

/** Undo targets an optional assistant message, or one recorded step inside it. */
export const sessionUndoSchema = z.object({
  id: idSchema,
  messageId: idSchema.optional(),
  stepIndex: z.number().int().min(0).max(100_000).optional()
})

/** Fork targets an optional message to cut the conversation at. */
export const sessionForkSchema = z.object({
  id: idSchema,
  messageId: idSchema.optional()
})

export const sessionIdSchema = z.object({ sessionId: idSchema })

export const sessionSearchSchema = z.object({ query: z.string().max(200) })

export const sessionChangesSchema = z.object({
  sessionId: idSchema,
  messageId: idSchema.optional()
})

export const sessionRevertFilesSchema = z.object({
  sessionId: idSchema,
  messageId: idSchema,
  paths: z.array(z.string().min(1).max(2_000)).min(1).max(200).optional()
})

export const sessionUnrevertFilesSchema = z.object({
  sessionId: idSchema,
  paths: z.array(z.string().min(1).max(2_000)).min(1).max(200).optional()
})

export const vcsStatusSchema = z.object({ sessionId: idSchema })

export const vcsDiffSchema = z.object({
  sessionId: idSchema,
  mode: z.enum(['working', 'branch', 'committed']).optional(),
  base: z.string().max(200).optional(),
  path: z.string().max(2_000).optional()
})

export const attachmentSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(300),
  mimeType: z.string().max(200),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(20 * 1024 * 1024),
  kind: z.enum(['text', 'image', 'pdf']),
  path: z.string().min(1).max(2_000)
})

export const chatSendSchema = z.object({
  sessionId: idSchema,
  text: z.string().max(100_000),
  model: modelRefSchema.nullable().optional(),
  attachments: z.array(attachmentSchema).max(10).optional()
})

export const chatSteerSchema = z.object({
  sessionId: idSchema,
  text: z.string().max(100_000),
  strategy: z.enum(['after-step', 'interrupt']).optional(),
  attachments: z.array(attachmentSchema).max(10).optional()
})

export const chatQueueRemoveSchema = z.object({
  sessionId: idSchema,
  id: idSchema
})

export const backgroundListSchema = z.object({
  sessionId: idSchema.optional()
})

export const backgroundCancelSchema = z.object({
  taskId: idSchema
})

export const attachmentImportSchema = z.object({
  sessionId: idSchema,
  name: z.string().min(1).max(300),
  mimeType: z.string().max(200),
  data: z.instanceof(Uint8Array)
})

export const attachmentRemoveSchema = z.object({
  sessionId: idSchema,
  attachmentId: idSchema
})

export const attachmentPreviewSchema = z.object({
  sessionId: idSchema,
  path: z.string().min(1).max(2_000)
})

export const filesSearchSchema = z.object({
  query: z.string().max(200),
  directory: z.string().max(2_000).nullable().optional()
})

export const permissionReplySchema = z.object({
  requestId: idSchema,
  decision: z.enum(['once', 'always', 'reject'])
})

export const permissionRulesSchema = z.object({ sessionId: idSchema.optional() }).optional()

export const permissionRuleInputSchema = z.object({
  action: z.enum([
    'read',
    'list',
    'glob',
    'grep',
    'write',
    'edit',
    'shell',
    'external_directory',
    'mcp',
    'webfetch',
    'websearch',
    'lsp',
    'skill',
    'subagent',
    'plugin',
    '*'
  ]),
  resource: z.string().trim().min(1).max(500),
  effect: z.enum(['allow', 'ask', 'deny']),
  sessionId: idSchema.nullable()
})

export const questionReplySchema = z.object({
  questionId: idSchema,
  answer: z.object({
    selected: z.array(z.string().max(200)).max(10),
    custom: z.string().max(2_000).nullable(),
    cancelled: z.boolean().optional(),
    timedOut: z.boolean().optional()
  })
})

export const workspacePickSchema = z.object({
  defaultPath: z.string().max(2_000).optional()
})

export const workspaceOpenSchema = z.object({
  path: z.string().max(2_000).nullable().optional()
})

export const externalUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}, 'INVALID_URL')
