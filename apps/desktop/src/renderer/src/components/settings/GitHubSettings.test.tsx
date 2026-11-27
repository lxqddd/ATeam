import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubTokenStatus } from '@ateam/shared'
import GitHubSettings from './GitHubSettings'
import { createApiMock, type ApiMock } from '../../test/api-mock'

let api: ApiMock

const CONNECTED: GitHubTokenStatus = {
  hasToken: true,
  source: 'store',
  login: 'octocat',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

beforeEach(() => {
  api = createApiMock()
  Object.defineProperty(window, 'api', { value: api.api, configurable: true })
})

describe('GitHubSettings', () => {
  it('shows the unconfigured status', async () => {
    render(<GitHubSettings />)

    expect(await screen.findByText('Status: Not configured')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear token' })).not.toBeInTheDocument()
  })

  it('shows a saved token and the environment fallback hint', async () => {
    vi.mocked(api.api.agent.github.status).mockResolvedValue({
      ...CONNECTED,
      source: 'env',
      login: null
    })
    render(<GitHubSettings />)

    expect(
      await screen.findByText('Status: Using a token from the environment')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Using GITHUB_TOKEN / GH_TOKEN from the environment; change it there instead.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear token' })).not.toBeInTheDocument()
  })

  it('saves a trimmed token and reports success', async () => {
    const user = userEvent.setup()
    render(<GitHubSettings />)
    await screen.findByText('Status: Not configured')

    await user.type(screen.getByLabelText('Personal access token'), '  secret-token  ')
    await user.click(screen.getByRole('button', { name: 'Save token' }))

    expect(api.api.agent.github.updateToken).toHaveBeenCalledWith('secret-token')
    expect(await screen.findByText('Status: Saved token for octocat')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByLabelText('Personal access token')).toHaveValue('')
  })

  it('clears a stored token', async () => {
    vi.mocked(api.api.agent.github.status).mockResolvedValue(CONNECTED)
    const user = userEvent.setup()
    render(<GitHubSettings />)
    await screen.findByText('Status: Saved token for octocat')

    await user.click(screen.getByRole('button', { name: 'Clear token' }))

    expect(api.api.agent.github.clearToken).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Status: Not configured')).toBeInTheDocument())
  })

  it('translates a rejected token', async () => {
    vi.mocked(api.api.agent.github.updateToken).mockRejectedValue(
      new Error('GITHUB_UNAUTHORIZED: bad credentials')
    )
    const user = userEvent.setup()
    render(<GitHubSettings />)
    await screen.findByText('Status: Not configured')

    await user.type(screen.getByLabelText('Personal access token'), 'bad')
    await user.click(screen.getByRole('button', { name: 'Save token' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The GitHub token is invalid or expired.'
    )
  })

  it('shows a load error and retries', async () => {
    vi.mocked(api.api.agent.github.status)
      .mockRejectedValueOnce(new Error('GITHUB_NETWORK_ERROR: offline'))
      .mockResolvedValueOnce({ hasToken: false, source: 'none', login: null, updatedAt: null })
    const user = userEvent.setup()
    render(<GitHubSettings />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach GitHub; check the network connection.'
    )
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(await screen.findByText('Status: Not configured')).toBeInTheDocument()
    expect(api.api.agent.github.status).toHaveBeenCalledTimes(2)
  })

  it('opens the token creation page externally', async () => {
    const user = userEvent.setup()
    render(<GitHubSettings />)
    await screen.findByText('Status: Not configured')

    await user.click(screen.getByRole('button', { name: 'Create token' }))

    expect(api.api.openExternal).toHaveBeenCalledWith(
      'https://github.com/settings/tokens/new?scopes=repo&description=ATeam'
    )
  })
})
