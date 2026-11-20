import path from 'node:path'
import { activeProject, activeDirectory } from './projects'

export interface PolicyVerdict {
  allowed: boolean
  reason?: string
}

// Commands ATeam never runs without an explicit change of policy.
const DANGEROUS = [/\brm\s+-rf\s+\/(?:\s|$)/, /\bsudo\b/, /curl[^|\n]*\|\s*(?:sh|bash)\b/]

/**
 * ATeam's own rule, applied on top of the kernel's permission request: a request the kernel asks about must also
 * satisfy this to be approved from the app.
 */
export function evaluate(action: string, resources: ReadonlyArray<string>, command?: string): PolicyVerdict {
  if (action === 'edit' || action === 'write') {
    const root = activeProject()?.path ?? activeDirectory('')
    if (root) {
      for (const resource of resources) {
        const resolved = path.resolve(root, resource)
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
          return { allowed: false, reason: `超出当前项目目录：${resource}` }
        }
      }
    }
  }
  if (action === 'shell' && command) {
    if (DANGEROUS.some((pattern) => pattern.test(command))) {
      return { allowed: false, reason: '命令匹配 ATeam 危险命令策略' }
    }
  }
  return { allowed: true }
}
