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
      expect(onSubmit).toHaveBeenCalledWith({ id: 'm1', name: 'claude-sonnet-5' })
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
