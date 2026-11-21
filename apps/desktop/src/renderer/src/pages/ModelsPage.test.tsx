import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentInfo, ModelPublic, ModelsConfigPublic, ProviderPublic } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelsPage from './ModelsPage'
import { createApiMock, type ApiMock } from '../test/api-mock'

const provider: ProviderPublic = {
  id: 'p1',
  name: 'Acme',
  type: 'anthropic',
  hasApiKey: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const secondProvider: ProviderPublic = {
  id: 'p2',
  name: 'Second',
  type: 'openai',
  baseURL: 'https://api.example.com/v1',
  hasApiKey: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const compatibleProvider: ProviderPublic = {
  id: 'p1',
  name: 'Acme',
  type: 'openai-compatible',
  baseURL: 'https://api.example.com/v1',
  hasApiKey: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const sonnet: ModelPublic = {
  id: 'm1',
  providerId: 'p1',
  modelId: 'claude-sonnet-5',
  name: 'Sonnet',
  createdAt: '2026-01-01T00:00:00.000Z'
}

const opus: ModelPublic = {
  id: 'm2',
  providerId: 'p1',
  modelId: 'claude-opus-5',
  name: 'Opus',
  createdAt: '2026-01-01T00:00:00.000Z'
}

function makeConfig(overrides: Partial<ModelsConfigPublic> = {}): ModelsConfigPublic {
  return {
    providers: [provider],
    models: [sonnet, opus],
    defaultModel: { providerId: 'p1', modelId: 'claude-sonnet-5' },
    encryptionAvailable: true,
    ...overrides
  }
}

function providerCard(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock({ models: makeConfig() })
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

describe('ModelsPage', () => {
  it('loads and renders provider cards, models, chips and the workspace', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)

    expect(await screen.findByRole('region', { name: 'Acme' })).toBeInTheDocument()
    expect(within(providerCard('Acme')).getByText('Sonnet · claude-sonnet-5')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('Key configured')).toBeInTheDocument()
    expect(screen.getByText('Default endpoint')).toBeInTheDocument()
    expect(screen.getByText('/tmp/workspace')).toBeInTheDocument()

    // The provider card carries the default chip; the dropdown selection marks the same model.
    expect(within(providerCard('Acme')).getAllByText('Default')).toHaveLength(1)

    await user.click(within(providerCard('Acme')).getByRole('combobox'))
    expect(await screen.findByTitle('Opus · claude-opus-5')).toBeInTheDocument()
  })

  it('renders the configured base URL and a missing key chip', async () => {
    mock = createApiMock({
      models: makeConfig({
        providers: [
          {
            ...provider,
            baseURL: 'https://api.example.com',
            hasApiKey: false
          }
        ]
      })
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    render(<ModelsPage />)

    expect(await screen.findByText('https://api.example.com')).toBeInTheDocument()
    expect(screen.getByText('No key')).toBeInTheDocument()
  })

  it('warns when secure storage is unavailable', async () => {
    mock = createApiMock({ models: makeConfig({ encryptionAvailable: false }) })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    render(<ModelsPage />)

    expect(
      await screen.findByText(
        'Secure storage is unavailable on this system, so API keys cannot be saved.'
      )
    ).toBeInTheDocument()
  })

  it('shows an empty state without providers', async () => {
    mock = createApiMock({
      models: makeConfig({ providers: [], models: [], defaultModel: null })
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    render(<ModelsPage />)

    expect(await screen.findByText('No providers yet. Add one to get started.')).toBeInTheDocument()
    // The circular header action and the empty-state action.
    expect(screen.getAllByRole('button', { name: 'Add provider' })).toHaveLength(2)
    expect(screen.queryAllByRole('region')).toHaveLength(1) // Only the workspace card.
  })

  it('sets a model as the default', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    const card = await screen.findByRole('region', { name: 'Acme' })

    expect(within(card).getByText('Sonnet · claude-sonnet-5')).toBeInTheDocument()
    await user.click(within(card).getByRole('combobox'))
    await user.click(await screen.findByTitle('Opus · claude-opus-5'))

    await waitFor(() =>
      expect(mock.api.models.setDefault).toHaveBeenCalledWith({
        providerId: 'p1',
        modelId: 'claude-opus-5'
      })
    )
  })

  it('clears the default model', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(screen.getByRole('button', { name: 'Clear default' }))

    await waitFor(() => expect(mock.api.models.setDefault).toHaveBeenCalledWith(null))
  })

  it('adds a provider through the modal form', async () => {
    vi.mocked(mock.api.models.addProvider).mockResolvedValueOnce(
      makeConfig({ providers: [provider, secondProvider] })
    )
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(screen.getByRole('button', { name: 'Add provider' }))
    await user.type(await screen.findByLabelText('Name'), 'Second')
    await user.type(screen.getByLabelText('API key'), 'sk-test')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.addProvider).toHaveBeenCalledWith({
        name: 'Second',
        type: 'anthropic',
        baseURL: undefined,
        apiKey: 'sk-test'
      })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('region', { name: 'Second' })).toBeInTheDocument()
  })

  it('adds provider models selected while creating a provider', async () => {
    vi.mocked(mock.api.models.addProvider).mockResolvedValueOnce(
      makeConfig({ providers: [provider, secondProvider] })
    )
    vi.mocked(mock.api.models.previewModels).mockResolvedValue([
      { id: 'provider-model', name: 'Provider Model' }
    ])
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(screen.getByRole('button', { name: 'Add provider' }))
    await user.type(await screen.findByLabelText('Name'), 'Second')
    await user.type(screen.getByLabelText('API key'), 'sk-test')
    await user.click(screen.getByRole('button', { name: 'Fetch models' }))
    await user.click(await screen.findByRole('checkbox', { name: /provider-model/ }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.addModel).toHaveBeenCalledWith({
        providerId: 'p2',
        modelId: 'provider-model',
        name: 'Provider Model'
      })
    )
  })

  it('preselects the provider when adding a model from its card', async () => {
    mock = createApiMock({
      models: makeConfig({ providers: [provider, secondProvider] })
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Second' })

    await user.click(within(providerCard('Second')).getByRole('button', { name: /Add model/ }))
    expect(within(await screen.findByRole('dialog')).getByTitle('Second')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Model ID'), 'second-model')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.addModel).toHaveBeenCalledWith({
        providerId: 'p2',
        modelId: 'second-model',
        name: undefined
      })
    )
  })

  it('offers the provider model list when adding a model', async () => {
    vi.mocked(mock.api.models.listModels).mockResolvedValue([
      { id: 'claude-opus-5', name: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' }
    ])
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: /Add model/ }))
    await user.click(await screen.findByLabelText('Model ID'))

    expect(await screen.findByText('claude-opus-5 · Claude Opus 5')).toBeInTheDocument()
    expect(mock.api.models.listModels).toHaveBeenCalledWith('p1')

    await user.click(screen.getByText('claude-opus-5 · Claude Opus 5'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.addModel).toHaveBeenCalledWith({
        providerId: 'p1',
        modelId: 'claude-opus-5',
        name: 'Claude Opus 5'
      })
    )
  })

  it('edits a provider from its card', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Edit provider' }))
    const name = await screen.findByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.updateProvider).toHaveBeenCalledWith({
        id: 'p1',
        name: 'Renamed',
        type: 'anthropic',
        baseURL: '',
        clearApiKey: false,
        apiKey: undefined
      })
    )
  })

  it('deletes a provider after confirmation', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Delete this provider and its models?')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'OK' }))

    await waitFor(() => expect(mock.api.models.deleteProvider).toHaveBeenCalledWith('p1'))
  })

  it('prefills the stored API key masked and reveals it on the eye toggle', async () => {
    vi.mocked(mock.api.models.revealApiKey).mockResolvedValue('sk-stored-secret')
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Edit provider' }))
    const input = (await screen.findByLabelText('API key')) as HTMLInputElement
    await waitFor(() => expect(input).toHaveValue('sk-stored-secret'))
    expect(input).toHaveAttribute('type', 'password')
    expect(mock.api.models.revealApiKey).toHaveBeenCalledWith('p1')

    const eye = document.querySelector('.ant-input-password-icon')
    expect(eye).not.toBeNull()
    fireEvent.click(eye as Element)

    expect(input).toHaveAttribute('type', 'text')
  })

  it('clears the prefilled key when the clear checkbox is checked', async () => {
    mock = createApiMock({ models: makeConfig({ providers: [compatibleProvider] }) })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    vi.mocked(mock.api.models.revealApiKey).mockResolvedValue('sk-stored-secret')
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Edit provider' }))
    await waitFor(() => expect(screen.getByLabelText('API key')).toHaveValue('sk-stored-secret'))

    const checkbox = screen.getByRole('checkbox', { name: 'Clear API key' })
    expect(checkbox).toBeEnabled()
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.updateProvider).toHaveBeenCalledWith({
        id: 'p1',
        name: 'Acme',
        type: 'openai-compatible',
        baseURL: 'https://api.example.com/v1',
        clearApiKey: true,
        apiKey: 'sk-stored-secret'
      })
    )
  })

  it('unchecks clear and submits a new key typed after prefill', async () => {
    mock = createApiMock({ models: makeConfig({ providers: [compatibleProvider] }) })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    vi.mocked(mock.api.models.revealApiKey).mockResolvedValue('sk-stored-secret')
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Edit provider' }))
    const input = await screen.findByLabelText('API key')
    await waitFor(() => expect(input).toHaveValue('sk-stored-secret'))

    const checkbox = screen.getByRole('checkbox', { name: 'Clear API key' })
    await user.click(checkbox)
    await user.clear(input)
    await user.type(input, 'sk-brand-new')

    await waitFor(() => expect(checkbox).not.toBeChecked())
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.updateProvider).toHaveBeenCalledWith({
        id: 'p1',
        name: 'Acme',
        type: 'openai-compatible',
        baseURL: 'https://api.example.com/v1',
        clearApiKey: false,
        apiKey: 'sk-brand-new'
      })
    )
  })

  it('keeps a key typed before the reveal reply arrives', async () => {
    let resolveReveal: (key: string | null) => void = () => undefined
    vi.mocked(mock.api.models.revealApiKey).mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveReveal = resolve
        })
    )
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Edit provider' }))
    const input = await screen.findByLabelText('API key')
    await user.type(input, 'sk-typed-first')
    await act(async () => {
      resolveReveal('sk-stored-secret')
    })

    expect(mock.api.models.revealApiKey).toHaveBeenCalledWith('p1')
    expect(input).toHaveValue('sk-typed-first')
  })

  it('adds a model through the provider card', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: /Add model/ }))
    await user.type(await screen.findByLabelText('Model ID'), 'claude-new')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.addModel).toHaveBeenCalledWith({
        providerId: 'p1',
        modelId: 'claude-new',
        name: undefined
      })
    )
  })

  it('edits the selected model', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Edit model' }))
    const name = await screen.findByLabelText('Display name')
    await user.clear(name)
    await user.type(name, 'Sonnet 5')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.updateModel).toHaveBeenCalledWith({
        id: 'm1',
        name: 'Sonnet 5'
      })
    )
  })

  it('deletes a model after confirmation', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Delete model' }))
    expect(await screen.findByText('Delete this model?')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'OK' }))

    await waitFor(() => expect(mock.api.models.deleteModel).toHaveBeenCalledWith('m1'))
  })

  it('reports a successful connection test', async () => {
    vi.mocked(mock.api.models.test).mockResolvedValue({
      ok: true,
      message: 'ok',
      latencyMs: 42
    })
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Connection succeeded/)).toBeInTheDocument()
  })

  it('reports a failed connection test', async () => {
    vi.mocked(mock.api.models.test).mockRejectedValue(new Error('bad key'))
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Connection failed: bad key/)).toBeInTheDocument()
  })

  it('retries after a load failure', async () => {
    vi.mocked(mock.api.models.get).mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    render(<ModelsPage />)

    expect(await screen.findByText(/Could not load the model configuration/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('region', { name: 'Acme' })).toBeInTheDocument()
  })

  it('opens the workspace folder', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(screen.getByRole('button', { name: 'Open folder' }))

    expect(mock.api.workspace.open).toHaveBeenCalled()
  })
})

describe('ModelsPage edge cases', () => {
  it('maps provider delete failures', async () => {
    vi.mocked(mock.api.models.deleteProvider).mockRejectedValueOnce(new Error('PROVIDER_NOT_FOUND'))
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'OK' }))

    expect(await screen.findByText('The provider no longer exists.')).toBeInTheDocument()
  })

  it('maps model delete failures', async () => {
    vi.mocked(mock.api.models.deleteModel).mockRejectedValueOnce(new Error('MODEL_NOT_FOUND'))
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Delete model' }))
    await user.click(await screen.findByRole('button', { name: 'OK' }))

    expect(await screen.findByText('The model no longer exists.')).toBeInTheDocument()
  })

  it('maps default model failures', async () => {
    vi.mocked(mock.api.models.setDefault).mockRejectedValueOnce(new Error('MODEL_NOT_FOUND'))
    const user = userEvent.setup()
    render(<ModelsPage />)
    const card = await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(card).getByRole('combobox'))
    await user.click(await screen.findByTitle('Opus · claude-opus-5'))

    expect(await screen.findByText('The model no longer exists.')).toBeInTheDocument()
  })

  it('shows non-Error workspace failures', async () => {
    vi.mocked(mock.api.workspace.open).mockRejectedValueOnce('open failed')
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(screen.getByRole('button', { name: 'Open folder' }))

    expect(await screen.findByText('open failed')).toBeInTheDocument()
  })

  it('closes the provider modal without saving', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(screen.getByRole('button', { name: 'Add provider' }))
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument())
    expect(mock.api.models.addProvider).not.toHaveBeenCalled()
  })

  it('closes the model modal without saving', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: /Add model/ }))
    expect(await screen.findByLabelText('Model ID')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByLabelText('Model ID')).not.toBeInTheDocument())
    expect(mock.api.models.addModel).not.toHaveBeenCalled()
  })

  it('cancels a provider delete confirmation', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument()
    )
    expect(
      within(providerCard('Acme')).getByRole('button', { name: 'Edit provider' })
    ).toBeInTheDocument()
  })

  it('cancels a model delete confirmation', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Delete model' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument()
    )
    expect(
      within(providerCard('Acme')).getByRole('button', { name: 'Test connection' })
    ).toBeInTheDocument()
  })

  it('resets the clear-key flag when a new key is typed', async () => {
    mock = createApiMock({ models: makeConfig({ providers: [compatibleProvider] }) })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Edit provider' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Clear API key' }))
    await user.type(screen.getByLabelText('API key'), 'sk-new')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.updateProvider).toHaveBeenCalledWith({
        id: 'p1',
        name: 'Acme',
        type: 'openai-compatible',
        baseURL: 'https://api.example.com/v1',
        clearApiKey: false,
        apiKey: 'sk-new'
      })
    )
  })

  it('reports connection success without latency', async () => {
    vi.mocked(mock.api.models.test).mockResolvedValue({ ok: true, message: 'ok' })
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('Connection succeeded')).toBeInTheDocument()
  })

  it('reports connection failures without a message', async () => {
    vi.mocked(mock.api.models.test).mockResolvedValue({
      ok: false,
      message: undefined as unknown as string
    })
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(within(providerCard('Acme')).getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Connection failed/)).toBeInTheDocument()
  })

  it('shows a placeholder when agent info is unavailable', async () => {
    vi.mocked(mock.api.agent.info).mockResolvedValue({} as unknown as AgentInfo)
    render(<ModelsPage />)

    expect(await screen.findByRole('region', { name: 'Acme' })).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('validates required provider fields', async () => {
    const user = userEvent.setup()
    render(<ModelsPage />)
    await screen.findByRole('region', { name: 'Acme' })

    await user.click(screen.getByRole('button', { name: 'Add provider' }))
    await user.click(await screen.findByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    expect(mock.api.models.addProvider).not.toHaveBeenCalled()
  })

  it('shows the no-models hint for a provider without models', async () => {
    mock = createApiMock({ models: makeConfig({ models: [], defaultModel: null }) })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    render(<ModelsPage />)

    expect(await screen.findByRole('region', { name: 'Acme' })).toBeInTheDocument()
    expect(screen.getByText('No models yet. Add one to get started.')).toBeInTheDocument()
    expect(screen.queryByText('Default')).not.toBeInTheDocument()
  })
})
