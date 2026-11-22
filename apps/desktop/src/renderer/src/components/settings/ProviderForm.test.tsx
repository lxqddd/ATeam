import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProviderPublic } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProviderForm from './ProviderForm'
import { createApiMock } from '../../test/api-mock'

const storedKeyProvider: ProviderPublic = {
  id: 'p1',
  name: 'Acme',
  type: 'openai',
  baseURL: 'https://api.example.com/v1',
  hasApiKey: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const compatibleKeyProvider: ProviderPublic = {
  ...storedKeyProvider,
  type: 'openai-compatible'
}

async function chooseOpenAiCompatible(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: 'Type' }))
  await user.click(await screen.findByTitle('OpenAI compatible'))
}

beforeEach(() => {
  Object.defineProperty(window, 'api', { value: createApiMock().api, configurable: true })
})

describe('ProviderForm', () => {
  it('creates an OAuth provider', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Name'), 'OAuth OpenAI')
    await user.click(screen.getByRole('combobox', { name: 'Type' }))
    await user.click(await screen.findByTitle('OpenAI'))
    await user.click(screen.getByRole('combobox', { name: 'Authentication' }))
    await user.click(await screen.findByTitle('OAuth 2.0'))
    await user.type(
      screen.getByLabelText('OAuth authorization URL'),
      'https://auth.example.com/authorize'
    )
    await user.type(screen.getByLabelText('OAuth token URL'), 'https://auth.example.com/token')
    await user.type(screen.getByLabelText('OAuth client ID'), 'client-1')
    await user.type(screen.getByLabelText('OAuth client secret'), 'secret-1')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'OAuth OpenAI',
          type: 'openai',
          authMode: 'oauth',
          oauth: expect.objectContaining({
            authorizationEndpoint: 'https://auth.example.com/authorize',
            tokenEndpoint: 'https://auth.example.com/token',
            clientId: 'client-1'
          }),
          oauthClientSecret: 'secret-1'
        }),
        []
      )
    )
  })

  it('creates an OpenAI-compatible provider without an API key', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ProviderForm onSubmit={onSubmit} onCancel={vi.fn()} />)

    await chooseOpenAiCompatible(user)
    await user.type(screen.getByLabelText('Name'), 'Local')
    await user.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1')
    expect(screen.getByText('Optional')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        {
          name: 'Local',
          type: 'openai-compatible',
          baseURL: 'https://api.example.com/v1',
          apiKey: undefined
        },
        []
      )
    )
  })

  it('requires a base URL for OpenAI-compatible providers', async () => {
    const user = userEvent.setup()
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />)

    await chooseOpenAiCompatible(user)
    await user.type(screen.getByLabelText('Name'), 'Local')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Enter a base URL.')).toBeInTheDocument()
  })

  it('renders stored-key controls and disables clearing while a key is typed', async () => {
    const user = userEvent.setup()
    render(<ProviderForm provider={compatibleKeyProvider} onSubmit={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByText('Saved')).toBeInTheDocument()
    const checkbox = screen.getByRole('checkbox', { name: 'Clear API key' })
    expect(checkbox).toBeEnabled()

    await user.type(screen.getByLabelText('API key'), 'sk-new')

    await waitFor(() => expect(checkbox).toBeDisabled())
  })

  it('disables clearing the key for provider types that require one', () => {
    render(
      <ProviderForm
        provider={{ ...storedKeyProvider, type: 'anthropic', baseURL: undefined }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('checkbox', { name: 'Clear API key' })).toBeDisabled()
  })

  it('submits an update that keeps the stored key when left blank', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ProviderForm provider={storedKeyProvider} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        {
          id: 'p1',
          name: 'Acme',
          type: 'openai',
          baseURL: 'https://api.example.com/v1',
          clearApiKey: false,
          apiKey: undefined
        },
        []
      )
    )
  })

  it('shows mapped server-side errors', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('API_KEY_REQUIRED'))
    render(<ProviderForm provider={storedKeyProvider} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('This provider requires an API key.')).toBeInTheDocument()
  })

  it('fetches provider models and submits the selected ones', async () => {
    const mock = createApiMock()
    vi.mocked(mock.api.models.previewModels).mockResolvedValue([
      { id: 'gpt-6', name: 'GPT-6' },
      { id: 'gpt-5', name: 'GPT-5' }
    ])
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ProviderForm provider={storedKeyProvider} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Fetch models' }))

    expect(await screen.findByText('gpt-6')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /gpt-6/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), [
        { id: 'gpt-6', name: 'GPT-6' }
      ])
    )
    expect(mock.api.models.previewModels).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'p1', type: 'openai' })
    )
  })
})

describe('provider catalog', () => {
  it('fills provider details from the model catalog', async () => {
    const mock = createApiMock()
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    vi.mocked(mock.api.models.catalog).mockResolvedValue([
      {
        providerId: 'anthropic',
        providerName: 'Anthropic',
        providerApi: 'https://api.anthropic.com',
        providerType: 'anthropic',
        modelId: 'claude-sonnet-4',
        name: 'Claude Sonnet 4',
        contextWindow: 200_000,
        maxOutputTokens: 64_000,
        reasoning: true,
        attachment: true,
        costInput: 3,
        costOutput: 15
      }
    ])
    const user = userEvent.setup()
    render(<ProviderForm onSubmit={vi.fn()} onCancel={vi.fn()} />)

    const combobox = await screen.findByRole('combobox', { name: 'Fill from provider catalog' })
    await user.click(combobox)
    await screen.findByRole('option', { name: 'Anthropic' })
    const matches = await screen.findAllByTitle('Anthropic')
    await user.click(matches[matches.length - 1])

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Anthropic'))
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.anthropic.com')
  })
})
