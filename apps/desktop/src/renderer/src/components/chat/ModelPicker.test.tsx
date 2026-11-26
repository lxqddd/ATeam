import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ModelsConfigPublic } from '@ateam/shared'
import ModelPicker from './ModelPicker'

const createdAt = '2026-01-01T00:00:00.000Z'

function open(models: ModelsConfigPublic): Promise<void> {
  render(<ModelPicker models={models} value={null} onChange={vi.fn()} />)
  return userEvent.setup().click(screen.getByRole('button'))
}

describe('ModelPicker', () => {
  it('badges project providers', async () => {
    await open({
      providers: [
        {
          id: 'local',
          name: 'Local',
          type: 'openai-compatible',
          hasApiKey: true,
          createdAt,
          updatedAt: createdAt,
          source: 'config'
        }
      ],
      models: [
        {
          id: 'config:local:m',
          providerId: 'local',
          modelId: 'm',
          name: 'Local Model',
          createdAt,
          source: 'config'
        }
      ],
      defaultModel: null
    })

    expect(screen.getByText('Local Model')).toBeInTheDocument()
    expect(screen.getAllByText('Project')).toHaveLength(1)
  })

  it('badges a project override on a global provider', async () => {
    await open({
      providers: [
        {
          id: 'p1',
          name: 'Anthropic',
          type: 'anthropic',
          hasApiKey: true,
          createdAt,
          updatedAt: createdAt
        }
      ],
      models: [
        {
          id: 'm1',
          providerId: 'p1',
          modelId: 'claude-x',
          name: 'Claude X',
          createdAt,
          source: 'config'
        }
      ],
      defaultModel: null
    })

    expect(screen.getByText('Project')).toBeInTheDocument()
  })
})
