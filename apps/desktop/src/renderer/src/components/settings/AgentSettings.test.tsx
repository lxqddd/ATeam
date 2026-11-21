import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentSettings from './AgentSettings'
import { createApiMock, type ApiMock } from '../../test/api-mock'

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

describe('AgentSettings', () => {
  it('loads snapshot and instruction settings', async () => {
    vi.mocked(mock.api.agent.config.get).mockResolvedValue({
      snapshots: true,
      instructions: ['AGENTS.md', 'https://example.com/rules.md']
    })

    render(<AgentSettings />)

    expect(await screen.findByRole('checkbox', { name: 'File snapshots' })).toBeChecked()
    expect(screen.getByLabelText('Instruction files')).toHaveValue(
      'AGENTS.md\nhttps://example.com/rules.md'
    )
  })

  it('toggles snapshots', async () => {
    vi.mocked(mock.api.agent.config.update).mockResolvedValue({
      snapshots: false,
      instructions: []
    })
    const user = userEvent.setup()
    render(<AgentSettings />)

    await user.click(await screen.findByRole('checkbox', { name: 'File snapshots' }))

    await waitFor(() =>
      expect(mock.api.agent.config.update).toHaveBeenCalledWith({ snapshots: false })
    )
  })

  it('saves instruction files', async () => {
    vi.mocked(mock.api.agent.config.update).mockResolvedValue({
      snapshots: true,
      instructions: ['custom.md']
    })
    const user = userEvent.setup()
    render(<AgentSettings />)

    const input = await screen.findByLabelText('Instruction files')
    await user.clear(input)
    await user.type(input, ' custom.md \n\n')
    await user.click(screen.getByRole('button', { name: 'Save instructions' }))

    await waitFor(() =>
      expect(mock.api.agent.config.update).toHaveBeenCalledWith({
        instructions: ['custom.md']
      })
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
})
