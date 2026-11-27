import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Composer from './Composer'
import type { ChatStoreState } from '../../chat/store'
import { createApiMock, type ApiMock } from '../../test/api-mock'
import { makeSession } from '../../test/factories'

const chatMocks = vi.hoisted(() => ({
  send: vi.fn(async () => undefined),
  steer: vi.fn(async (text: string, strategy: string) => ({
    id: 'queued-1',
    sessionId: 's1',
    text,
    strategy,
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z'
  })),
  removeQueued: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  ensureSession: vi.fn(),
  setSessionModel: vi.fn(async () => undefined),
  setSessionSettings: vi.fn(async () => undefined),
  setSessionAgent: vi.fn(async () => undefined),
  runCommand: vi.fn(async () => undefined),
  clearRevertPrompt: vi.fn()
}))

const storeState = vi.hoisted(() => ({ current: {} as unknown }))

let api: ApiMock

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
          modelId: 'claude-x',
          name: 'Claude X',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      defaultModel: { providerId: 'p1', modelId: 'claude-x' }
    },
    sessions: [makeSession({ id: 's1', title: 'Chat' })],
    agents: [
      {
        id: 'build',
        name: 'build',
        description: 'General coding agent with the full toolset.',
        mode: 'primary' as const,
        model: null,
        tools: null,
        permissions: [],
        temperature: null,
        maxSteps: null,
        prompt: '',
        source: 'builtin' as const
      },
      {
        id: 'plan',
        name: 'plan',
        description: 'Read-only planning agent.',
        mode: 'primary' as const,
        model: null,
        tools: ['read', 'list', 'grep', 'glob'],
        permissions: [],
        temperature: null,
        maxSteps: 20,
        prompt: 'You are the plan agent.',
        source: 'builtin' as const
      }
    ],
    selectedSessionId: 's1',
    commands: [
      {
        id: 'review',
        name: 'review',
        description: 'Review changes',
        template: 'Review $ARGUMENTS',
        agent: null,
        model: null,
        source: 'project' as const
      }
    ],
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
    draftPrompt: null,
    changesPanel: null,
    configRevision: 0
  }
}

function renderComposer(): void {
  render(
    <MemoryRouter>
      <Composer />
    </MemoryRouter>
  )
}

beforeEach(() => {
  storeState.current = baseState()
  api = createApiMock()
  Object.defineProperty(window, 'api', { value: api.api, configurable: true })
  chatMocks.send.mockClear()
  chatMocks.send.mockResolvedValue(undefined)
  chatMocks.steer.mockClear()
  chatMocks.removeQueued.mockClear()
  chatMocks.stop.mockClear()
  chatMocks.ensureSession.mockReset()
  chatMocks.setSessionModel.mockReset()
  chatMocks.setSessionSettings.mockReset()
  chatMocks.setSessionAgent.mockReset()
  chatMocks.runCommand.mockClear()
  chatMocks.clearRevertPrompt.mockClear()
})

describe('Composer', () => {
  it('disables sending for empty input and clears after a send', async () => {
    const user = userEvent.setup()
    renderComposer()

    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, 'hello')
    expect(send).toBeEnabled()

    await user.click(send)

    await waitFor(() =>
      expect(chatMocks.send).toHaveBeenCalledWith('hello', [], {
        providerId: 'p1',
        modelId: 'claude-x'
      })
    )
    await waitFor(() => expect(textarea).toHaveValue(''))
  })

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const user = userEvent.setup()
    renderComposer()
    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })

    await user.type(textarea, 'first{Enter}')
    await waitFor(() =>
      expect(chatMocks.send).toHaveBeenCalledWith('first', [], {
        providerId: 'p1',
        modelId: 'claude-x'
      })
    )

    await user.type(textarea, 'line1{Shift>}{Enter}{/Shift}line2')
    expect(chatMocks.send).toHaveBeenCalledTimes(1)
    expect(textarea).toHaveValue('line1\nline2')
  })

  it('does not send while an IME composition is active', async () => {
    renderComposer()
    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })

    fireEvent.change(textarea, { target: { value: 'こんにちは' } })
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })

    expect(chatMocks.send).not.toHaveBeenCalled()
  })

  it('shows a stop button while the session is running', async () => {
    const state = baseState()
    state.sessions[0].status = 'running'
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(chatMocks.stop).toHaveBeenCalled()
  })

  it('queues the message after the current step while running', async () => {
    const state = baseState()
    state.sessions[0].status = 'running'
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    await user.type(screen.getByRole('textbox', { name: 'Message ATeam…' }), '补充要求')
    await user.click(screen.getByRole('button', { name: 'Queue message' }))

    await waitFor(() => expect(chatMocks.steer).toHaveBeenCalledWith('补充要求', 'after-step', []))
    expect(chatMocks.send).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Message ATeam…' })).toHaveValue('')
  })

  it('interrupts the run on Ctrl+Enter while running', async () => {
    const state = baseState()
    state.sessions[0].status = 'running'
    storeState.current = state
    renderComposer()
    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })

    fireEvent.change(textarea, { target: { value: '马上改' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(chatMocks.steer).toHaveBeenCalledWith('马上改', 'interrupt', []))
    expect(chatMocks.send).not.toHaveBeenCalled()
  })

  it('lists queued messages and removes or edits them', async () => {
    const state = baseState()
    state.sessions[0].status = 'running'
    state.queuesBySession = {
      s1: [
        {
          id: 'q1',
          sessionId: 's1',
          text: '排队一',
          strategy: 'after-step',
          attachments: [],
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        {
          id: 'q2',
          sessionId: 's1',
          text: '排队二',
          strategy: 'interrupt',
          attachments: [],
          createdAt: '2026-01-01T00:00:01.000Z'
        }
      ]
    }
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    expect(screen.getByTestId('composer-queue')).toBeInTheDocument()
    expect(screen.getByText('排队一')).toBeInTheDocument()
    expect(screen.getByText('Interrupt')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Remove from queue' })[0])
    await waitFor(() => expect(chatMocks.removeQueued).toHaveBeenCalledWith('s1', 'q1'))

    await user.click(screen.getByRole('button', { name: '排队二' }))
    await waitFor(() => expect(chatMocks.removeQueued).toHaveBeenCalledWith('s1', 'q2'))
    expect(screen.getByRole('textbox', { name: 'Message ATeam…' })).toHaveValue('排队二')
  })

  it('shows a hint and disables input without models', () => {
    const state = baseState()
    state.models = {
      providers: [],
      models: [],
      defaultModel: null
    }
    storeState.current = state
    renderComposer()

    expect(screen.getAllByText('No model configured').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Configure models' })).toHaveAttribute(
      'href',
      '/models'
    )
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('disables input when the agent is not ready', () => {
    const state = baseState()
    state.status = { status: 'stopped' }
    storeState.current = state
    renderComposer()

    expect(screen.getByRole('textbox', { name: 'Message ATeam…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('shows the busy error and keeps the text when sending fails', async () => {
    chatMocks.send.mockRejectedValueOnce(
      new Error("Error invoking remote method 'ateam:agent:chat:send': Error: SESSION_BUSY")
    )
    const user = userEvent.setup()
    renderComposer()
    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })

    await user.type(textarea, 'hello{Enter}')

    expect(await screen.findByText('This chat is already running.')).toBeInTheDocument()
    expect(textarea).toHaveValue('hello')
  })

  it('requires a selected model before sending', async () => {
    const state = baseState()
    state.models = {
      providers: state.models?.providers ?? [],
      models: state.models?.models ?? [],
      defaultModel: null
    }
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    await user.type(screen.getByRole('textbox', { name: 'Message ATeam…' }), 'hello{Enter}')

    expect(await screen.findByText('Select a model first.')).toBeInTheDocument()
    expect(chatMocks.send).not.toHaveBeenCalled()
  })

  it('reports the missing model when sending without any models', () => {
    const state = baseState()
    state.models = { providers: [], models: [], defaultModel: null }
    storeState.current = state
    renderComposer()
    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })

    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(screen.getAllByText('No model configured').length).toBeGreaterThanOrEqual(2)
    expect(chatMocks.send).not.toHaveBeenCalled()
  })

  it('reports the stopped agent when sending is attempted', () => {
    const state = baseState()
    storeState.current = state
    const { rerender } = render(
      <MemoryRouter>
        <Composer />
      </MemoryRouter>
    )
    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    fireEvent.change(textarea, { target: { value: 'hello' } })

    storeState.current = { ...state, status: { status: 'stopped' } }
    rerender(
      <MemoryRouter>
        <Composer />
      </MemoryRouter>
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message ATeam…' }), { key: 'Enter' })

    expect(
      screen.getByText('The agent is not running. Past messages are still available.')
    ).toBeInTheDocument()
    expect(chatMocks.send).not.toHaveBeenCalled()
  })

  it('shows the starting placeholder while the agent starts', () => {
    const state = baseState()
    state.status = { status: 'starting' }
    storeState.current = state
    renderComposer()

    expect(screen.getByRole('textbox', { name: 'Message ATeam…' })).toHaveAttribute(
      'placeholder',
      'Agent is starting…'
    )
  })

  it('treats a missing model config as no models', () => {
    const state = baseState()
    state.models = null
    storeState.current = state
    renderComposer()

    expect(screen.getAllByText('No model configured').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('shows non-Error send failures', async () => {
    chatMocks.send.mockRejectedValueOnce('raw failure')
    const user = userEvent.setup()
    renderComposer()

    await user.type(screen.getByRole('textbox', { name: 'Message ATeam…' }), 'hello{Enter}')

    expect(await screen.findByText('raw failure')).toBeInTheDocument()
  })

  it('changes the session model from the picker', async () => {
    chatMocks.ensureSession.mockResolvedValue({ id: 's1' })
    chatMocks.setSessionModel.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole('button', { name: /Claude X/ }))
    await user.click(screen.getByRole('option', { name: /Claude X/ }))

    await waitFor(() =>
      expect(chatMocks.setSessionModel).toHaveBeenCalledWith('s1', {
        providerId: 'p1',
        modelId: 'claude-x'
      })
    )
  })

  it('shows errors when changing the model fails', async () => {
    chatMocks.ensureSession.mockRejectedValue(new Error('ensure failed'))
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole('button', { name: /Claude X/ }))
    await user.click(screen.getByRole('option', { name: /Claude X/ }))

    expect(await screen.findByText('ensure failed')).toBeInTheDocument()
  })

  it('shows the session reasoning effort and permission mode', () => {
    const state = baseState()
    state.sessions[0] = makeSession({
      id: 's1',
      title: 'Chat',
      reasoningEffort: 'high',
      permissionMode: 'plan'
    })
    storeState.current = state
    renderComposer()

    expect(screen.getByRole('button', { name: 'Reasoning effort: High' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Permission mode: Read only' })).toBeInTheDocument()
  })

  it('changes the reasoning effort from the composer', async () => {
    chatMocks.ensureSession.mockResolvedValue({ id: 's1' })
    chatMocks.setSessionSettings.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole('button', { name: 'Reasoning effort: Default' }))
    await user.click(screen.getByRole('option', { name: 'High' }))

    await waitFor(() =>
      expect(chatMocks.setSessionSettings).toHaveBeenCalledWith('s1', {
        reasoningEffort: 'high',
        permissionMode: 'ask'
      })
    )
  })

  it('changes the permission mode from the composer', async () => {
    chatMocks.ensureSession.mockResolvedValue({ id: 's1' })
    chatMocks.setSessionSettings.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole('button', { name: 'Permission mode: Ask each time' }))
    await user.click(screen.getByRole('option', { name: /Auto edit files/ }))

    await waitFor(() =>
      expect(chatMocks.setSessionSettings).toHaveBeenCalledWith('s1', {
        reasoningEffort: null,
        permissionMode: 'acceptEdits'
      })
    )
  })

  it('restores a reverted prompt into the composer', async () => {
    const state = baseState()
    state.revertPrompt = 'please try again'
    storeState.current = state
    renderComposer()

    expect(screen.getByRole('textbox', { name: 'Message ATeam…' })).toHaveValue('please try again')
    await waitFor(() => expect(chatMocks.clearRevertPrompt).toHaveBeenCalled())
  })

  it('shows errors when changing session settings fails', async () => {
    chatMocks.ensureSession.mockRejectedValue(new Error('settings failed'))
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole('button', { name: 'Reasoning effort: Default' }))
    await user.click(screen.getByRole('option', { name: 'High' }))

    expect(await screen.findByText('settings failed')).toBeInTheDocument()
  })

  it('ignores Enter with empty input', () => {
    renderComposer()
    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(chatMocks.send).not.toHaveBeenCalled()
  })

  it('maps AGENT_NOT_READY failures', async () => {
    chatMocks.send.mockRejectedValueOnce(new Error('AGENT_NOT_READY'))
    const user = userEvent.setup()
    renderComposer()

    await user.type(screen.getByRole('textbox', { name: 'Message ATeam…' }), 'hello{Enter}')

    expect(
      await screen.findByText('The agent is not running. Past messages are still available.')
    ).toBeInTheDocument()
  })

  it('shows stop failures', async () => {
    const state = baseState()
    state.sessions[0].status = 'running'
    storeState.current = state
    chatMocks.stop.mockRejectedValueOnce(new Error('stop failed'))
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('stop failed')).toBeInTheDocument()
  })

  it('switches the session agent', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole('button', { name: 'Agent: Build' }))
    await user.click(await screen.findByRole('option', { name: /^Plan/ }))

    await waitFor(() => expect(chatMocks.setSessionAgent).toHaveBeenCalledWith('s1', 'plan'))
  })

  it('attaches files and sends them with the message', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const user = userEvent.setup()
    renderComposer()

    await user.upload(
      screen.getByLabelText('Choose files'),
      new File(['hello'], 'notes.txt', { type: 'text/plain' })
    )
    expect(await screen.findByText('notes.txt')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Message ATeam…' }), 'see attached')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(chatMocks.send).toHaveBeenCalledWith(
        'see attached',
        [expect.objectContaining({ name: 'notes.txt', kind: 'text' })],
        { providerId: 'p1', modelId: 'claude-x' }
      )
    )
    expect(api.api.agent.attachments.import).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ name: 'notes.txt' })
    )
  })

  it('removes staged attachments', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const user = userEvent.setup()
    renderComposer()

    await user.upload(
      screen.getByLabelText('Choose files'),
      new File(['hello'], 'notes.txt', { type: 'text/plain' })
    )
    await screen.findByText('notes.txt')
    await user.click(screen.getByRole('button', { name: 'Remove attachment: notes.txt' }))

    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
    expect(api.api.agent.attachments.remove).toHaveBeenCalled()
  })

  it('shows attachment import errors', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    vi.mocked(api.api.agent.attachments.import).mockRejectedValue(
      new Error('Attachment is too large')
    )
    const user = userEvent.setup()
    renderComposer()

    await user.upload(
      screen.getByLabelText('Choose files'),
      new File(['hello'], 'big.txt', { type: 'text/plain' })
    )

    expect(await screen.findByText('Attachment is too large')).toBeInTheDocument()
    expect(screen.queryByText('big.txt')).not.toBeInTheDocument()
  })

  it('inserts @ file references from search results', async () => {
    vi.mocked(api.api.agent.files.search).mockResolvedValue(['src/main/index.ts'])
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '@src')
    await user.click(await screen.findByRole('option', { name: 'src/main/index.ts' }))

    expect(textarea).toHaveValue('@src/main/index.ts ')
    expect(api.api.agent.files.search).toHaveBeenCalledWith('src', undefined)
  })

  it('offers reference aliases for an empty @ query', async () => {
    vi.mocked(api.api.agent.files.search).mockResolvedValue(['docs/'])
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '@')
    await user.click(await screen.findByRole('option', { name: 'docs/' }))

    expect(textarea).toHaveValue('@docs/')
    expect(api.api.agent.files.search).toHaveBeenCalledWith('', undefined)
  })

  it('inserts commands from the slash menu', async () => {
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/rev')
    await user.click(await screen.findByRole('option', { name: /^review/ }))

    expect(textarea).toHaveValue('/review ')
  })

  it('navigates command suggestions with arrow keys', async () => {
    const state = baseState()
    state.commands = [
      ...state.commands,
      {
        id: 'test',
        name: 'test',
        description: 'Run tests',
        template: 'Run tests',
        agent: null,
        model: null,
        source: 'project'
      }
    ]
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/')
    await screen.findByRole('option', { name: /^review/ })
    await user.keyboard('{ArrowDown}{Enter}')

    expect(textarea).toHaveValue('/test ')
  })

  it('expands commands with arguments when sending', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/review src/a.ts')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(chatMocks.send).toHaveBeenCalledWith('Review src/a.ts', [], null))
  })

  it('expands command names containing dots', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const state = baseState() as ChatStoreState
    state.commands = [
      {
        id: 'deploy-prod',
        name: 'deploy.prod',
        description: 'Deploy',
        template: 'Deploy $ARGUMENTS',
        agent: null,
        model: null,
        source: 'project'
      }
    ]
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/deploy.prod now')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(chatMocks.send).toHaveBeenCalledWith('Deploy now', [], null))
  })

  it('applies the agent and model bound to a command', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const state = baseState() as ChatStoreState
    state.commands = [
      {
        id: 'review',
        name: 'review',
        description: 'Review changes',
        template: 'Review $ARGUMENTS',
        agent: 'plan',
        model: { providerId: 'p1', modelId: 'claude-x' },
        source: 'project'
      }
    ]
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/review src/a.ts')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(chatMocks.send).toHaveBeenCalledWith('Review src/a.ts', [], null))
    expect(chatMocks.setSessionAgent).toHaveBeenCalledWith('s1', 'plan')
    expect(chatMocks.setSessionModel).toHaveBeenCalledWith('s1', {
      providerId: 'p1',
      modelId: 'claude-x'
    })
  })

  it('shows the command source badge in the menu', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.type(screen.getByRole('textbox', { name: 'Message ATeam…' }), '/')

    const option = await screen.findByRole('option', { name: /^review/ })
    expect(option).toHaveTextContent('Project')
  })

  it('runs subtask commands through the store without sending', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const state = baseState() as ChatStoreState
    state.commands = [
      {
        id: 'review',
        name: 'review',
        description: 'Review changes',
        template: 'Review $ARGUMENTS in a hidden session.',
        agent: null,
        model: null,
        source: 'builtin',
        subtask: true
      }
    ]
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/review HEAD~1')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(chatMocks.runCommand).toHaveBeenCalledWith('review', 'HEAD~1'))
    expect(chatMocks.send).not.toHaveBeenCalled()
    expect(api.api.agent.commands.expand).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('')
  })

  it('rejects attachments for subtask commands', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const state = baseState() as ChatStoreState
    state.commands = [
      {
        id: 'review',
        name: 'review',
        description: 'Review changes',
        template: 'Review $ARGUMENTS',
        agent: null,
        model: null,
        source: 'builtin',
        subtask: true
      }
    ]
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    await user.upload(
      screen.getByLabelText('Choose files'),
      new File(['hello'], 'notes.txt', { type: 'text/plain' })
    )
    await screen.findByText('notes.txt')
    await user.type(screen.getByRole('textbox', { name: 'Message ATeam…' }), '/review')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(
      await screen.findByText('Subtask commands do not accept attachments.')
    ).toBeInTheDocument()
    expect(chatMocks.runCommand).not.toHaveBeenCalled()
    expect(chatMocks.send).not.toHaveBeenCalled()
  })

  it('starts subtask commands while the session is running', async () => {
    const state = baseState() as ChatStoreState
    state.sessions[0].status = 'running'
    state.commands = [
      {
        id: 'review',
        name: 'review',
        description: 'Review changes',
        template: 'Review $ARGUMENTS',
        agent: null,
        model: null,
        source: 'builtin',
        subtask: true
      }
    ]
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    await user.type(screen.getByRole('textbox', { name: 'Message ATeam…' }), '/review')
    await user.click(screen.getByRole('button', { name: 'Queue message' }))

    await waitFor(() => expect(chatMocks.runCommand).toHaveBeenCalledWith('review', ''))
    expect(chatMocks.steer).not.toHaveBeenCalled()
  })

  it('confirms shell snippets before running a subtask command', async () => {
    const state = baseState() as ChatStoreState
    state.commands = [
      {
        id: 'review',
        name: 'review',
        description: 'Review changes',
        template: 'Review:\n!`git diff --stat`',
        agent: null,
        model: null,
        source: 'builtin',
        subtask: true
      }
    ]
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/review HEAD~1')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('git diff --stat')
    expect(chatMocks.runCommand).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Run command' }))

    await waitFor(() => expect(chatMocks.runCommand).toHaveBeenCalledWith('review', 'HEAD~1'))
    expect(api.api.agent.commands.expand).not.toHaveBeenCalled()
    expect(chatMocks.send).not.toHaveBeenCalled()
  })

  it('shows an error instead of sending an unexpanded shell snippet', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const state = baseState() as ChatStoreState
    state.commands = [
      {
        id: 'recent',
        name: 'recent',
        description: 'Recent commits',
        template: 'Recent:\n!`git log`',
        agent: null,
        model: null,
        source: 'project'
      }
    ]
    storeState.current = state
    vi.mocked(api.api.agent.commands.expand).mockRejectedValueOnce(new Error('expand failed'))
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/recent')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(await screen.findByRole('button', { name: 'Run command' }))

    expect(await screen.findByText('expand failed')).toBeInTheDocument()
    expect(chatMocks.send).not.toHaveBeenCalled()
  })

  it('expands MCP prompt commands', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const state = baseState() as ChatStoreState
    state.sessions[0].directory = '/tmp/project'
    state.commands = [
      {
        id: 'mcp:docs:search',
        name: 'search',
        description: 'MCP · docs · Search docs',
        template: '',
        agent: null,
        model: null,
        mcp: { server: 'docs', prompt: 'search', arguments: ['query'] },
        source: 'mcp'
      }
    ]
    storeState.current = state
    vi.mocked(api.api.agent.mcp.prompt).mockResolvedValueOnce('Search results for electron')
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/search electron')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(chatMocks.send).toHaveBeenCalledWith('Search results for electron', [], null)
    )
    expect(api.api.agent.mcp.prompt).toHaveBeenCalledWith(
      'docs',
      'search',
      { query: 'electron' },
      '/tmp/project'
    )
  })

  it('passes quoted MCP prompt arguments intact', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const state = baseState() as ChatStoreState
    state.commands = [
      {
        id: 'mcp:docs:search',
        name: 'search',
        description: 'MCP · docs · Search docs',
        template: '',
        agent: null,
        model: null,
        mcp: {
          server: 'docs',
          prompt: 'search',
          arguments: ['query', 'scope']
        },
        source: 'mcp'
      }
    ]
    storeState.current = state
    vi.mocked(api.api.agent.mcp.prompt).mockResolvedValueOnce('Search results')
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/search "two words" src')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() =>
      expect(api.api.agent.mcp.prompt).toHaveBeenCalledWith(
        'docs',
        'search',
        { query: 'two words', scope: 'src' },
        undefined
      )
    )
  })

  it('expands shell snippets through the agent process', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const state = baseState() as ChatStoreState
    state.commands = [
      {
        id: 'recent',
        name: 'recent',
        description: 'Recent commits',
        template: 'Recent:\n!`git log --oneline -1`',
        agent: null,
        model: null,
        source: 'project'
      }
    ]
    storeState.current = state
    vi.mocked(api.api.agent.commands.expand).mockResolvedValueOnce('Recent:\nabc123 commit')
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/recent')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(api.api.agent.commands.expand).not.toHaveBeenCalled()
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('git log --oneline -1')
    await user.click(screen.getByRole('button', { name: 'Run command' }))

    await waitFor(() => expect(chatMocks.send).toHaveBeenCalledWith('Recent:\nabc123 commit', []))
    expect(api.api.agent.commands.expand).toHaveBeenCalledWith({
      template: 'Recent:\n!`git log --oneline -1`',
      args: ''
    })
  })

  it('cancels shell snippets without sending', async () => {
    const state = baseState() as ChatStoreState
    state.commands = [
      {
        id: 'recent',
        name: 'recent',
        description: 'Recent commits',
        template: 'Recent:\n!`git log --oneline -1`',
        agent: null,
        model: null,
        source: 'project'
      }
    ]
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })
    await user.type(textarea, '/recent')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(api.api.agent.commands.expand).not.toHaveBeenCalled()
    expect(chatMocks.send).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('/recent')
  })
})

describe('model capabilities', () => {
  it('selects a model variant', async () => {
    chatMocks.ensureSession.mockResolvedValue(makeSession({ id: 's1' }))
    const state = baseState()
    if (state.models) {
      state.models = {
        ...state.models,
        models: state.models.models.map((model) => ({
          ...model,
          variants: [{ id: 'high', name: 'High', settings: { reasoningEffort: 'high' } }]
        }))
      }
    }
    storeState.current = state
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByRole('button', { name: 'Model variant: Default' }))
    await user.click(await screen.findByRole('option', { name: /^High/ }))

    await waitFor(() =>
      expect(chatMocks.setSessionModel).toHaveBeenCalledWith('s1', {
        providerId: 'p1',
        modelId: 'claude-x',
        variant: 'high'
      })
    )
  })

  it('hides the reasoning control for models without reasoning support', () => {
    const state = baseState()
    if (state.models) {
      state.models = {
        ...state.models,
        models: state.models.models.map((model) => ({ ...model, reasoning: false }))
      }
    }
    storeState.current = state
    renderComposer()

    expect(
      screen.queryByRole('button', { name: 'Reasoning effort: Default' })
    ).not.toBeInTheDocument()
  })
})

describe('attachment capabilities', () => {
  it('disables attachments for models without attachment support', () => {
    const state = baseState()
    if (state.models) {
      state.models = {
        ...state.models,
        models: state.models.models.map((model) => ({ ...model, attachment: false }))
      }
    }
    storeState.current = state
    renderComposer()

    expect(screen.getByRole('button', { name: 'Attach files' })).toBeDisabled()
  })

  it('ignores dropped files for models without attachment support', async () => {
    const state = baseState()
    if (state.models) {
      state.models = {
        ...state.models,
        models: state.models.models.map((model) => ({ ...model, attachment: false }))
      }
    }
    storeState.current = state
    renderComposer()

    fireEvent.drop(screen.getByTestId('composer'), {
      dataTransfer: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] }
    })

    await waitFor(() => expect(api.api.agent.attachments.import).not.toHaveBeenCalled())
  })
})
