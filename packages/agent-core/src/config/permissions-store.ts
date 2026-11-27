import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PermissionEffect, PermissionRule, PermissionRuleAction } from '@ateam/shared'
import { writeJsonAtomic } from '../atomic-json'

interface PermissionsFile {
  version: 1
  rules: PermissionRule[]
}

export function permissionsFilePath(userDataPath: string): string {
  return path.join(userDataPath, 'agent', 'permissions.json')
}

const RULE_ACTIONS = new Set<PermissionRuleAction>([
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
])
const RULE_EFFECTS = new Set<PermissionEffect>(['allow', 'ask', 'deny'])

function nowIso(): string {
  return new Date().toISOString()
}

function isRule(value: unknown): value is PermissionRule {
  if (!value || typeof value !== 'object') return false
  const rule = value as Partial<PermissionRule>
  return (
    typeof rule.id === 'string' &&
    typeof rule.resource === 'string' &&
    rule.resource.length > 0 &&
    RULE_ACTIONS.has(rule.action as PermissionRuleAction) &&
    RULE_EFFECTS.has(rule.effect as PermissionEffect) &&
    (rule.sessionId === null || typeof rule.sessionId === 'string') &&
    typeof rule.createdAt === 'string'
  )
}

export class PermissionsStore {
  private readonly file: string
  private rules: PermissionRule[] = []
  private chain: Promise<void> = Promise.resolve()

  constructor(userDataPath: string) {
    this.file = permissionsFilePath(userDataPath)
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await this.readFromDisk()
  }

  /**
   * Re-reads the file after an external edit, serialized with writes. A missing
   * file clears the rules; an unreadable or malformed file keeps the current
   * state so a half-written editor save cannot wipe the runtime rules.
   */
  reload(): Promise<boolean> {
    const run = this.chain.catch(() => undefined).then(() => this.readFromDisk())
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async readFromDisk(): Promise<boolean> {
    let content: string
    try {
      content = await fs.readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.rules = []
        return true
      }
      return false
    }
    let data: unknown
    try {
      data = JSON.parse(content)
    } catch {
      return false
    }
    const file = data as Partial<PermissionsFile> | null
    this.rules =
      file && file.version === 1 && Array.isArray(file.rules)
        ? file.rules.filter(isRule).map((rule) => structuredClone(rule))
        : []
    return true
  }

  list(sessionId?: string): PermissionRule[] {
    const rules =
      sessionId === undefined
        ? this.rules
        : this.rules.filter((rule) => rule.sessionId === null || rule.sessionId === sessionId)
    return rules.map((rule) => structuredClone(rule))
  }

  async add(input: {
    action: PermissionRuleAction
    resource: string
    effect: PermissionEffect
    sessionId: string | null
  }): Promise<PermissionRule> {
    if (!RULE_ACTIONS.has(input.action)) throw new Error('INVALID_PERMISSION_ACTION')
    if (!RULE_EFFECTS.has(input.effect)) throw new Error('INVALID_PERMISSION_EFFECT')
    const resource = input.resource.trim()
    if (!resource) throw new Error('PERMISSION_RESOURCE_REQUIRED')

    const existing = this.rules.find(
      (rule) =>
        rule.action === input.action &&
        rule.resource === resource &&
        rule.effect === input.effect &&
        rule.sessionId === input.sessionId
    )
    if (existing) return structuredClone(existing)

    const rule: PermissionRule = {
      id: randomUUID(),
      action: input.action,
      resource,
      effect: input.effect,
      sessionId: input.sessionId,
      createdAt: nowIso()
    }
    this.rules.push(rule)
    await this.persist()
    return structuredClone(rule)
  }

  async remove(id: string): Promise<boolean> {
    const index = this.rules.findIndex((rule) => rule.id === id)
    if (index < 0) return false
    this.rules.splice(index, 1)
    await this.persist()
    return true
  }

  async removeForSession(sessionId: string): Promise<number> {
    const before = this.rules.length
    this.rules = this.rules.filter((rule) => rule.sessionId !== sessionId)
    const removed = before - this.rules.length
    if (removed > 0) await this.persist()
    return removed
  }

  private persist(): Promise<void> {
    this.chain = this.chain
      .catch(() => undefined)
      .then(() =>
        writeJsonAtomic(this.file, {
          version: 1,
          rules: this.rules.map((rule) => structuredClone(rule))
        } satisfies PermissionsFile)
      )
    return this.chain
  }
}
