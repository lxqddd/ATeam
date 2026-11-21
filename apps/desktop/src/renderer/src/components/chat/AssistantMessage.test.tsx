import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AssistantMessage from './AssistantMessage'
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
