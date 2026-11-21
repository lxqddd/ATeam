import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatMessage, PermissionRequest, RunOutcome, SessionCompaction } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageList from './MessageList'
import { makeMessage, makePermission, makeTextPart, makeToolPart } from '../../test/factories'

const chatMocks = vi.hoisted(() => ({
  retry: vi.fn(async () => undefined),
  replyPermission: vi.fn(async () => undefined),
  undoSession: vi.fn(async () => 'prompt')
}))

vi.mock('../../chat/store', () => ({ chatStore: chatMocks }))

interface RenderOptions {
  messages?: ChatMessage[]
  permissions?: PermissionRequest[]
  sessionRunning?: boolean
  runOutcomes?: Record<string, RunOutcome>
  compaction?: SessionCompaction | null
}

function renderList(options: RenderOptions = {}): void {
  render(
    <MessageList
      messages={options.messages ?? []}
      permissions={options.permissions ?? []}
      sessionRunning={options.sessionRunning ?? false}
      runOutcomes={options.runOutcomes ?? {}}
      compaction={options.compaction ?? null}
    />
  )
}

function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return makeMessage({ id: 'a1', sessionId: 's1', role: 'assistant', ...overrides })
}

beforeEach(() => {
  chatMocks.retry.mockClear()
  chatMocks.retry.mockResolvedValue(undefined)
  chatMocks.replyPermission.mockClear()
  chatMocks.replyPermission.mockResolvedValue(undefined)
  chatMocks.undoSession.mockClear()
  chatMocks.undoSession.mockResolvedValue('prompt')
})

describe('MessageList', () => {
  it('renders user and assistant text', () => {
    renderList({
      messages: [
        makeMessage({ id: 'u1', sessionId: 's1', role: 'user', parts: [makeTextPart('hello')] }),
        assistant({ parts: [makeTextPart('hi there')] })
      ]
    })

    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('hi there')).toBeInTheDocument()
  })

  it('reverts to an assistant message', async () => {
    const user = userEvent.setup()
    renderList({
      messages: [
        makeMessage({ id: 'u1', sessionId: 's1', role: 'user', parts: [makeTextPart('hello')] }),
        assistant({ parts: [makeTextPart('hi there')], snapshotBefore: 'snap-1' })
      ]
    })

    await user.click(screen.getByRole('button', { name: 'Revert to here' }))

    await waitFor(() => expect(chatMocks.undoSession).toHaveBeenCalledWith('a1'))
  })

  it('marks where earlier messages were compacted and shows the summary', async () => {
    const user = userEvent.setup()
    renderList({
      messages: [
        makeMessage({ id: 'u1', sessionId: 's1', role: 'user', parts: [makeTextPart('old')] }),
        assistant({ id: 'a1', parts: [makeTextPart('older reply')] }),
        makeMessage({ id: 'u2', sessionId: 's1', role: 'user', parts: [makeTextPart('new')] })
      ],
      compaction: {
        summary: 'Earlier work summary',
        throughMessageId: 'a1',
        createdAt: '2026-01-01T00:00:00.000Z',
        tokensBefore: 5_000,
        tokensAfter: 500
      }
    })

    await user.click(screen.getByText('Earlier messages were compacted into a summary'))
    expect(screen.getByText('Earlier work summary')).toBeInTheDocument()
  })

  it('renders tool rows and toggles their details', async () => {
    const user = userEvent.setup()
    renderList({
      messages: [
        assistant({
          parts: [
            makeToolPart({
              toolCallId: 'call-1',
              toolName: 'read',
              input: { path: 'a.txt' },
              state: 'completed',
              output: 'file content'
            })
          ]
        })
      ]
    })

    expect(screen.getByText('read')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.queryByText('file content')).not.toBeInTheDocument()

    await user.click(screen.getByText('read'))
    expect(screen.getByText('file content')).toBeInTheDocument()
  })

  it('renders permissions attached to a message', () => {
    renderList({
      messages: [assistant()],
      permissions: [makePermission({ id: 'perm-1', messageId: 'a1', resource: 'a.txt' })]
    })

    expect(screen.getByText('Permission required')).toBeInTheDocument()
    expect(screen.getByText('a.txt')).toBeInTheDocument()
  })

  it('renders orphan permissions', () => {
    renderList({
      messages: [],
      permissions: [makePermission({ id: 'perm-1', messageId: 'missing', resource: 'b.txt' })]
    })

    expect(screen.getByText('Permission required')).toBeInTheDocument()
    expect(screen.getByText('b.txt')).toBeInTheDocument()
  })

  it('shows the error state and retries', async () => {
    const user = userEvent.setup()
    renderList({
      messages: [assistant({ status: 'error', error: 'boom', parts: [makeTextPart('partial')] })]
    })

    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(chatMocks.retry).toHaveBeenCalled()
  })

  it('shows the interrupted state with a retry action', async () => {
    const user = userEvent.setup()
    renderList({
      messages: [assistant({ status: 'interrupted', parts: [makeTextPart('partial')] })]
    })

    expect(screen.getByText('Generation stopped')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(chatMocks.retry).toHaveBeenCalled()
  })

  it('hides retry while the session is running', () => {
    renderList({
      messages: [assistant({ status: 'error', error: 'boom' })],
      sessionRunning: true
    })

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('shows the max-steps notice', () => {
    renderList({
      messages: [assistant({ parts: [makeTextPart('done')] })],
      runOutcomes: { a1: 'max-steps' }
    })

    expect(screen.getByText(/Maximum tool steps reached/)).toBeInTheDocument()
  })

  it('shows an empty-content notice', () => {
    renderList({ messages: [assistant({ status: 'complete', parts: [] })] })

    expect(screen.getByText('The model returned no content.')).toBeInTheDocument()
  })

  it('offers a scroll-to-latest button after scrolling up', () => {
    renderList({ messages: [assistant({ parts: [makeTextPart('hi')] })] })
    const list = screen.getByTestId('message-list')
    Object.defineProperty(list, 'scrollHeight', { value: 1_000, configurable: true })
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true })
    list.scrollTop = 0

    fireEvent.scroll(list)

    expect(screen.getByRole('button', { name: /Scroll to latest/ })).toBeInTheDocument()
  })
})
