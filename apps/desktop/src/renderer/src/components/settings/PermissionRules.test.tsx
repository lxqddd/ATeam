import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PermissionRule, PermissionRulesOverview } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PermissionRules from './PermissionRules'
import { createApiMock, type ApiMock } from '../../test/api-mock'

const allowRule: PermissionRule = {
  id: 'r1',
  action: 'write',
  resource: 'src/*',
  effect: 'allow',
  sessionId: null,
  createdAt: '2026-01-01T00:00:00.000Z'
}

const denyRule: PermissionRule = {
  id: 'r2',
  action: 'shell',
  resource: 'rm -rf *',
  effect: 'deny',
  sessionId: 'session-1234abcd',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const overview: PermissionRulesOverview = {
  workspace: '/tmp/workspace',
  groups: [
    {
      source: 'global-persisted',
      editable: true,
      rules: [{ id: 'r1', action: 'write', resource: 'src/*', effect: 'allow', sessionId: null }]
    },
    {
      source: 'global-config',
      editable: false,
      path: '/home/user/.config/ateam/config.json',
      rules: [{ id: 'global-config-0', action: 'shell', resource: 'rm -rf /', effect: 'deny' }]
    },
    {
      source: 'project-config',
      editable: false,
      path: '/repo/ateam.jsonc',
      rules: [{ id: 'project-config-0', action: 'edit', resource: 'docs/*', effect: 'allow' }]
    },
    {
      source: 'agent',
      editable: false,
      agentId: 'plan',
      agentName: 'plan',
      agentSource: 'builtin',
      rules: [{ id: 'agent-plan-0', action: 'shell', resource: '*', effect: 'deny' }]
    },
    {
      source: 'session-persisted',
      editable: true,
      rules: [
        {
          id: 'r2',
          action: 'shell',
          resource: 'bun test',
          effect: 'allow',
          sessionId: 'session-1234abcd'
        }
      ]
    },
    {
      source: 'policy',
      editable: false,
      path: '/etc/ateam/policy.json',
      rules: [{ id: 'policy-0', action: '*', resource: '*', effect: 'ask' }]
    }
  ]
}

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

describe('PermissionRules', () => {
  it('shows every layer in evaluation order with sources and read-only markers', async () => {
    vi.mocked(mock.api.agent.permissions.overview).mockResolvedValue(overview)

    render(<PermissionRules />)

    expect(await screen.findByText('src/*')).toBeInTheDocument()
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    ).toEqual([
      'Saved in app',
      'Global config',
      'Project config',
      'Agent rules',
      'Saved for a session',
      'Organization policy'
    ])
    expect(screen.getByText('/repo/ateam.jsonc')).toBeInTheDocument()
    expect(screen.getByText('plan · built-in')).toBeInTheDocument()
    expect(screen.getAllByText('Read-only')).toHaveLength(4)
    // Only the two persisted layers are editable.
    expect(screen.getAllByRole('button', { name: /Remove rule/ })).toHaveLength(2)
    expect(screen.getByText(/Session · session-/)).toBeInTheDocument()
  })

  it('removes a rule from an editable layer only', async () => {
    vi.mocked(mock.api.agent.permissions.overview).mockResolvedValue(overview)
    vi.mocked(mock.api.agent.permissions.removeRule).mockResolvedValue(true)
    const user = userEvent.setup()
    render(<PermissionRules />)

    const [firstRemove] = await screen.findAllByRole('button', { name: /Remove rule/ })
    await user.click(firstRemove!)

    await waitFor(() => expect(mock.api.agent.permissions.removeRule).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(screen.queryByText('src/*')).not.toBeInTheDocument())
    expect(screen.getByText('rm -rf /')).toBeInTheDocument()
  })

  it('adds a global rule to the saved-in-app layer', async () => {
    vi.mocked(mock.api.agent.permissions.overview).mockResolvedValue({
      workspace: '/tmp/workspace',
      groups: [
        { source: 'global-persisted', editable: true, rules: [] },
        { source: 'session-persisted', editable: true, rules: [] }
      ]
    })
    const created: PermissionRule = {
      id: 'r3',
      action: 'shell',
      resource: 'rm *',
      effect: 'deny',
      sessionId: null,
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    vi.mocked(mock.api.agent.permissions.addRule).mockResolvedValue(created)
    const user = userEvent.setup()
    render(<PermissionRules />)

    await screen.findByText('Saved in app')
    await user.selectOptions(screen.getByLabelText('Action'), 'shell')
    await user.type(screen.getByLabelText('Resource'), 'rm *')
    await user.selectOptions(screen.getByLabelText('Effect'), 'deny')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    await waitFor(() =>
      expect(mock.api.agent.permissions.addRule).toHaveBeenCalledWith({
        action: 'shell',
        resource: 'rm *',
        effect: 'deny',
        sessionId: null
      })
    )
    expect(await screen.findByText('rm *')).toBeInTheDocument()
  })

  it('marks empty layers', async () => {
    render(<PermissionRules />)

    expect(await screen.findAllByText('No rules in this layer.')).toHaveLength(6)
  })

  it('falls back to saved rules when the overview is unavailable', async () => {
    vi.mocked(mock.api.agent.permissions.overview).mockRejectedValue(new Error('METHOD_NOT_FOUND'))
    vi.mocked(mock.api.agent.permissions.rules).mockResolvedValue([allowRule, denyRule])

    render(<PermissionRules />)

    expect(
      await screen.findByText(
        'This agent version cannot report every layer; only saved rules are shown.'
      )
    ).toBeInTheDocument()
    expect(await screen.findByText('src/*')).toBeInTheDocument()
    expect(screen.getByText('rm -rf *')).toBeInTheDocument()
    expect(screen.queryByText('Project config')).not.toBeInTheDocument()
  })
})
