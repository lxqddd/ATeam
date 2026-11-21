import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BackgroundResult } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BackgroundNotices from './BackgroundNotices'

const chatMocks = vi.hoisted(() => ({
  dismissBackgroundResult: vi.fn()
}))

vi.mock('../../chat/store', () => ({ chatStore: chatMocks }))

const result: BackgroundResult = {
  sessionId: 's1',
  messageId: 'a1',
  toolCallId: 'call-1',
  command: 'sleep 1',
  exitCode: 0,
  outputPath: '/tmp/bg.log'
}

beforeEach(() => {
  chatMocks.dismissBackgroundResult.mockClear()
})

describe('BackgroundNotices', () => {
  it('renders finished background commands', () => {
    render(<BackgroundNotices results={[result]} />)

    expect(screen.getByText('Background command finished')).toBeInTheDocument()
    expect(screen.getByText('sleep 1')).toBeInTheDocument()
    expect(screen.getByText('Exit code 0')).toBeInTheDocument()
    expect(screen.getByText('/tmp/bg.log')).toBeInTheDocument()
  })

  it('dismisses a background result', async () => {
    const user = userEvent.setup()
    render(<BackgroundNotices results={[result]} />)

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(chatMocks.dismissBackgroundResult).toHaveBeenCalledWith('call-1')
  })

  it('renders nothing without results', () => {
    const { container } = render(<BackgroundNotices results={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
