import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AssistantMessage from './AssistantMessage'

const chatMocks = vi.hoisted(() => ({
  forkSession: vi.fn(async () => undefined),
  openChanges: vi.fn()
}))

vi.mock('../../chat/store', () => ({ chatStore: chatMocks }))
import { makeMessage, makeTextPart } from '../../test/factories'

describe('AssistantMessage', () => {
  it('shows the message cost when available', () => {
    render(
      <AssistantMessage
        message={makeMessage({
          parts: [makeTextPart('answer')],
          usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
          durationMs: 1_000,
          costUsd: 0.000069
        })}
        permissions={[]}
        isLast
        sessionRunning={false}
      />
    )

    expect(screen.getByText('$0.000069')).toBeInTheDocument()
  })
})

describe('forking', () => {
  it('forks from a message', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    const message = makeMessage({ id: 'm1', parts: [makeTextPart('answer')] })
    render(
      <AssistantMessage message={message} permissions={[]} isLast={false} sessionRunning={false} />
    )

    await user.click(screen.getByRole('button', { name: 'Fork from here' }))

    expect(chatMocks.forkSession).toHaveBeenCalledWith('m1')
  })
})

describe('changed files', () => {
  it('shows retry progress while streaming', () => {
    const message = makeMessage({
      parts: [makeTextPart('answer')],
      status: 'streaming',
      retry: { attempt: 2, maxAttempts: 5, delayMs: 3_000, reason: 'HTTP 503' }
    })
    render(<AssistantMessage message={message} permissions={[]} isLast={false} sessionRunning />)

    expect(screen.getByText('Retrying…')).toBeInTheDocument()
    expect(screen.getByText('attempt 2/5, retrying in 3s')).toBeInTheDocument()
    expect(screen.getByText('HTTP 503')).toBeInTheDocument()
  })

  it('shows the last retry reason when retries are exhausted', () => {
    const message = makeMessage({
      parts: [],
      status: 'error',
      error: 'The model provider returned a server error.',
      retryFailure: { retries: 3, reason: 'HTTP 503' }
    })
    render(<AssistantMessage message={message} permissions={[]} isLast sessionRunning={false} />)

    expect(screen.getByText('The model provider returned a server error.')).toBeInTheDocument()
    expect(screen.getByText('Retried 3 times · last reason: HTTP 503')).toBeInTheDocument()
  })

  it('opens the review panel for a message with changes', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    const user = userEvent.setup()
    const message = makeMessage({
      id: 'm1',
      sessionId: 's1',
      parts: [makeTextPart('answer')],
      changedFiles: ['src/a.ts']
    })
    render(
      <AssistantMessage message={message} permissions={[]} isLast={false} sessionRunning={false} />
    )

    await user.click(screen.getByRole('button', { name: 'Files changed (1)' }))

    expect(chatMocks.openChanges).toHaveBeenCalledWith('s1', 'm1')
  })

  it('hides the review entry while the message is streaming', () => {
    const message = makeMessage({
      parts: [makeTextPart('answer')],
      status: 'streaming',
      changedFiles: ['src/a.ts']
    })
    render(<AssistantMessage message={message} permissions={[]} isLast={false} sessionRunning />)

    expect(screen.queryByRole('button', { name: 'Files changed (1)' })).not.toBeInTheDocument()
  })
})
