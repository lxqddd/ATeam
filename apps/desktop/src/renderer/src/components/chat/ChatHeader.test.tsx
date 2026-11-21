import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatHeader from './ChatHeader'
import type { ChatStoreState } from '../../chat/store'
import { makeSession } from '../../test/factories'

const chatMocks = vi.hoisted(() => ({
  ensureSession: vi.fn(async () => ({ id: 's1' })),
  setSessionModel: vi.fn(async () => undefined)
}))

const storeState = vi.hoisted(() => ({ current: {} as unknown }))

vi.mock('../../chat/store', () => ({
  chatStore: chatMocks,
  useChatStore: () => storeState.current
}))

function baseState(): ChatStoreState {
  return {
    status: { status: 'ready' },
    info: null,
    models: {
      providers: [
        {
          id: 'p1',
          name: 'Anthropic',
          type: 'anthropic',
          hasApiKey: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      models: [
        {
          id: 'm1',
          providerId: 'p1',
          modelId: 'claude-sonnet-5',
          name: 'Claude Sonnet',
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'm2',
          providerId: 'p1',
          modelId: 'claude-opus-5',
          name: 'Claude Opus',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      defaultModel: { providerId: 'p1', modelId: 'claude-sonnet-5' },
      encryptionAvailable: true
    },
    sessions: [
      makeSession({
        id: 's1',
        title: 'Chat',
        model: { providerId: 'p1', modelId: 'claude-sonnet-5' }
      })
    ],
    selectedSessionId: 's1',
    messagesBySession: {},
    loadedBySession: {},
    permissions: [],
    runOutcomes: {},
    actionError: null,
    restarting: false
  }
}

beforeEach(() => {
  storeState.current = baseState()
  chatMocks.ensureSession.mockClear()
  chatMocks.ensureSession.mockResolvedValue({ id: 's1' })
  chatMocks.setSessionModel.mockClear()
  chatMocks.setSessionModel.mockResolvedValue(undefined)
})

describe('ChatHeader', () => {
  it('shows the current session model', () => {
    render(<ChatHeader />)

    expect(screen.getByRole('button', { name: /Claude Sonnet/ })).toBeInTheDocument()
  })

  it('switches the session model from the header picker', async () => {
    const user = userEvent.setup()
    render(<ChatHeader />)

    await user.click(screen.getByRole('button', { name: /Claude Sonnet/ }))
    await user.click(screen.getByRole('option', { name: /Claude Opus/ }))

    await waitFor(() =>
      expect(chatMocks.setSessionModel).toHaveBeenCalledWith('s1', {
        providerId: 'p1',
        modelId: 'claude-opus-5'
      })
    )
  })

  it('disables the picker when the agent is not ready', () => {
    storeState.current = { ...baseState(), status: { status: 'stopped' } }
    render(<ChatHeader />)

    expect(screen.getByRole('button', { name: /Claude Sonnet/ })).toBeDisabled()
  })
})
