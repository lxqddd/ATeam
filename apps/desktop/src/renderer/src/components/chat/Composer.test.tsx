import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Composer from './Composer'
import type { ChatStoreState } from '../../chat/store'
import { makeSession } from '../../test/factories'

const chatMocks = vi.hoisted(() => ({
  send: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  ensureSession: vi.fn(),
  setSessionModel: vi.fn(),
  setSessionSettings: vi.fn(),
  clearRevertPrompt: vi.fn()
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
          modelId: 'claude-x',
          name: 'Claude X',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      defaultModel: { providerId: 'p1', modelId: 'claude-x' },
      encryptionAvailable: true
    },
    sessions: [makeSession({ id: 's1', title: 'Chat' })],
    selectedSessionId: 's1',
    messagesBySession: {},
    loadedBySession: {},
    permissions: [],
    runOutcomes: {},
    backgroundResults: [],
    actionError: null,
    restarting: false,
    revertPrompt: null
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
  chatMocks.send.mockClear()
  chatMocks.send.mockResolvedValue(undefined)
  chatMocks.stop.mockClear()
  chatMocks.ensureSession.mockReset()
  chatMocks.setSessionModel.mockReset()
  chatMocks.setSessionSettings.mockReset()
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

    await waitFor(() => expect(chatMocks.send).toHaveBeenCalledWith('hello'))
    await waitFor(() => expect(textarea).toHaveValue(''))
  })

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const user = userEvent.setup()
    renderComposer()
    const textarea = screen.getByRole('textbox', { name: 'Message ATeam…' })

    await user.type(textarea, 'first{Enter}')
    await waitFor(() => expect(chatMocks.send).toHaveBeenCalledWith('first'))

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

  it('shows a hint and disables input without models', () => {
    const state = baseState()
    state.models = {
      providers: [],
      models: [],
      defaultModel: null,
      encryptionAvailable: true
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
    chatMocks.send.mockRejectedValueOnce(new Error('SESSION_BUSY'))
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
      defaultModel: null,
      encryptionAvailable: true
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
    state.models = { providers: [], models: [], defaultModel: null, encryptionAvailable: true }
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
})
