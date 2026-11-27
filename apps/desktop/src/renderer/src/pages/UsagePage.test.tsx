import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UsageStats } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UsagePage from './UsagePage'
import { createApiMock, type ApiMock } from '../test/api-mock'

function makeStats(overrides: Partial<UsageStats> = {}): UsageStats {
  return {
    range: 'all',
    sessionCount: 3,
    messageCount: 12,
    assistantMessageCount: 8,
    toolCallCount: 5,
    tokens: {
      inputTokens: 1_200,
      outputTokens: 300,
      cacheReadTokens: 150,
      cacheWriteTokens: 50,
      totalTokens: 1_500
    },
    costUsd: 0.045,
    assistantMessagesWithoutUsage: 2,
    assistantMessagesWithoutCost: 1,
    tools: [
      { toolName: 'read', calls: 3, failed: 1 },
      { toolName: 'grep', calls: 2, failed: 0 }
    ],
    models: [
      {
        providerId: 'anthropic',
        modelId: 'claude-opus-5',
        messages: 6,
        inputTokens: 1_000,
        outputTokens: 250,
        costUsd: 0.04
      },
      {
        providerId: 'openai',
        modelId: 'gpt-5',
        messages: 2,
        inputTokens: 200,
        outputTokens: 50,
        costUsd: 0.005
      }
    ],
    ...overrides
  }
}

function emptyStats(overrides: Partial<UsageStats> = {}): UsageStats {
  return makeStats({
    sessionCount: 0,
    messageCount: 0,
    assistantMessageCount: 0,
    toolCallCount: 0,
    tokens: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0
    },
    costUsd: 0,
    assistantMessagesWithoutUsage: 0,
    assistantMessagesWithoutCost: 0,
    tools: [],
    models: [],
    ...overrides
  })
}

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

describe('UsagePage', () => {
  it('renders aggregates, missing-data notes and sorted distributions', async () => {
    vi.mocked(mock.api.agent.sessions.usage).mockResolvedValueOnce(makeStats())
    render(<UsagePage />)

    expect(await screen.findByText('read')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('8 assistant replies')).toBeInTheDocument()
    expect(screen.getByText('1,500')).toBeInTheDocument()
    expect(screen.getByText('Input 1,200 · Output 300 · Cache read 150')).toBeInTheDocument()
    expect(screen.getByText('$0.045000')).toBeInTheDocument()
    expect(screen.getByText(/2 older assistant messages have no usage record/)).toBeInTheDocument()
    expect(screen.getByText(/1 assistant messages have no cost estimate/)).toBeInTheDocument()

    expect(screen.getByText('anthropic/claude-opus-5')).toBeInTheDocument()
    expect(screen.getByText('openai/gpt-5')).toBeInTheDocument()

    const read = screen.getByText('read')
    const grep = screen.getByText('grep')
    expect(read.compareDocumentPosition(grep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const opus = screen.getByText('anthropic/claude-opus-5')
    const gpt = screen.getByText('openai/gpt-5')
    expect(opus.compareDocumentPosition(gpt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('reloads statistics when the time range changes', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.sessions.usage).mockResolvedValue(makeStats({ range: 'all' }))
    render(<UsagePage />)
    await screen.findByText('read')

    vi.mocked(mock.api.agent.sessions.usage).mockResolvedValue(makeStats({ range: '7d' }))
    await user.click(screen.getByText('Last 7 days'))

    expect(mock.api.agent.sessions.usage).toHaveBeenLastCalledWith('7d')
    await screen.findByText('read')
  })

  it('shows an empty placeholder when nothing was recorded', async () => {
    vi.mocked(mock.api.agent.sessions.usage).mockResolvedValueOnce(emptyStats())
    render(<UsagePage />)

    expect(await screen.findByText('No usage in this range.')).toBeInTheDocument()
    expect(
      screen.getByText('Start a chat and its recorded usage will show up here.')
    ).toBeInTheDocument()
  })

  it('shows the error and retries', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.sessions.usage)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(makeStats())
    render(<UsagePage />)

    expect(await screen.findByText(/Failed to load usage/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('read')).toBeInTheDocument()
    expect(screen.queryByText(/Failed to load usage/)).not.toBeInTheDocument()
  })
})
