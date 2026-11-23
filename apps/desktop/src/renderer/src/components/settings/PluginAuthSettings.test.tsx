import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginAuthMethodState } from '@ateam/shared'
import PluginAuthSettings from './PluginAuthSettings'
import { createApiMock, type ApiMock } from '../../test/api-mock'

function method(overrides: Partial<PluginAuthMethodState> = {}): PluginAuthMethodState {
  return {
    id: '0:0',
    plugin: '@acme/auth',
    provider: 'acme',
    providerName: 'Acme Cloud',
    type: 'api',
    label: 'API key',
    description: 'Use an account key',
    prompts: [
      {
        type: 'text',
        key: 'token',
        message: 'Account token',
        placeholder: 'acme_...',
        required: true,
        secret: true
      },
      {
        type: 'select',
        key: 'region',
        message: 'Region',
        required: true,
        options: [
          { label: 'US', value: 'us' },
          { label: 'EU', value: 'eu' }
        ]
      }
    ],
    status: { connected: false, type: null, expiresAt: null },
    ...overrides
  }
}

let api: ApiMock

beforeEach(() => {
  api = createApiMock()
  Object.defineProperty(window, 'api', { value: api.api, configurable: true })
})

describe('PluginAuthSettings', () => {
  it('renders declared methods and submits prompt answers', async () => {
    const user = userEvent.setup()
    api.api.agent.plugins.authMethods = vi.fn(async () => [method()])
    api.api.agent.plugins.authorizeAuth = vi.fn(async () => ({
      status: 'success' as const,
      provider: 'acme',
      credentials: { type: 'api' as const, key: 'acme-key' }
    }))
    render(<PluginAuthSettings defaultDirectory="/tmp/workspace" />)

    expect(await screen.findByText('Acme Cloud')).toBeInTheDocument()
    expect(screen.getByText('@acme/auth')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in: API key' }))

    expect(screen.getAllByText('Use an account key').length).toBeGreaterThan(0)
    await user.type(screen.getByLabelText('Account token'), 'typed-token')
    await user.selectOptions(screen.getByLabelText('Region'), 'eu')
    await user.click(screen.getByRole('button', { name: 'Authorize' }))

    await waitFor(() => {
      expect(api.api.agent.plugins.authorizeAuth).toHaveBeenCalledWith({
        id: '0:0',
        answers: { token: 'typed-token', region: 'eu' },
        directory: '/tmp/workspace'
      })
    })
    expect(await screen.findByText('Acme Cloud is connected.')).toBeInTheDocument()
  })

  it('completes a pending browser authorization with a code', async () => {
    const user = userEvent.setup()
    api.api.agent.plugins.authMethods = vi.fn(async () => [
      method({
        type: 'oauth',
        label: 'Browser login',
        description: null,
        prompts: []
      })
    ])
    api.api.agent.plugins.authorizeAuth = vi.fn(async () => ({
      status: 'pending' as const,
      provider: 'acme',
      requestId: 'request-1',
      url: 'https://acme.example.com/login',
      instructions: 'Sign in and paste the code.',
      codeRequired: true
    }))
    api.api.agent.plugins.completeAuth = vi.fn(async () => ({
      status: 'success' as const,
      provider: 'acme',
      credentials: { type: 'oauth' as const, accessToken: 'access-token' }
    }))
    render(<PluginAuthSettings />)

    await screen.findByText('Acme Cloud')
    await user.click(screen.getByRole('button', { name: 'Sign in: Browser login' }))
    await user.click(screen.getByRole('button', { name: 'Authorize' }))

    expect(await screen.findByText('Sign in and paste the code.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open sign-in page' }))
    expect(api.api.openExternal).toHaveBeenCalledWith('https://acme.example.com/login')

    await user.type(screen.getByLabelText('Authorization code'), 'abc123')
    await user.click(screen.getByRole('button', { name: 'Complete sign-in' }))

    await waitFor(() => {
      expect(api.api.agent.plugins.completeAuth).toHaveBeenCalledWith({
        requestId: 'request-1',
        code: 'abc123',
        directory: null
      })
    })
    expect(await screen.findByText('Acme Cloud is connected.')).toBeInTheDocument()
  })

  it('shows authorization failures and keeps the dialog open', async () => {
    const user = userEvent.setup()
    api.api.agent.plugins.authMethods = vi.fn(async () => [method({ prompts: [] })])
    api.api.agent.plugins.authorizeAuth = vi.fn(async () => ({
      status: 'failed' as const,
      message: 'Invalid key.'
    }))
    render(<PluginAuthSettings />)

    await screen.findByText('Acme Cloud')
    await user.click(screen.getByRole('button', { name: 'Sign in: API key' }))
    await user.click(screen.getByRole('button', { name: 'Authorize' }))

    expect(await screen.findByText('Invalid key.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows an empty state when plugins declare no auth methods', async () => {
    render(<PluginAuthSettings />)

    expect(await screen.findByText('No plugin sign-in methods available.')).toBeInTheDocument()
  })

  it('shows connected state and signs out', async () => {
    const user = userEvent.setup()
    const connected = method({
      status: { connected: true, type: 'api', expiresAt: null }
    })
    const disconnected = method()
    api.api.agent.plugins.authMethods = vi.fn(async () => [connected])
    api.api.agent.plugins.logoutAuth = vi.fn(async () => [disconnected])
    render(<PluginAuthSettings />)

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out: API key' }))

    await waitFor(() => {
      expect(api.api.agent.plugins.logoutAuth).toHaveBeenCalledWith('acme', null)
    })
    await waitFor(() => {
      expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Sign out: API key' })).not.toBeInTheDocument()
  })

  it('disables authorization when a required prompt is empty', async () => {
    const user = userEvent.setup()
    api.api.agent.plugins.authMethods = vi.fn(async () => [
      method({
        prompts: [{ type: 'text', key: 'token', message: 'Account token', required: true }]
      })
    ])
    render(<PluginAuthSettings />)

    await screen.findByText('Acme Cloud')
    await user.click(screen.getByRole('button', { name: 'Sign in: API key' }))

    expect(screen.getByRole('button', { name: 'Authorize' })).toBeDisabled()
  })
})
