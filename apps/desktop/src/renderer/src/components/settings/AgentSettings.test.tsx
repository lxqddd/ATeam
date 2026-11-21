import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentSettings from './AgentSettings'
import { createApiMock, type ApiMock } from '../../test/api-mock'

const DEFAULTS = { snapshots: true, instructions: [], lsp: true, formatters: true }

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

describe('AgentSettings', () => {
  it('loads snapshot, lsp, formatter and instruction settings', async () => {
    vi.mocked(mock.api.agent.config.get).mockResolvedValue({
      ...DEFAULTS,
      instructions: ['AGENTS.md', 'https://example.com/rules.md']
    })

    render(<AgentSettings />)

    expect(await screen.findByRole('checkbox', { name: 'File snapshots' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'LSP diagnostics' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Auto format' })).toBeChecked()
    expect(screen.getByLabelText('Instruction files')).toHaveValue(
      'AGENTS.md\nhttps://example.com/rules.md'
    )
  })

  it('toggles snapshots', async () => {
    vi.mocked(mock.api.agent.config.update).mockResolvedValue({
      ...DEFAULTS,
      snapshots: false
    })
    const user = userEvent.setup()
    render(<AgentSettings />)

    await user.click(await screen.findByRole('checkbox', { name: 'File snapshots' }))

    await waitFor(() =>
      expect(mock.api.agent.config.update).toHaveBeenCalledWith({ snapshots: false })
    )
  })

  it('toggles LSP diagnostics', async () => {
    vi.mocked(mock.api.agent.config.update).mockResolvedValue({ ...DEFAULTS, lsp: false })
    const user = userEvent.setup()
    render(<AgentSettings />)

    await user.click(await screen.findByRole('checkbox', { name: 'LSP diagnostics' }))

    await waitFor(() => expect(mock.api.agent.config.update).toHaveBeenCalledWith({ lsp: false }))
  })

  it('toggles auto formatting', async () => {
    vi.mocked(mock.api.agent.config.update).mockResolvedValue({ ...DEFAULTS, formatters: false })
    const user = userEvent.setup()
    render(<AgentSettings />)

    await user.click(await screen.findByRole('checkbox', { name: 'Auto format' }))

    await waitFor(() =>
      expect(mock.api.agent.config.update).toHaveBeenCalledWith({ formatters: false })
    )
  })

  it('shows detected formatters and language servers', async () => {
    mock = createApiMock({
      info: {
        workspacePath: '/tmp/workspace',
        appVersion: '0.1.0',
        encryptionAvailable: true,
        instructionFiles: [],
        lspServers: ['typescript'],
        formatters: ['prettier']
      }
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })

    render(<AgentSettings />)

    expect(await screen.findByText('Available language servers: typescript')).toBeInTheDocument()
    expect(screen.getByText('Detected formatters: prettier')).toBeInTheDocument()
  })

  it('shows a placeholder when nothing is detected', async () => {
    render(<AgentSettings />)

    expect(await screen.findByText('Available language servers: None detected')).toBeInTheDocument()
    expect(screen.getByText('Detected formatters: None detected')).toBeInTheDocument()
  })

  it('saves instruction files', async () => {
    vi.mocked(mock.api.agent.config.update).mockResolvedValue({
      ...DEFAULTS,
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
