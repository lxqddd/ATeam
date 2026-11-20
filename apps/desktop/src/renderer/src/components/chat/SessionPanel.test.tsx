import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SessionPanel from './SessionPanel'
import { makeSession } from '../../test/factories'

const chatMocks = vi.hoisted(() => ({
  createSession: vi.fn(async () => undefined),
  selectSession: vi.fn(),
  renameSession: vi.fn(async () => undefined),
  deleteSession: vi.fn(async () => undefined)
}))

const storeState = vi.hoisted(() => ({ current: {} as unknown }))

vi.mock('../../chat/store', () => ({
  chatStore: chatMocks,
  useChatStore: () => storeState.current
}))

function setSessions(sessions: ReturnType<typeof makeSession>[], selected: string | null): void {
  storeState.current = { sessions, selectedSessionId: selected }
}

beforeEach(() => {
  chatMocks.createSession.mockClear()
  chatMocks.createSession.mockResolvedValue(undefined)
  chatMocks.selectSession.mockClear()
  chatMocks.renameSession.mockClear()
  chatMocks.renameSession.mockResolvedValue(undefined)
  chatMocks.deleteSession.mockClear()
  chatMocks.deleteSession.mockResolvedValue(undefined)
  setSessions([], null)
})

describe('SessionPanel', () => {
  it('shows the empty state and creates a chat', async () => {
    const user = userEvent.setup()
    render(<SessionPanel />)

    expect(screen.getByText('No chats yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'New chat' }))

    expect(chatMocks.createSession).toHaveBeenCalled()
  })

  it('lists sessions and selects one', async () => {
    const user = userEvent.setup()
    setSessions(
      [makeSession({ id: 's1', title: 'First' }), makeSession({ id: 's2', title: 'Second' })],
      's1'
    )
    render(<SessionPanel />)

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
    expect(screen.getAllByTestId('session-row')[0]).toHaveAttribute('data-active')

    await user.click(screen.getByText('Second'))

    expect(chatMocks.selectSession).toHaveBeenCalledWith('s2')
  })

  it('renames a session on Enter', async () => {
    const user = userEvent.setup()
    setSessions([makeSession({ id: 's1', title: 'First' })], 's1')
    render(<SessionPanel />)

    const row = screen.getAllByTestId('session-row')[0]
    await user.click(within(row).getByRole('button', { name: 'Rename chat' }))

    const input = screen.getByRole('textbox', { name: 'Rename chat' })
    await user.clear(input)
    await user.type(input, 'Renamed{Enter}')

    await waitFor(() => expect(chatMocks.renameSession).toHaveBeenCalledWith('s1', 'Renamed'))
  })

  it('cancels a rename on Escape', async () => {
    const user = userEvent.setup()
    setSessions([makeSession({ id: 's1', title: 'First' })], 's1')
    render(<SessionPanel />)

    const row = screen.getAllByTestId('session-row')[0]
    await user.click(within(row).getByRole('button', { name: 'Rename chat' }))

    const input = screen.getByRole('textbox', { name: 'Rename chat' })
    await user.clear(input)
    await user.type(input, 'Discarded{Escape}')

    expect(chatMocks.renameSession).not.toHaveBeenCalled()
    expect(screen.getByText('First')).toBeInTheDocument()
  })

  it('deletes a session after a two-step confirmation', async () => {
    const user = userEvent.setup()
    setSessions([makeSession({ id: 's1', title: 'First' })], 's1')
    render(<SessionPanel />)

    const row = screen.getAllByTestId('session-row')[0]
    await user.click(within(row).getByRole('button', { name: 'Delete chat' }))
    await user.click(within(row).getByRole('button', { name: 'Delete chat' }))

    await waitFor(() => expect(chatMocks.deleteSession).toHaveBeenCalledWith('s1'))
  })

  it('cancels the delete confirmation', async () => {
    const user = userEvent.setup()
    setSessions([makeSession({ id: 's1', title: 'First' })], 's1')
    render(<SessionPanel />)

    const row = screen.getAllByTestId('session-row')[0]
    await user.click(within(row).getByRole('button', { name: 'Delete chat' }))
    await user.click(within(row).getByRole('button', { name: 'Cancel' }))

    expect(chatMocks.deleteSession).not.toHaveBeenCalled()
    expect(within(row).getByRole('button', { name: 'Delete chat' })).toBeInTheDocument()
  })

  it('shows creation errors', async () => {
    chatMocks.createSession.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(<SessionPanel />)

    await user.click(screen.getByRole('button', { name: 'New chat' }))

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })

  it('renders status indicators and untitled sessions', () => {
    setSessions(
      [
        makeSession({ id: 'a', title: 'Running', status: 'running' }),
        makeSession({ id: 'b', title: 'Waiting', status: 'waiting-permission' }),
        makeSession({ id: 'c', title: 'Failed', status: 'error' }),
        makeSession({ id: 'd', title: '' })
      ],
      'a'
    )
    render(<SessionPanel />)

    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('New chat')).toBeInTheDocument()
  })

  it('ignores unchanged and empty renames', async () => {
    const user = userEvent.setup()
    setSessions([makeSession({ id: 's1', title: 'First' })], 's1')
    render(<SessionPanel />)

    const row = screen.getAllByTestId('session-row')[0]
    await user.click(within(row).getByRole('button', { name: 'Rename chat' }))
    await user.keyboard('{Enter}')
    expect(chatMocks.renameSession).not.toHaveBeenCalled()

    await user.click(within(row).getByRole('button', { name: 'Rename chat' }))
    await user.clear(screen.getByRole('textbox', { name: 'Rename chat' }))
    await user.keyboard('{Enter}')

    expect(chatMocks.renameSession).not.toHaveBeenCalled()
  })

  it('shows rename errors', async () => {
    chatMocks.renameSession.mockRejectedValueOnce(new Error('rename failed'))
    const user = userEvent.setup()
    setSessions([makeSession({ id: 's1', title: 'First' })], 's1')
    render(<SessionPanel />)

    const row = screen.getAllByTestId('session-row')[0]
    await user.click(within(row).getByRole('button', { name: 'Rename chat' }))
    const input = screen.getByRole('textbox', { name: 'Rename chat' })
    await user.clear(input)
    await user.type(input, 'New name{Enter}')

    expect(await screen.findByText('rename failed')).toBeInTheDocument()
  })

  it('shows delete errors', async () => {
    chatMocks.deleteSession.mockRejectedValueOnce(new Error('delete failed'))
    const user = userEvent.setup()
    setSessions([makeSession({ id: 's1', title: 'First' })], 's1')
    render(<SessionPanel />)

    const row = screen.getAllByTestId('session-row')[0]
    await user.click(within(row).getByRole('button', { name: 'Delete chat' }))
    await user.click(within(row).getByRole('button', { name: 'Delete chat' }))

    expect(await screen.findByText('delete failed')).toBeInTheDocument()
  })

  it('commits a rename on blur', async () => {
    const user = userEvent.setup()
    setSessions([makeSession({ id: 's1', title: 'First' })], 's1')
    render(<SessionPanel />)

    const row = screen.getAllByTestId('session-row')[0]
    await user.click(within(row).getByRole('button', { name: 'Rename chat' }))
    const input = screen.getByRole('textbox', { name: 'Rename chat' })
    await user.clear(input)
    await user.type(input, 'Blurred')
    fireEvent.blur(input)

    await waitFor(() => expect(chatMocks.renameSession).toHaveBeenCalledWith('s1', 'Blurred'))
  })

  it('commits once when Enter and blur race', async () => {
    const user = userEvent.setup()
    setSessions([makeSession({ id: 's1', title: 'First' })], 's1')
    render(<SessionPanel />)

    const row = screen.getAllByTestId('session-row')[0]
    await user.click(within(row).getByRole('button', { name: 'Rename chat' }))
    const input = screen.getByRole('textbox', { name: 'Rename chat' })
    await user.clear(input)
    await user.type(input, 'Quick')

    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
      fireEvent.blur(input)
    })

    await waitFor(() => expect(chatMocks.renameSession).toHaveBeenCalledTimes(1))
  })
})
