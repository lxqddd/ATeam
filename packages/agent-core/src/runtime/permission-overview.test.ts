import { describe, expect, it } from 'vitest'
import type { AgentDefinition, PermissionRule } from '@ateam/shared'
import { buildPermissionOverview } from './permission-overview'

const globalRule: PermissionRule = {
  id: 'r1',
  action: 'write',
  resource: 'src/*',
  effect: 'allow',
  sessionId: null,
  createdAt: '2026-01-01T00:00:00.000Z'
}

const sessionRule: PermissionRule = {
  id: 'r2',
  action: 'shell',
  resource: 'bun test',
  effect: 'allow',
  sessionId: 'session-1',
  createdAt: '2026-01-01T00:00:00.000Z'
}

function agent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: 'build',
    name: 'build',
    description: '',
    mode: 'primary',
    model: null,
    tools: null,
    permissions: [],
    maxSteps: null,
    temperature: null,
    prompt: '',
    source: 'builtin',
    ...overrides
  }
}

const sources = {
  globalConfigPath: '/user/config.json',
  projectConfigPath: '/repo/ateam.jsonc',
  projectConfigDir: '/repo',
  projectRoot: '/repo'
}

describe('buildPermissionOverview', () => {
  it('returns the six layers in evaluation order with their rules', () => {
    const overview = buildPermissionOverview({
      workspace: '/repo/packages/app',
      storedRules: [globalRule, sessionRule],
      effective: {
        sources,
        globalPermissionRules: [
          { action: 'shell', resource: 'rm *', effect: 'deny', sessionId: null }
        ],
        projectPermissionRules: [
          { action: 'edit', resource: 'docs/*', effect: 'allow', sessionId: null }
        ]
      },
      agents: [
        agent({
          id: 'plan',
          name: 'plan',
          permissions: [{ action: 'write', resource: '*', effect: 'deny' }]
        })
      ],
      policy: {
        path: '/user/policy.json',
        rules: [{ action: '*', resource: '*', effect: 'ask' }]
      }
    })

    expect(overview.workspace).toBe('/repo/packages/app')
    expect(overview.groups.map((group) => group.source)).toEqual([
      'global-persisted',
      'global-config',
      'project-config',
      'agent',
      'session-persisted',
      'policy'
    ])
    expect(overview.groups[0]).toMatchObject({
      editable: true,
      rules: [{ id: 'r1', action: 'write', resource: 'src/*', effect: 'allow', sessionId: null }]
    })
    expect(overview.groups[1]).toMatchObject({
      editable: false,
      path: sources.globalConfigPath,
      rules: [{ action: 'shell', resource: 'rm *', effect: 'deny' }]
    })
    expect(overview.groups[2]).toMatchObject({
      path: sources.projectConfigPath,
      rules: [{ action: 'edit', resource: 'docs/*', effect: 'allow' }]
    })
    expect(overview.groups[3]).toMatchObject({
      agentId: 'plan',
      agentName: 'plan',
      agentSource: 'builtin',
      rules: [{ action: 'write', resource: '*', effect: 'deny' }]
    })
    expect(overview.groups[4]).toMatchObject({
      editable: true,
      rules: [{ id: 'r2', sessionId: 'session-1' }]
    })
    expect(overview.groups[5]).toMatchObject({
      editable: false,
      path: '/user/policy.json',
      rules: [{ id: 'policy-0', action: '*', resource: '*', effect: 'ask' }]
    })
  })

  it('groups every agent with rules and keeps an empty agent layer otherwise', () => {
    const withAgents = buildPermissionOverview({
      workspace: '/repo',
      storedRules: [],
      effective: { sources },
      agents: [
        agent({
          id: 'reviewer',
          name: 'reviewer',
          source: 'project',
          permissions: [{ action: 'shell', resource: 'git diff *', effect: 'allow' }]
        }),
        agent({
          id: 'plan',
          name: 'plan',
          permissions: [{ action: 'edit', resource: '*', effect: 'deny' }]
        }),
        agent({ id: 'build', name: 'build' })
      ],
      policy: { path: null, rules: [] }
    })
    const agentGroups = withAgents.groups.filter((group) => group.source === 'agent')
    expect(agentGroups.map((group) => group.agentName)).toEqual(['plan', 'reviewer'])
    expect(agentGroups[1]).toMatchObject({ agentSource: 'project' })

    const withoutAgents = buildPermissionOverview({
      workspace: '/repo',
      storedRules: [],
      effective: { sources },
      agents: [agent({ id: 'build', name: 'build' })],
      policy: { path: null, rules: [] }
    })
    expect(withoutAgents.groups.filter((group) => group.source === 'agent')).toEqual([
      { source: 'agent', editable: false, rules: [] }
    ])
  })

  it('keeps empty layers and omits paths that do not exist', () => {
    const overview = buildPermissionOverview({
      workspace: '/repo',
      storedRules: [],
      effective: {
        sources: {
          globalConfigPath: '/user/config.json',
          projectConfigPath: null,
          projectConfigDir: null,
          projectRoot: '/repo'
        }
      },
      agents: [],
      policy: { path: null, rules: [] }
    })

    expect(overview.groups).toHaveLength(6)
    expect(overview.groups[2]).toEqual({ source: 'project-config', editable: false, rules: [] })
    expect(overview.groups[5]).toEqual({ source: 'policy', editable: false, rules: [] })
    expect(overview.groups.every((group) => group.rules.length === 0)).toBe(true)
  })
})
