import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SubagentNotices from './SubagentNotices'

describe('SubagentNotices', () => {
  it('renders finished background subagents', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()

    render(
      <SubagentNotices
        results={[
          {
            sessionId: 'child-1',
            parentSessionId: 's1',
            toolCallId: 'call-1',
            agentId: 'explore',
            status: 'completed',
            result: 'found three files'
          }
        ]}
        onDismiss={onDismiss}
      />
    )

    expect(
      screen.getByText('Background subagent finished · explore · completed')
    ).toBeInTheDocument()
    expect(screen.getByText('found three files')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledWith('call-1')
  })

  it('renders nothing without results', () => {
    const { container } = render(<SubagentNotices results={[]} onDismiss={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
