import { describe, expect, it } from 'vitest'
import { evaluatePermissionRules } from '../config/permissions'
import { buildSystemPrompt, modePermissionRules } from './policy'

describe('buildSystemPrompt', () => {
  it('includes model, environment and MCP context', () => {
    const prompt = buildSystemPrompt({
      workspacePath: '/tmp/project',
      permissionMode: 'ask',
      model: { providerId: 'anthropic', modelId: 'claude-sonnet-5' },
      platform: 'darwin',
      date: new Date('2026-11-22T12:00:00.000Z'),
      gitRepository: true,
      mcpInstructions: [{ server: 'docs', instructions: 'Use the docs server for product rules.' }]
    })

    expect(prompt).toContain('anthropic/claude-sonnet-5')
    expect(prompt).toContain('/tmp/project')
    expect(prompt).toContain('Is directory a git repo: yes')
    expect(prompt).toContain('Platform: darwin')
    expect(prompt).toContain('2026-11-22')
    expect(prompt).toContain('<server name="docs">')
    expect(prompt).toContain('Use the docs server for product rules.')
  })

  it('uses model-specific guidance', () => {
    const claude = buildSystemPrompt({
      workspacePath: '/tmp/project',
      permissionMode: 'ask',
      model: { providerId: 'anthropic', modelId: 'claude-sonnet-5' }
    })
    const gpt = buildSystemPrompt({
      workspacePath: '/tmp/project',
      permissionMode: 'ask',
      model: { providerId: 'openai', modelId: 'gpt-5' }
    })

    expect(claude).toContain('Claude')
    expect(gpt).toContain('GPT')
    expect(claude).not.toEqual(gpt)
  })

  it('marks non-git workspaces and read-only plan mode', () => {
    const prompt = buildSystemPrompt({
      workspacePath: '/tmp/project',
      permissionMode: 'plan',
      gitRepository: false
    })

    expect(prompt).toContain('Is directory a git repo: no')
    expect(prompt).toContain('read-only plan mode')
  })

  it('allows writing only the plan file in plan mode', () => {
    const planPath = '.ateam/plans/session-1.md'
    const rules = modePermissionRules('plan', { planPath })

    expect(
      evaluatePermissionRules(rules, {
        action: 'write',
        resources: [planPath],
        sessionId: null
      })
    ).toBe('allow')
    expect(
      evaluatePermissionRules(rules, {
        action: 'write',
        resources: ['src/index.ts'],
        sessionId: null
      })
    ).toBe('deny')
  })

  it('denies plugin tools in plan mode and allows them in auto mode', () => {
    const request = { action: 'plugin' as const, resources: ['@acme/tools/run'], sessionId: null }
    expect(evaluatePermissionRules(modePermissionRules('plan'), request)).toBe('deny')
    expect(evaluatePermissionRules(modePermissionRules('ask'), request)).toBe('ask')
    expect(evaluatePermissionRules(modePermissionRules('auto'), request)).toBe('allow')
  })
})
