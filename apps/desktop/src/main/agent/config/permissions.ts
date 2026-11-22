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

export function matchPermissionPattern(
  pattern: string,
  value: string,
  caseInsensitive = process.platform === 'win32'
): boolean {
  const barePattern = pattern.endsWith(' *') ? pattern.slice(0, -2) : null
  if (barePattern !== null && value === barePattern) return true
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${expression}$`, caseInsensitive ? 'i' : '').test(value)
}

function normalizeResource(action: PermissionRuleAction, resource: string): string {
  const trimmed = resource.trim()
  if (action === 'shell') return trimmed
  return trimmed.replace(/\\/g, '/').replace(/^\.\//, '')
}

function resourceEffect(
  rules: PermissionRule[],
  action: PermissionRuleAction,
  resource: string
): PermissionEffect | null {
  let effect: PermissionEffect | null = null
  for (const rule of rules) {
    const actionMatches =
      rule.action === '*' || rule.action === action || (action === 'list' && rule.action === 'glob')
    if (!actionMatches) continue
    if (!matchPermissionPattern(rule.resource, resource)) continue
    effect = rule.effect
  }
  return effect
}

/**
 * Evaluates ordered permission rules for one or more resources. Later rules
 * override earlier ones; a multi-resource operation is denied if any resource
 * is denied.
 */
export function evaluatePermissionRules(
  rules: PermissionRule[],
  request: PermissionRuleRequest
): PermissionEffect | null {
  if (request.resources.length === 0) return null
  const ordered = rules.filter(
    (rule) => rule.sessionId === null || rule.sessionId === request.sessionId
  )
  const effects = request.resources.map((resource) =>
    resourceEffect(ordered, request.action, normalizeResource(request.action, resource))
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

function splitShellSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: string | null = null
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      current += character
      escaped = true
      continue
    }
    if (quote) {
      current += character
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      current += character
      continue
    }
    const next = command[index + 1]
    if (
      character === '\n' ||
      character === ';' ||
      (character === '&' && next === '&') ||
      (character === '|' && next === '|') ||
      character === '|'
    ) {
      const segment = current.trim()
      if (segment) segments.push(segment)
      current = ''
      if ((character === '&' || character === '|') && next === character) index += 1
      continue
    }
    current += character
  }

  const segment = current.trim()
  if (segment) segments.push(segment)
  return segments
}

export function scanShellCommand(command: string, workspace: string): ShellScan {
  const segments = splitShellSegments(command)
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
