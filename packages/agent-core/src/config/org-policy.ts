import fs from 'node:fs'
import path from 'node:path'
import type {
  OrgPolicyInfo,
  PermissionEffect,
  PermissionRuleAction,
  PolicyRule
} from '@ateam/shared'

const RULE_ACTIONS: readonly PermissionRuleAction[] = [
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
]
const RULE_EFFECTS: readonly PermissionEffect[] = ['allow', 'ask', 'deny']
const MAX_RULES = 200

export interface OrgPolicyOptions {
  userDataPath: string
  envPolicyFile?: string | null
}

export function orgPolicyPath(options: OrgPolicyOptions): string {
  const configured = options.envPolicyFile?.trim()
  if (configured) {
    const expanded = configured.startsWith('~/')
      ? path.join(process.env.HOME ?? '', configured.slice(2))
      : configured
    return path.resolve(expanded)
  }
  return path.join(options.userDataPath, 'agent', 'policy.json')
}

function normalizeRule(value: unknown): PolicyRule | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (
    typeof raw.action !== 'string' ||
    !RULE_ACTIONS.includes(raw.action as PermissionRuleAction) ||
    typeof raw.resource !== 'string' ||
    !raw.resource.trim() ||
    raw.resource.length > 500 ||
    typeof raw.effect !== 'string' ||
    !RULE_EFFECTS.includes(raw.effect as PermissionEffect)
  ) {
    return null
  }
  return {
    action: raw.action as PermissionRuleAction,
    resource: raw.resource.trim(),
    effect: raw.effect as PermissionEffect
  }
}

/** Load a managed organization policy synchronously; missing files are not an error. */
export function loadOrgPolicy(options: OrgPolicyOptions): OrgPolicyInfo {
  const file = orgPolicyPath(options)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path: null, rules: [], error: null }
    }
    return { path: file, rules: [], error: 'Unable to read the organization policy.' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { path: file, rules: [], error: 'Organization policy is not valid JSON.' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { path: file, rules: [], error: 'Organization policy must be a JSON object.' }
  }
  const rawRules = parsed as { permissionRules?: unknown; rules?: unknown }
  const entries = Array.isArray(rawRules.permissionRules)
    ? rawRules.permissionRules
    : Array.isArray(rawRules.rules)
      ? rawRules.rules
      : []
  const rules: PolicyRule[] = []
  let invalid = 0
  for (const entry of entries.slice(0, MAX_RULES)) {
    const rule = normalizeRule(entry)
    if (rule) rules.push(rule)
    else invalid += 1
  }
  return {
    path: file,
    rules,
    error: invalid > 0 ? `Ignored ${invalid} invalid policy rule(s).` : null
  }
}
