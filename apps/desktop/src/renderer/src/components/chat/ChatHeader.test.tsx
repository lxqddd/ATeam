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
  forkSession: vi.fn(async () => undefined),
  setSessionDirectory: vi.fn(async () => undefined),
  openSessionChanges: vi.fn(),
  openGitChanges: vi.fn()
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
      defaultModel: { providerId: 'p1', modelId: 'claude-sonnet-5' }
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
    queuesBySession: {},
    permissions: [],
    questions: [],
    runOutcomes: {},
    backgroundTasksBySession: {},
    subagentResults: [],
    actionError: null,
    restarting: false,
    revertPrompt: null,
    changesPanel: null,
    configRevision: 0
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
  chatMocks.setSessionDirectory.mockClear()
  chatMocks.setSessionDirectory.mockResolvedValue(undefined)
  chatMocks.openSessionChanges.mockClear()
  chatMocks.openGitChanges.mockClear()
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

  it('opens the session-wide change summary', async () => {
    const state = baseState()
    state.messagesBySession = { s1: [makeMessage({ id: 'm1' })] }
    storeState.current = state

    render(<ChatHeader />)

    await userEvent.click(screen.getByRole('button', { name: 'View session changes' }))

    expect(chatMocks.openSessionChanges).toHaveBeenCalledWith('s1')
  })

  it('opens the workspace Git changes without requiring messages', async () => {
    render(<ChatHeader />)

    await userEvent.click(screen.getByRole('button', { name: 'View workspace Git changes' }))

    expect(chatMocks.openGitChanges).toHaveBeenCalledWith('s1')
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
          parts: [{ type: 'snapshot', snapshot: 'snap-1' }, makeTextPart('hello')]
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
          parts: [{ type: 'snapshot', snapshot: 'snap-1' }, makeTextPart('hi')]
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

  it('switches the session working directory from the header', async () => {
    const state = baseState()
    state.info = {
      workspacePath: '/tmp/workspace',
      appVersion: '0.1.0',
      instructionFiles: [],
      lspServers: [],
      formatters: []
    }
    state.sessions[0].directory = '/tmp/project'
    state.sessions.push(makeSession({ id: 's2', title: 'Other', directory: '/tmp/other-project' }))
    storeState.current = state
    const user = userEvent.setup()
    render(<ChatHeader />)

    expect(screen.getByText('project')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Working directory' }))
    await user.click(screen.getByTitle('/tmp/other-project'))

    await waitFor(() =>
      expect(chatMocks.setSessionDirectory).toHaveBeenCalledWith('s1', '/tmp/other-project')
    )
  })

  it('picks a working directory with the native dialog', async () => {
    const state = baseState()
    state.info = {
      workspacePath: '/tmp/workspace',
      appVersion: '0.1.0',
      instructionFiles: [],
      lspServers: [],
      formatters: []
    }
    state.sessions[0].directory = '/tmp/project'
    storeState.current = state
    const mock = createApiMock()
    vi.mocked(mock.api.workspace.pickDirectory).mockResolvedValueOnce('/tmp/picked')
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    const user = userEvent.setup()
    render(<ChatHeader />)

    await user.click(screen.getByRole('button', { name: 'Working directory' }))
    await user.click(screen.getByText('Choose folder…'))

    await waitFor(() =>
      expect(chatMocks.setSessionDirectory).toHaveBeenCalledWith('s1', '/tmp/picked')
    )
    expect(mock.api.workspace.pickDirectory).toHaveBeenCalledWith('/tmp/project')
  })

  it('disables workspace switching while the session is running', () => {
    const state = baseState()
    state.info = {
      workspacePath: '/tmp/workspace',
      appVersion: '0.1.0',
      instructionFiles: [],
      lspServers: [],
      formatters: []
    }
    state.sessions[0].directory = '/tmp/project'
    state.sessions[0].status = 'running'
    storeState.current = state
    render(<ChatHeader />)

    expect(screen.getByRole('button', { name: 'Working directory' })).toBeDisabled()
  })

  it('closes the workspace menu when the selected session changes', async () => {
    const state = baseState()
    state.info = {
      workspacePath: '/tmp/workspace',
      appVersion: '0.1.0',
      instructionFiles: [],
      lspServers: [],
      formatters: []
    }
    state.sessions[0].directory = '/tmp/project'
    storeState.current = state
    const user = userEvent.setup()
    const { rerender } = render(<ChatHeader />)

    await user.click(screen.getByRole('button', { name: 'Working directory' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    const next = baseState()
    next.info = state.info
    next.sessions = [makeSession({ id: 's2', title: 'Other', directory: '/tmp/other' })]
    next.selectedSessionId = 's2'
    storeState.current = next
    rerender(<ChatHeader />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    storeState.current = state
    rerender(<ChatHeader />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('labels a root workspace directory', () => {
    const state = baseState()
    state.info = {
      workspacePath: '/tmp/workspace',
      appVersion: '0.1.0',
      instructionFiles: [],
      lspServers: [],
      formatters: []
    }
    state.sessions[0].directory = '/'
    storeState.current = state

    render(<ChatHeader />)

    expect(screen.getByRole('button', { name: 'Working directory' })).toHaveTextContent('/')
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

  it('opens the session plan file', async () => {
    const mock = createApiMock()
    vi.mocked(mock.api.agent.sessions.plan).mockResolvedValue({
      path: '.ateam/plans/s1.md',
      absolutePath: '/workspace/.ateam/plans/s1.md',
      exists: true,
      content: '# Plan\n\nStep one.'
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
    const user = userEvent.setup()

    render(<ChatHeader />)

    await user.click(await screen.findByRole('button', { name: 'Plan' }))

    expect(await screen.findByRole('dialog', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByText('.ateam/plans/s1.md')).toBeInTheDocument()
    expect(screen.getByText(/# Plan[\s\S]*Step one\./)).toBeInTheDocument()
  })
})
