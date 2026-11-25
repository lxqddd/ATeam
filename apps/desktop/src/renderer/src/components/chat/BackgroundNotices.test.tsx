import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BackgroundTaskInfo } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BackgroundNotices from './BackgroundNotices'

const chatMocks = vi.hoisted(() => ({
  cancelBackgroundTask: vi.fn(async () => undefined)
}))

vi.mock('../../chat/store', () => ({ chatStore: chatMocks }))

const task: BackgroundTaskInfo = {
  id: 's1:call-1',
  kind: 'shell',
  sessionId: 's1',
  toolCallId: 'call-1',
  title: 'sleep 1',
  state: 'running',
  startedAt: '2026-01-02T00:00:00.000Z',
  outputPath: '/tmp/bg.log'
}

beforeEach(() => {
  chatMocks.cancelBackgroundTask.mockClear()
})

describe('BackgroundNotices', () => {
  it('renders running background tasks', () => {
    render(<BackgroundNotices tasks={[task]} />)

    expect(screen.getByText('Background command running')).toBeInTheDocument()
    expect(screen.getByText('sleep 1')).toBeInTheDocument()
  })

  it('cancels a running task', async () => {
    const user = userEvent.setup()
    render(<BackgroundNotices tasks={[task]} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(chatMocks.cancelBackgroundTask).toHaveBeenCalledWith('s1:call-1')
  })

  it('hides finished tasks', () => {
    const { container } = render(<BackgroundNotices tasks={[{ ...task, state: 'completed' }]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without tasks', () => {
    const { container } = render(<BackgroundNotices tasks={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
