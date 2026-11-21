import type {
  PermissionEffect,
  PermissionMode,
  PermissionRule,
  PermissionRuleAction
} from '@ateam/shared'

export function modePermissionRules(mode: PermissionMode): PermissionRule[] {
  const base = (action: PermissionRuleAction, effect: PermissionEffect): PermissionRule => ({
    id: `mode-${mode}-${action}`,
    action,
    resource: '*',
    effect,
    sessionId: null,
    createdAt: ''
  })
  const reads = [base('read', 'allow'), base('list', 'allow'), base('grep', 'allow')]
  const external = base('external_directory', 'allow')
  const web = [base('webfetch', 'allow'), base('websearch', 'allow')]
  switch (mode) {
    case 'plan':
      return [
        ...reads,
        base('write', 'deny'),
        base('edit', 'deny'),
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

export function buildSystemPrompt(workspacePath: string, permissionMode: PermissionMode): string {
  const permission =
    permissionMode === 'plan'
      ? 'This session is in read-only plan mode: inspect the workspace and propose a plan, but do not modify files or run shell commands.'
      : permissionMode === 'acceptEdits'
        ? 'File writes and edits are pre-approved and run without asking. Shell commands still require explicit user approval and may be denied.'
        : permissionMode === 'auto'
          ? 'File writes, edits, and shell commands are pre-approved and run without asking. Still act carefully and stay inside the workspace.'
          : 'write, edit, and shell require explicit user approval and may be denied; respect the decision and explain it.'
  return [
    'You are ATeam, a concise and reliable coding agent running on the user desktop.',
    `The workspace is: ${workspacePath}`,
    'Use the available tools to inspect and modify files. Read, list, and grep are allowed automatically.',
    permission,
    'Prefer small, verifiable changes. Do not claim that you changed a file unless a tool result confirms it.',
    'Use exact unique matches for edit. Keep shell commands non-interactive and scoped to the workspace.',
    'Answer in the language the user used.'
  ].join('\n')
}
