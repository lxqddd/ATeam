import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatHeader from './ChatHeader'
import type { ChatStoreState } from '../../chat/store'
import { createApiMock } from '../../test/api-mock'
import { makeSession } from '../../test/factories'

const storeState = vi.hoisted(() => ({ current: {} as unknown }))

vi.mock('../../chat/store', () => ({
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
  Object.defineProperty(window, 'api', { value: createApiMock().api, configurable: true })
})

describe('ChatHeader', () => {
  it('renders the session title and status', () => {
    const state = baseState()
    state.sessions[0].status = 'running'
    storeState.current = state

    render(<ChatHeader />)

    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
  })

  it('does not render a model picker', () => {
    render(<ChatHeader />)

    expect(screen.queryByRole('button', { name: /Claude/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('opens the workspace from the header', async () => {
    const mock = createApiMock()
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    const user = userEvent.setup()
    render(<ChatHeader />)

    await user.click(screen.getByRole('button', { name: 'Open workspace' }))

    expect(mock.api.workspace.open).toHaveBeenCalled()
  })
})
