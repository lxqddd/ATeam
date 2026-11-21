import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatHeader from './ChatHeader'
import type { ChatStoreState } from '../../chat/store'
import { createApiMock } from '../../test/api-mock'
import { makeMessage, makeSession, makeTextPart } from '../../test/factories'

const chatMocks = vi.hoisted(() => ({
  compactSession: vi.fn(async () => undefined),
  undoSession: vi.fn(async () => 'prompt'),
  redoSession: vi.fn(async () => undefined),
  forkSession: vi.fn(async () => undefined)
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
    agents: [],
    commands: [],
    selectedSessionId: 's1',
    messagesBySession: {},
    loadedBySession: {},
    permissions: [],
    questions: [],
    runOutcomes: {},
    backgroundResults: [],
    actionError: null,
    restarting: false,
    revertPrompt: null
  }
}

beforeEach(() => {
  storeState.current = baseState()
  chatMocks.compactSession.mockClear()
  chatMocks.compactSession.mockResolvedValue(undefined)
  chatMocks.undoSession.mockClear()
  chatMocks.undoSession.mockResolvedValue('prompt')
  chatMocks.redoSession.mockClear()
  chatMocks.redoSession.mockResolvedValue(undefined)
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

  it('compacts the selected session from the header', async () => {
    const state = baseState()
    state.messagesBySession = {
      s1: [
        makeMessage({
          id: 'm1',
          sessionId: 's1',
          role: 'user',
          parts: [makeTextPart('hello')]
        })
      ]
    }
    storeState.current = state
    const user = userEvent.setup()
    render(<ChatHeader />)

    await user.click(screen.getByRole('button', { name: 'Compact context' }))

    await waitFor(() => expect(chatMocks.compactSession).toHaveBeenCalled())
  })

  it('disables compaction while the session is running', () => {
    const state = baseState()
    state.sessions[0].status = 'running'
    state.messagesBySession = {
      s1: [makeMessage({ id: 'm1', sessionId: 's1', role: 'user', parts: [makeTextPart('hi')] })]
    }
    storeState.current = state
    render(<ChatHeader />)

    expect(screen.getByRole('button', { name: 'Compact context' })).toBeDisabled()
  })

  it('undoes the last turn from the header', async () => {
    const state = baseState()
    state.messagesBySession = {
      s1: [
        makeMessage({ id: 'u1', sessionId: 's1', role: 'user', parts: [makeTextPart('hi')] }),
        makeMessage({
          id: 'a1',
          sessionId: 's1',
          role: 'assistant',
          parts: [makeTextPart('hello')],
          snapshotBefore: 'snap-1'
        })
      ]
    }
    storeState.current = state
    const user = userEvent.setup()
    render(<ChatHeader />)

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(chatMocks.undoSession).toHaveBeenCalled())
  })

  it('redoes a staged undo', async () => {
    const state = baseState()
    state.sessions[0].redoAvailable = true
    storeState.current = state
    const user = userEvent.setup()
    render(<ChatHeader />)

    await user.click(screen.getByRole('button', { name: 'Redo' }))

    await waitFor(() => expect(chatMocks.redoSession).toHaveBeenCalled())
  })

  it('disables undo and redo while the session is running', () => {
    const state = baseState()
    state.sessions[0].status = 'running'
    state.sessions[0].redoAvailable = true
    storeState.current = state
    render(<ChatHeader />)

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })

  it('undoes and redoes with keyboard shortcuts', async () => {
    const state = baseState()
    state.sessions[0].redoAvailable = true
    state.messagesBySession = {
      s1: [
        makeMessage({
          id: 'a1',
          sessionId: 's1',
          role: 'assistant',
          parts: [makeTextPart('hi')],
          snapshotBefore: 'snap-1'
        })
      ]
    }
    storeState.current = state
    render(<ChatHeader />)

    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    await waitFor(() => expect(chatMocks.undoSession).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled())

    fireEvent.keyDown(document, { key: 'z', metaKey: true, shiftKey: true })
    await waitFor(() => expect(chatMocks.redoSession).toHaveBeenCalled())
  })

  it('shows the context usage', () => {
    const state = baseState()
    state.sessions[0].contextTokens = 12_300
    state.sessions[0].contextWindow = 128_000
    storeState.current = state
    render(<ChatHeader />)

    expect(screen.getByText('12.3k / 128.0k')).toBeInTheDocument()
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

describe('session experience', () => {
  it('forks the selected session', async () => {
    chatMocks.forkSession.mockClear()
    const user = userEvent.setup()
    render(<ChatHeader />)

    await user.click(screen.getByRole('button', { name: 'Fork session' }))

    await waitFor(() => expect(chatMocks.forkSession).toHaveBeenCalled())
  })

  it('shows session cost and the context progress bar', () => {
    const state = baseState()
    state.sessions[0].contextTokens = 32_000
    state.sessions[0].contextWindow = 128_000
    state.messagesBySession = {
      s1: [makeMessage({ role: 'assistant', parts: [], costUsd: 0.000069 })]
    }
    storeState.current = state

    render(<ChatHeader />)

    expect(screen.getByText('$0.000069')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Context usage' })).toHaveAttribute(
      'aria-valuenow',
      '25'
    )
  })
})
