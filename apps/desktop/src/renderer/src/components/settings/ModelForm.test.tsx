import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ModelPublic, ProviderPublic } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModelForm from './ModelForm'
import { createApiMock } from '../../test/api-mock'

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

describe('ModelForm', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      value: createApiMock().api,
      configurable: true
    })
  })

  it('asks for a provider when none exist', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<ModelForm providers={[]} onSubmit={vi.fn()} onCancel={onCancel} />)

    expect(screen.getByText('Add a provider first.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('creates a model with a trimmed display name', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ModelForm providers={[provider]} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Model ID'), 'claude-new')
    await user.type(screen.getByLabelText('Display name'), '  New Model  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        providerId: 'p1',
        modelId: 'claude-new',
        name: 'New Model'
      })
    )
  })

  it('submits a model context window', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ModelForm providers={[provider]} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Model ID'), 'claude-new')
    await user.type(screen.getByLabelText('Context window'), '200000')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        providerId: 'p1',
        modelId: 'claude-new',
        name: undefined,
        contextWindow: 200_000
      })
    )
  })

  it('requires a model ID', async () => {
    const user = userEvent.setup()
    render(<ModelForm providers={[provider]} onSubmit={vi.fn()} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Model ID is required.')).toBeInTheDocument()
  })

  it('falls back to the model ID when the edited name is empty', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ModelForm model={sonnet} providers={[provider]} onSubmit={onSubmit} onCancel={vi.fn()} />
    )

    await user.clear(screen.getByLabelText('Display name'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: 'm1',
        name: 'claude-sonnet-5',
        contextWindow: null,
        maxOutputTokens: null,
        reasoning: false,
        attachment: false,
        costInput: null,
        costOutput: null,
        costCacheRead: null,
        costCacheWrite: null,
        variants: [],
        applyPatch: false,
        compaction: false
      })
    )
  })

  it('shows mapped errors returned by the API', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('MODEL_EXISTS'))
    render(<ModelForm providers={[provider]} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Model ID'), 'claude-sonnet-5')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('This model ID already exists.')).toBeInTheDocument()
  })
})

describe('model capability metadata', () => {
  it('submits capability fields', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ModelForm providers={[provider]} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Model ID'), 'claude-new')
    await user.type(screen.getByLabelText('Max output tokens'), '8192')
    await user.click(screen.getByRole('checkbox', { name: 'Reasoning model' }))
    await user.click(screen.getByRole('checkbox', { name: 'Supports attachments' }))
    await user.type(screen.getByLabelText('Input cost (USD / 1M tokens)'), '3')
    await user.type(screen.getByLabelText('Output cost (USD / 1M tokens)'), '15')
    await user.type(screen.getByLabelText('Cache read cost (USD / 1M tokens)'), '0.3')
    await user.type(screen.getByLabelText('Cache write cost (USD / 1M tokens)'), '3.75')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'claude-new',
          maxOutputTokens: 8192,
          reasoning: true,
          attachment: true,
          costInput: 3,
          costOutput: 15,
          costCacheRead: 0.3,
          costCacheWrite: 3.75
        })
      )
    )
  })

  it('submits tool and compaction capabilities', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ModelForm providers={[provider]} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Model ID'), 'claude-new')
    await user.click(screen.getByLabelText('Apply patch tool'))
    await user.click(screen.getByLabelText('Provider compaction'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        providerId: 'p1',
        modelId: 'claude-new',
        name: undefined,
        applyPatch: true,
        compaction: true
      })
    )
  })

  it('submits model variants when creating a model', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<ModelForm providers={[provider]} onSubmit={onSubmit} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Model ID'), 'claude-new')
    await user.click(screen.getByRole('button', { name: 'Add variant' }))
    await user.type(screen.getByLabelText('Variant name'), 'Fast')
    await user.type(screen.getByLabelText('Variant temperature'), '0.2')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        providerId: 'p1',
        modelId: 'claude-new',
        name: undefined,
        variants: [{ name: 'Fast', settings: { temperature: 0.2 } }]
      })
    )
  })

  it('round-trips existing variants when editing', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ModelForm
        model={{
          ...sonnet,
          variants: [
            { id: 'high', name: 'High', settings: { reasoningEffort: 'high', temperature: 1 } }
          ]
        }}
        providers={[provider]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByDisplayValue('High')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'm1',
          name: 'Sonnet',
          variants: [{ name: 'High', settings: { reasoningEffort: 'high', temperature: 1 } }]
        })
      )
    )
  })

  it('fills fields from the model catalog', async () => {
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
        costOutput: 15,
        costCacheRead: 0.3,
        costCacheWrite: 3.75
      }
    ])
    const user = userEvent.setup()
    render(<ModelForm providers={[provider]} onSubmit={vi.fn()} onCancel={vi.fn()} />)

    await user.click(await screen.findByRole('combobox', { name: 'Fill from model catalog' }))
    await user.click(await screen.findByTitle('Anthropic · Claude Sonnet 4'))

    expect(screen.getByLabelText('Model ID')).toHaveValue('claude-sonnet-4')
    expect(screen.getByLabelText('Display name')).toHaveValue('Claude Sonnet 4')
    expect(screen.getByLabelText('Context window')).toHaveValue('200000')
    expect(screen.getByLabelText('Max output tokens')).toHaveValue('64000')
    expect(screen.getByLabelText('Cache read cost (USD / 1M tokens)')).toHaveValue('0.300')
    expect(screen.getByLabelText('Cache write cost (USD / 1M tokens)')).toHaveValue('3.750')
  })
})
