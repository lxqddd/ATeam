import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WebSearchSettings from './WebSearchSettings'
import { createApiMock, type ApiMock } from '../../test/api-mock'

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

describe('WebSearchSettings', () => {
  it('shows the saved provider and configuration status', async () => {
    vi.mocked(mock.api.agent.websearch.get).mockResolvedValue({
      provider: 'exa',
      hasApiKey: true,
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    render(<WebSearchSettings />)

    expect(await screen.findByLabelText('Provider')).toHaveValue('exa')
    expect(screen.getByText('Status: Configured')).toBeInTheDocument()
  })

  it('saves a provider and API key', async () => {
    vi.mocked(mock.api.agent.websearch.get).mockResolvedValue({
      provider: 'tavily',
      hasApiKey: false,
      updatedAt: null
    })
    const user = userEvent.setup()
    render(<WebSearchSettings />)

    await screen.findByText('Status: Not configured')
    await user.selectOptions(screen.getByLabelText('Provider'), 'brave')
    await user.type(screen.getByLabelText('API key'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.websearch.update).toHaveBeenCalledWith({
        provider: 'brave',
        apiKey: 'secret'
      })
    )
    expect(await screen.findByText('Status: Configured')).toBeInTheDocument()
    expect(screen.getByLabelText('API key')).toHaveValue('')
  })

  it('keeps the saved key when saving without a new one', async () => {
    vi.mocked(mock.api.agent.websearch.get).mockResolvedValue({
      provider: 'tavily',
      hasApiKey: true,
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    const user = userEvent.setup()
    render(<WebSearchSettings />)

    await screen.findByText('Status: Configured')
    await user.selectOptions(screen.getByLabelText('Provider'), 'exa')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.websearch.update).toHaveBeenCalledWith({ provider: 'exa' })
    )
  })

  it('retries after the initial load fails', async () => {
    vi.mocked(mock.api.agent.websearch.get)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ provider: 'exa', hasApiKey: false, updatedAt: null })
    const user = userEvent.setup()
    render(<WebSearchSettings />)

    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Provider')).toHaveValue('exa')
  })

  it('shows save errors', async () => {
    vi.mocked(mock.api.agent.websearch.get).mockResolvedValue({
      provider: 'tavily',
      hasApiKey: false,
      updatedAt: null
    })
    vi.mocked(mock.api.agent.websearch.update).mockRejectedValue(
      new Error('ENCRYPTION_UNAVAILABLE')
    )
    const user = userEvent.setup()
    render(<WebSearchSettings />)

    await screen.findByText('Status: Not configured')
    await user.type(screen.getByLabelText('API key'), 'secret')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('ENCRYPTION_UNAVAILABLE')
  })
})
