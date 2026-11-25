import os from 'node:os'
import path from 'node:path'
import type { PermissionEffect, PermissionRule, PermissionRuleAction } from '@ateam/shared'
import { normalizeShellResource, shellCommandPrefix } from './shell-arity'
import { parseShellCommand } from './shell-parse'

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
  /\b(?:sudo|doas|runas)\b/i,
  /\bmkfs(?:\.\w+)?\b/i,
  /\bdd\s+[^|;\n]*\bif=/i,
  /\b(?:shutdown|reboot|poweroff|halt)\b/i,
  /(?:^|[;&|]\s*)(?:format|diskpart)(?:\s|$)/i,
  /\brm\s+(?:-[a-z]*[rf][a-z]*\s+)+(?:\/|~|\$HOME|\*)/i,
  /\bRemove-Item\b[^|;\n]*(?:-Recurse|-Force)/i,
  /\b(?:del|rd|rmdir)\s+[^|;\n]*\/[sq]\b/i,
  /\bchmod\s+(?:-R\s+)?777\b/i,
  /\bchown\s+(?:-R\s+)?[^|;\n]+\s\/(?:\s|$)/i,
  /\bgit\s+push\b[^|;\n]*(?:--force|-f)\b/i,
  /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^|;\n]*\|\s*(?:(?:ba|z|da|k)?sh|iex)\b/i,
  /\b(?:Invoke-Expression|iex)\b/i,
  /\bpowershell(?:\.exe)?\b[^|;\n]*(?:-enc|-encodedcommand)\b/i,
  /\bcmd(?:\.exe)?\s+\/c\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /\beval\b/i
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
  if (action === 'shell') return normalizeShellResource(trimmed)
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
  if (action === 'shell') {
    const prefix = shellCommandPrefix(normalized)
    return prefix ? `${prefix} *` : normalized
  }
  const directory = path.posix.dirname(normalized)
  if (!directory || directory === '.') return '*'
  return `${directory}/*`
}

function isDynamicToken(token: string): boolean {
  return /\$[A-Za-z_{(]|%[A-Za-z_][A-Za-z0-9_]*%/.test(token)
}

function commandTargets(tokens: string[]): string[] {
  const targets: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (/^\d*>&\d+$/.test(token)) continue
    const redirect = token.match(/^(\d*)(>>?|<)(.*)$/)
    if (redirect) {
      const rest = redirect[3]
      if (rest) {
        if (!rest.startsWith('&')) targets.push(rest)
      } else {
        const next = tokens[index + 1]
        if (next && !/^\d*(>>?|<|>&)/.test(next)) {
          targets.push(next)
          index += 1
        }
      }
      continue
    }
    if (token.startsWith('-')) {
      const equals = token.indexOf('=')
      if (equals > 0 && equals < token.length - 1) targets.push(token.slice(equals + 1))
      continue
    }
    targets.push(token)
  }
  return targets
}

function pathCandidate(token: string): boolean {
  if (!token || token === '-') return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false
  if (/^(?:\/dev\/null|nul:?)$/i.test(token)) return false
  if (/^[a-z]:[\\/]/i.test(token) || token.startsWith('\\\\')) return true
  if (token.startsWith('~')) return true
  return (
    path.isAbsolute(token) ||
    token.startsWith('./') ||
    token.startsWith('../') ||
    token.includes('/') ||
    token.includes('\\')
  )
}

function resolveExternalPath(token: string, root: string, home: string): string | null {
  if (!pathCandidate(token) || isDynamicToken(token)) return null
  if (token.startsWith('~')) {
    if (!/^~([\\/]|$)/.test(token)) return null
    const resolved = path.resolve(home, token.slice(1).replace(/^[\\/]+/, ''))
    return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? null : resolved
  }
  const resolved = path.isAbsolute(token) ? path.resolve(token) : path.resolve(root, token)
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? null : resolved
}

export function scanShellCommand(command: string, workspace: string): ShellScan {
  const parsed = parseShellCommand(command)
  const riskyCommand = RISKY_PATTERNS.some((pattern) => pattern.test(command))
  const dynamic =
    parsed.segments.some((segment) => /`|\$\(/.test(segment)) ||
    parsed.tokens.some((tokens) =>
      tokens.some(
        (token) => isDynamicToken(token) || (token.startsWith('~') && !/^~([\\/]|$)/.test(token))
      )
    )
  const root = path.resolve(workspace)
  const home = os.homedir()
  const external = new Set<string>()

  for (const tokens of parsed.tokens) {
    for (const token of commandTargets(tokens)) {
      const resolved = resolveExternalPath(token, root, home)
      if (resolved) external.add(resolved)
    }
  }

  return {
    segments: parsed.segments,
    externalPaths: [...external],
    risky: riskyCommand || dynamic
  }
}
