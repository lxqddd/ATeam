import path from 'node:path'
import type { PermissionEffect, PermissionRule, PermissionRuleAction } from '@ateam/shared'

export interface PermissionRuleRequest {
  action: PermissionRuleAction
  resources: string[]
  sessionId: string | null
}

export interface ShellScan {
  segments: string[]
  externalPaths: string[]
  risky: boolean
}

const RISKY_PATTERNS: RegExp[] = [
  /(?:^|\s)rm\s+(?:-[a-z]*[rf][a-z]*\s+)*\/(?:\s|$)/i,
  /\bsudo\b/i,
  /\bmkfs(?:\.\w+)?\b/i,
  /\bdd\s+[^|;\n]*\bif=/i,
  /\b(?:shutdown|reboot|poweroff)\b/i,
  /\bchmod\s+(?:-R\s+)?777\s+\//i,
  /\bgit\s+push\b[^|;\n]*(?:--force|-f)\b/i,
  /\bcurl\b[^|;\n]*\|\s*(?:ba|z|da)?sh\b/i
]

export function matchPermissionPattern(pattern: string, value: string): boolean {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${expression}$`).test(value)
}

function normalizeResource(action: PermissionRuleAction, resource: string): string {
  const trimmed = resource.trim()
  if (action === 'shell') return trimmed
  return trimmed.replace(/\\/g, '/').replace(/^\.\//, '')
}

function effectWithinScope(rules: PermissionRule[]): PermissionEffect | null {
  if (rules.length === 0) return null
  return rules.some((rule) => rule.effect === 'ask') ? 'ask' : 'allow'
}

function resourceEffect(
  rules: PermissionRule[],
  action: PermissionRuleAction,
  resource: string,
  sessionId: string | null
): PermissionEffect | null {
  const matching = rules.filter(
    (rule) =>
      (rule.action === '*' || rule.action === action) &&
      matchPermissionPattern(rule.resource, resource)
  )
  if (matching.some((rule) => rule.effect === 'deny')) return 'deny'

  const sessionRules = matching.filter((rule) => rule.sessionId === sessionId)
  const globalRules = matching.filter((rule) => rule.sessionId === null)
  return effectWithinScope(sessionRules) ?? effectWithinScope(globalRules)
}

/**
 * Evaluates ordered permission rules for one or more resources.
 * Deny always wins; a mix of allowed and unmatched resources asks.
 */
export function evaluatePermissionRules(
  rules: PermissionRule[],
  request: PermissionRuleRequest
): PermissionEffect | null {
  if (request.resources.length === 0) return null
  const applicable = rules.filter(
    (rule) => rule.sessionId === null || rule.sessionId === request.sessionId
  )
  const effects = request.resources.map((resource) =>
    resourceEffect(
      applicable,
      request.action,
      normalizeResource(request.action, resource),
      request.sessionId
    )
  )

  if (effects.includes('deny')) return 'deny'
  if (effects.every((effect) => effect === 'allow')) return 'allow'
  if (effects.every((effect) => effect === null)) return null
  return 'ask'
}

export function alwaysPermissionResource(action: PermissionRuleAction, resource: string): string {
  const normalized = normalizeResource(action, resource)
  if (action === 'shell') return normalized
  const directory = path.posix.dirname(normalized)
  if (!directory || directory === '.') return '*'
  return `${directory}/*`
}

export function scanShellCommand(command: string, workspace: string): ShellScan {
  const segments = command
    .split(/\s*(?:&&|\|\||;|\n|\|)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const risky = RISKY_PATTERNS.some((pattern) => pattern.test(command))
  const root = path.resolve(workspace)
  const external = new Set<string>()

  for (const rawToken of command.split(/\s+/)) {
    const token = rawToken.replace(/^["'`]|["'`,;|&]+$/g, '')
    if (!token || token.includes('://')) continue
    if (!token.startsWith('/') && !token.startsWith('../') && !token.includes('/../')) continue
    const resolved = path.resolve(root, token)
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) continue
    external.add(resolved)
  }

  return { segments, externalPaths: [...external], risky }
}
