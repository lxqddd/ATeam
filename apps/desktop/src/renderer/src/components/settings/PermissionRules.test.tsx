import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PermissionRule } from '@ateam/shared'
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
  sessionId: 'session-1',
  createdAt: '2026-01-01T00:00:00.000Z'
}

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

describe('PermissionRules', () => {
  it('renders saved rules with action, effect, resource and scope', async () => {
    vi.mocked(mock.api.agent.permissions.rules).mockResolvedValue([allowRule, denyRule])

    render(<PermissionRules />)

    expect(await screen.findByText('src/*')).toBeInTheDocument()
    const list = screen.getByRole('list')
    expect(within(list).getByText('rm -rf *')).toBeInTheDocument()
    expect(within(list).getByText('Allow')).toBeInTheDocument()
    expect(within(list).getByText('Deny')).toBeInTheDocument()
    expect(within(list).getByText('Global')).toBeInTheDocument()
    expect(within(list).getByText(/Session/)).toBeInTheDocument()
  })

  it('removes a saved rule', async () => {
    vi.mocked(mock.api.agent.permissions.rules).mockResolvedValue([allowRule])
    vi.mocked(mock.api.agent.permissions.removeRule).mockResolvedValue(true)
    const user = userEvent.setup()
    render(<PermissionRules />)

    await user.click(await screen.findByRole('button', { name: /Remove rule/ }))

    await waitFor(() => expect(mock.api.agent.permissions.removeRule).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(screen.queryByText('src/*')).not.toBeInTheDocument())
  })

  it('shows an empty state', async () => {
    render(<PermissionRules />)

    expect(await screen.findByText('No saved permission rules.')).toBeInTheDocument()
  })

  it('adds a global permission rule', async () => {
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

    await screen.findByText('No saved permission rules.')
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
})
