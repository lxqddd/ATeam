import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AssistantMessage from './AssistantMessage'

const chatMocks = vi.hoisted(() => ({ forkSession: vi.fn(async () => undefined) }))

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
