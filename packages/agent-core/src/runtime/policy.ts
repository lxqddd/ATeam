import type {
  ModelRef,
  PermissionEffect,
  PermissionMode,
  PermissionRule,
  PermissionRuleAction
} from '@ateam/shared'
import { modelPrompt } from './prompts'

export function modePermissionRules(
  mode: PermissionMode,
  options: { planPath?: string } = {}
): PermissionRule[] {
  const base = (
    action: PermissionRuleAction,
    effect: PermissionEffect,
    resource = '*'
  ): PermissionRule => ({
    id: `mode-${mode}-${action}-${resource}`,
    action,
    resource,
    effect,
    sessionId: null,
    createdAt: ''
  })
  const reads = [base('read', 'allow'), base('list', 'allow'), base('grep', 'allow')]
  const external = base('external_directory', 'allow')
  const web = [
    base('webfetch', 'allow'),
    base('websearch', 'allow'),
    base('skill', 'allow'),
    base('subagent', 'allow')
  ]
  switch (mode) {
    case 'plan':
      return [
        ...reads,
        base('write', 'deny'),
        base('edit', 'deny'),
        base('plugin', 'deny'),
        ...(options.planPath
          ? [base('write', 'allow', options.planPath), base('edit', 'allow', options.planPath)]
          : []),
        base('shell', 'deny'),
        base('mcp', 'deny'),
        external,
        ...web
      ]
    case 'acceptEdits':
      return [
        ...reads,
        base('write', 'allow'),
        base('edit', 'allow'),
        base('shell', 'ask'),
        base('mcp', 'ask'),
        base('plugin', 'ask'),
        external,
        ...web
      ]
    case 'auto':
      return [
        ...reads,
        base('write', 'allow'),
        base('edit', 'allow'),
        base('shell', 'allow'),
        base('mcp', 'allow'),
        base('plugin', 'allow'),
        external,
        ...web
      ]
    case 'ask':
    default:
      return [
        ...reads,
        base('write', 'ask'),
        base('edit', 'ask'),
        base('shell', 'ask'),
        base('mcp', 'ask'),
        base('plugin', 'ask'),
        external,
        ...web
      ]
  }
}

export interface SystemPromptInput {
  workspacePath: string
  permissionMode: PermissionMode
  model?: ModelRef | null
  platform?: string
  date?: Date
  timezone?: string
  environmentNotes?: string
  /** Replaces the model-family base prompt. */
  basePrompt?: string
  gitRepository?: boolean
  mcpInstructions?: Array<{ server: string; instructions: string }>
}

function localDate(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const permission =
    input.permissionMode === 'plan'
      ? 'This session is in read-only plan mode: inspect the workspace and propose a plan, but do not modify files or run shell commands.'
      : input.permissionMode === 'acceptEdits'
        ? 'File writes and edits are pre-approved and run without asking. Shell commands still require explicit user approval and may be denied.'
        : input.permissionMode === 'auto'
          ? 'File writes, edits, and shell commands are pre-approved and run without asking. Still act carefully and stay inside the workspace.'
          : 'write, edit, and shell require explicit user approval and may be denied; respect the decision and explain it.'
  const timezone =
    input.timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
  const date = localDate(input.date ?? new Date(), timezone)
  const model = input.model ? `${input.model.providerId}/${input.model.modelId}` : 'unknown'
  const prompt = modelPrompt(input.model)
  const basePrompt = input.basePrompt?.trim() || prompt.prompt
  const env = [
    '<env>',
    `  Working directory: ${input.workspacePath}`,
    `  Is directory a git repo: ${input.gitRepository ? 'yes' : 'no'}`,
    `  Platform: ${input.platform ?? process.platform}`,
    `  Timezone: ${timezone}`,
    `  Today's date: ${date}`,
    `  Model: ${model}`
  ]
  const notes = input.environmentNotes?.trim()
  if (notes) {
    env.push('  Environment notes:')
    for (const line of notes.split('\n')) env.push(`    ${line}`)
  }
  env.push('</env>')
  const sections = [basePrompt, env.join('\n'), permission]
  if (input.mcpInstructions && input.mcpInstructions.length > 0) {
    sections.push('<mcp_instructions>')
    for (const item of input.mcpInstructions) {
      sections.push(`  <server name="${escapeXml(item.server)}">`)
      for (const line of item.instructions.split('\n')) {
        sections.push(`    ${escapeXml(line)}`)
      }
      sections.push('  </server>')
    }
    sections.push('</mcp_instructions>')
  }
  return sections.join('\n\n')
}
