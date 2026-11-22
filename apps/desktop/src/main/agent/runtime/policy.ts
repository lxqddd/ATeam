import type {
  ModelRef,
  PermissionEffect,
  PermissionMode,
  PermissionRule,
  PermissionRuleAction
} from '@ateam/shared'

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
  gitRepository?: boolean
  mcpInstructions?: Array<{ server: string; instructions: string }>
}

function modelGuidance(model: ModelRef | null | undefined): string {
  const id = model?.modelId.toLowerCase() ?? ''
  if (id.includes('claude')) {
    return 'Claude guidance: keep reasoning focused, use tools deliberately, and avoid repeating tool output in the final answer.'
  }
  if (id.includes('gpt') || id.includes('codex') || id.includes('o1') || id.includes('o3')) {
    return 'GPT guidance: prefer structured, minimal edits and short verification steps; do not over-explain completed work.'
  }
  if (id.includes('gemini')) {
    return 'Gemini guidance: be explicit about assumptions, keep tool calls small, and verify file edits before summarizing.'
  }
  if (id.includes('kimi') || id.includes('moonshot')) {
    return 'Kimi guidance: keep context focused, make incremental edits, and verify each change with a targeted tool call.'
  }
  return 'Model guidance: keep tool calls focused, verify changes, and report only confirmed results.'
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
  const date = (input.date ?? new Date()).toISOString().slice(0, 10)
  const model = input.model ? `${input.model.providerId}/${input.model.modelId}` : 'unknown'
  const sections = [
    'You are ATeam, a concise and reliable coding agent running on the user desktop.',
    '<env>',
    `  Working directory: ${input.workspacePath}`,
    `  Is directory a git repo: ${input.gitRepository ? 'yes' : 'no'}`,
    `  Platform: ${input.platform ?? process.platform}`,
    `  Today's date: ${date}`,
    `  Model: ${model}`,
    '</env>',
    'Use the available tools to inspect and modify files. Read, list, and grep are allowed automatically.',
    permission,
    modelGuidance(input.model),
    'Prefer small, verifiable changes. Do not claim that you changed a file unless a tool result confirms it.',
    'For multi-step work, keep the todo list up to date with the todowrite tool.',
    'Use exact unique matches for edit. Keep shell commands non-interactive and scoped to the workspace.',
    'Answer in the language the user used.'
  ]
  if (input.mcpInstructions && input.mcpInstructions.length > 0) {
    sections.push('<mcp_instructions>')
    for (const item of input.mcpInstructions) {
      sections.push(`  <server name="${item.server}">`)
      for (const line of item.instructions.split('\n')) sections.push(`    ${line}`)
      sections.push('  </server>')
    }
    sections.push('</mcp_instructions>')
  }
  return sections.join('\n')
}
