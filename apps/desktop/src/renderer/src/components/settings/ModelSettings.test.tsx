import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentInfo, ModelPublic, ModelsConfigPublic, ProviderPublic } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelSettings from './ModelSettings'
import { createApiMock, type ApiMock } from '../../test/api-mock'

const provider: ProviderPublic = {
  id: 'p1',
  name: 'Acme',
  type: 'anthropic',
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

function rowFor(text: string): HTMLElement {
  const row = screen
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(text) !== null)
  if (!row) throw new Error(`Row containing ${text} not found`)
  return row
}

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock({ models: makeConfig() })
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

describe('ModelSettings', () => {
  it('loads and renders providers, models and the workspace', async () => {
    render(<ModelSettings />)

    expect((await screen.findAllByText('Acme')).length).toBeGreaterThan(0)
    expect(screen.getByText('Sonnet')).toBeInTheDocument()
    expect(screen.getByText('Opus')).toBeInTheDocument()
    expect(screen.getByText('Key configured')).toBeInTheDocument()
    expect(screen.getByTitle('Sonnet (claude-sonnet-5)')).toBeInTheDocument()
    expect(screen.getByText('/tmp/workspace')).toBeInTheDocument()
  })

  it('warns when secure storage is unavailable', async () => {
    mock = createApiMock({ models: makeConfig({ encryptionAvailable: false }) })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    render(<ModelSettings />)

    expect(
      await screen.findByText(
        'Secure storage is unavailable on this system, so API keys cannot be saved.'
      )
    ).toBeInTheDocument()
  })

  it('changes the default model', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)

    const select = await screen.findByRole('combobox', { name: 'Default model' })
    await user.click(select)
    await user.click(await screen.findByTitle('Opus (claude-opus-5)'))

    await waitFor(() =>
      expect(mock.api.models.setDefault).toHaveBeenCalledWith({
        providerId: 'p1',
        modelId: 'claude-opus-5'
      })
    )
  })

  it('adds a provider through the form', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(screen.getByRole('button', { name: '+ Add provider' }))
    await user.type(screen.getByLabelText('Name'), 'My Provider')
    await user.type(screen.getByLabelText('API key'), 'sk-test')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.addProvider).toHaveBeenCalledWith({
        name: 'My Provider',
        type: 'anthropic',
        baseURL: undefined,
        apiKey: 'sk-test'
      })
    )
  })

  it('deletes a provider after confirmation', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    const row = rowFor('Acme')
    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Delete this provider and its models?')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'OK' }))

    await waitFor(() => expect(mock.api.models.deleteProvider).toHaveBeenCalledWith('p1'))
  })

  it('adds a model through the form', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(screen.getByRole('button', { name: '+ Add model' }))
    await user.type(screen.getByLabelText('Model ID'), 'claude-new')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.addModel).toHaveBeenCalledWith({
        providerId: 'p1',
        modelId: 'claude-new',
        name: undefined
      })
    )
  })

  it('deletes a model after confirmation', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findByText('Sonnet')

    const row = rowFor('Sonnet')
    await user.click(within(row).getByRole('button', { name: 'Delete model' }))
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
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(within(rowFor('Sonnet')).getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Connection succeeded/)).toBeInTheDocument()
  })

  it('reports a failed connection test', async () => {
    vi.mocked(mock.api.models.test).mockRejectedValue(new Error('bad key'))
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(within(rowFor('Sonnet')).getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Connection failed: bad key/)).toBeInTheDocument()
  })

  it('retries after a load failure', async () => {
    vi.mocked(mock.api.models.get).mockRejectedValueOnce(new Error('offline'))
    const user = userEvent.setup()
    render(<ModelSettings />)

    expect(await screen.findByText(/Could not load the model configuration/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect((await screen.findAllByText('Acme')).length).toBeGreaterThan(0)
  })

  it('opens the workspace folder', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(screen.getByRole('button', { name: 'Open folder' }))

    expect(mock.api.workspace.open).toHaveBeenCalled()
  })
})

describe('ModelSettings edge cases', () => {
  it('maps provider delete failures', async () => {
    vi.mocked(mock.api.models.deleteProvider).mockRejectedValueOnce(new Error('PROVIDER_NOT_FOUND'))
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    const row = rowFor('Acme')
    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'OK' }))

    expect(await screen.findByText('The provider no longer exists.')).toBeInTheDocument()
  })

  it('maps model delete failures', async () => {
    vi.mocked(mock.api.models.deleteModel).mockRejectedValueOnce(new Error('MODEL_NOT_FOUND'))
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    const row = rowFor('Sonnet')
    await user.click(within(row).getByRole('button', { name: 'Delete model' }))
    await user.click(await screen.findByRole('button', { name: 'OK' }))

    expect(await screen.findByText('The model no longer exists.')).toBeInTheDocument()
  })

  it('maps default model failures', async () => {
    vi.mocked(mock.api.models.setDefault).mockRejectedValueOnce(new Error('MODEL_NOT_FOUND'))
    const user = userEvent.setup()
    render(<ModelSettings />)

    const select = await screen.findByRole('combobox', { name: 'Default model' })
    await user.click(select)
    await user.click(await screen.findByTitle('Opus (claude-opus-5)'))

    expect(await screen.findByText('The model no longer exists.')).toBeInTheDocument()
  })

  it('shows non-Error workspace failures', async () => {
    vi.mocked(mock.api.workspace.open).mockRejectedValueOnce('open failed')
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(screen.getByRole('button', { name: 'Open folder' }))

    expect(await screen.findByText('open failed')).toBeInTheDocument()
  })

  it('disables the default selector without models', async () => {
    mock = createApiMock({
      models: makeConfig({ providers: [], models: [], defaultModel: null })
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    render(<ModelSettings />)

    expect(await screen.findByText('No providers yet. Add one to get started.')).toBeInTheDocument()
    expect(screen.getByText('No models yet. Add one to get started.')).toBeInTheDocument()
    expect(screen.getByLabelText('Default model')).toBeDisabled()
  })

  it('falls back to the provider id for unknown providers', async () => {
    mock = createApiMock({
      models: makeConfig({
        models: [
          {
            id: 'm9',
            providerId: 'ghost',
            modelId: 'mystery',
            name: 'Mystery',
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ],
        defaultModel: null
      })
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    render(<ModelSettings />)

    expect(await screen.findByText('Mystery')).toBeInTheDocument()
    expect(screen.getByText('ghost')).toBeInTheDocument()
    expect(screen.getByText('No model selected')).toBeInTheDocument()
  })

  it('cancels a provider form', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(screen.getByRole('button', { name: '+ Add provider' }))
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('cancels a provider delete confirmation', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    const row = rowFor('Acme')
    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument()
    )
    expect(within(row).getByRole('button', { name: 'Edit provider' })).toBeInTheDocument()
  })

  it('edits a provider', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(within(rowFor('Acme')).getByRole('button', { name: 'Edit provider' }))
    const name = screen.getByLabelText('Name')
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

  it('resets the clear-key flag when a new key is typed', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(within(rowFor('Acme')).getByRole('button', { name: 'Edit provider' }))
    await user.click(screen.getByRole('checkbox', { name: 'Clear API key' }))
    await user.type(screen.getByLabelText('API key'), 'sk-new')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.models.updateProvider).toHaveBeenCalledWith({
        id: 'p1',
        name: 'Acme',
        type: 'anthropic',
        baseURL: '',
        clearApiKey: false,
        apiKey: 'sk-new'
      })
    )
  })

  it('cancels a model form', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(screen.getByRole('button', { name: '+ Add model' }))
    expect(screen.getByLabelText('Model ID')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Model ID')).not.toBeInTheDocument()
  })

  it('edits a model', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(within(rowFor('Sonnet')).getByRole('button', { name: 'Edit model' }))
    const name = screen.getByLabelText('Display name')
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

  it('cancels a model delete confirmation', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    const row = rowFor('Sonnet')
    await user.click(within(row).getByRole('button', { name: 'Delete model' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument()
    )
    expect(within(row).getByRole('button', { name: 'Test connection' })).toBeInTheDocument()
  })

  it('reports connection success without latency', async () => {
    vi.mocked(mock.api.models.test).mockResolvedValue({ ok: true, message: 'ok' })
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(within(rowFor('Sonnet')).getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('Connection succeeded')).toBeInTheDocument()
  })

  it('reports connection failures without a message', async () => {
    vi.mocked(mock.api.models.test).mockResolvedValue({
      ok: false,
      message: undefined as unknown as string
    })
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(within(rowFor('Sonnet')).getByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText(/Connection failed/)).toBeInTheDocument()
  })

  it('shows a placeholder when agent info is unavailable', async () => {
    vi.mocked(mock.api.agent.info).mockResolvedValue({} as unknown as AgentInfo)
    render(<ModelSettings />)

    expect(await screen.findAllByText('Acme')).not.toHaveLength(0)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('clears the default model', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)

    const select = await screen.findByRole('combobox', { name: 'Default model' })
    await user.click(select)
    await user.click(await screen.findByTitle('No model selected'))

    await waitFor(() => expect(mock.api.models.setDefault).toHaveBeenCalledWith(null))
  })

  it('renders provider base URLs and missing keys', async () => {
    mock = createApiMock({
      models: makeConfig({
        providers: [
          {
            ...provider,
            baseURL: 'https://api.example.com',
            hasApiKey: false
          }
        ],
        models: [],
        defaultModel: null
      })
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    render(<ModelSettings />)

    expect(await screen.findByText('https://api.example.com')).toBeInTheDocument()
    expect(screen.getByText('No key')).toBeInTheDocument()
  })

  it('validates required provider fields', async () => {
    const user = userEvent.setup()
    render(<ModelSettings />)
    await screen.findAllByText('Acme')

    await user.click(screen.getByRole('button', { name: '+ Add provider' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    expect(mock.api.models.addProvider).not.toHaveBeenCalled()
  })
})
