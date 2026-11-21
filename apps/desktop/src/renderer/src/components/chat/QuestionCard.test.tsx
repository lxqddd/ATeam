import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionRequest } from '@ateam/shared'
import QuestionCard from './QuestionCard'

const chatMocks = vi.hoisted(() => ({ replyQuestion: vi.fn(async () => undefined) }))

vi.mock('../../chat/store', () => ({ chatStore: chatMocks }))

function question(overrides: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    id: 'q1',
    sessionId: 's1',
    messageId: 'm1',
    toolCallId: 'call-1',
    header: 'Choose a file',
    question: 'Which file should change?',
    options: [{ label: 'src/a.ts' }, { label: 'src/b.ts', description: 'second' }],
    multiple: false,
    allowCustom: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  chatMocks.replyQuestion.mockClear()
})

describe('QuestionCard', () => {
  it('renders the question and submits a single choice', async () => {
    const user = userEvent.setup()
    render(<QuestionCard question={question()} />)

    expect(screen.getByText('Choose a file')).toBeInTheDocument()
    expect(screen.getByText('Which file should change?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'src/a.ts' }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() =>
      expect(chatMocks.replyQuestion).toHaveBeenCalledWith('q1', {
        selected: ['src/a.ts'],
        custom: null
      })
    )
  })

  it('submits multiple selections', async () => {
    const user = userEvent.setup()
    render(<QuestionCard question={question({ multiple: true })} />)

    await user.click(screen.getByRole('checkbox', { name: 'src/a.ts' }))
    await user.click(screen.getByRole('checkbox', { name: 'src/b.ts' }))
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() =>
      expect(chatMocks.replyQuestion).toHaveBeenCalledWith('q1', {
        selected: ['src/a.ts', 'src/b.ts'],
        custom: null
      })
    )
  })

  it('submits free-form answers', async () => {
    const user = userEvent.setup()
    render(<QuestionCard question={question({ allowCustom: true })} />)

    await user.type(screen.getByLabelText('Custom answer'), 'something else')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() =>
      expect(chatMocks.replyQuestion).toHaveBeenCalledWith('q1', {
        selected: [],
        custom: 'something else'
      })
    )
  })

  it('cancels the question', async () => {
    const user = userEvent.setup()
    render(<QuestionCard question={question()} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(chatMocks.replyQuestion).toHaveBeenCalledWith('q1', {
        selected: [],
        custom: null,
        cancelled: true
      })
    )
  })

  it('disables submitting without an answer', () => {
    render(<QuestionCard question={question()} />)
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
  })
})
