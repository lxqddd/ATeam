import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentSettings from './AgentSettings'
import { createApiMock, type ApiMock } from '../../test/api-mock'

const DEFAULTS = {
  snapshots: true,
  instructions: [],
  lsp: true,
  formatters: true,
  formatterOverrides: {}
}

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

  it('loads and saves references', async () => {
    vi.mocked(mock.api.agent.config.get).mockResolvedValue({
      ...DEFAULTS,
      references: [{ alias: 'docs', path: '../docs', description: 'Docs' }]
    })
    vi.mocked(mock.api.agent.config.update).mockResolvedValue({
      ...DEFAULTS,
      references: [
        { alias: 'docs', path: '../docs', description: 'Docs' },
        { alias: 'sdk', repository: 'owner/repo', branch: 'main' }
      ]
    })
    const user = userEvent.setup()
    render(<AgentSettings />)

    const input = await screen.findByLabelText('References')
    expect(input).toHaveValue('docs=../docs | Docs')

    await user.type(input, '\nsdk=owner/repo#main')
    await user.click(screen.getByRole('button', { name: 'Save references' }))

    await waitFor(() =>
      expect(mock.api.agent.config.update).toHaveBeenCalledWith({
        references: [
          { alias: 'docs', path: '../docs', description: 'Docs' },
          { alias: 'sdk', repository: 'owner/repo', branch: 'main' }
        ]
      })
    )
  })

  it('saves formatter overrides', async () => {
    vi.mocked(mock.api.agent.config.update).mockResolvedValue({
      ...DEFAULTS,
      formatterOverrides: { '.ts': 'prettier' }
    })
    const user = userEvent.setup()
    render(<AgentSettings />)

    const input = await screen.findByLabelText('Formatter overrides')
    await user.type(input, '.ts=prettier')
    await user.click(screen.getByRole('button', { name: 'Save overrides' }))

    await waitFor(() =>
      expect(mock.api.agent.config.update).toHaveBeenCalledWith({
        formatterOverrides: { '.ts': 'prettier' }
      })
    )
  })

  it('shows the organization policy and its rules', async () => {
    mock = createApiMock({
      info: {
        workspacePath: '/tmp/workspace',
        appVersion: '0.1.0',
        instructionFiles: [],
        lspServers: [],
        formatters: [],
        policy: {
          path: '/etc/ateam/policy.json',
          rules: [{ action: 'shell', resource: 'git push *', effect: 'deny' }],
          error: null
        }
      }
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })

    render(<AgentSettings />)

    expect(await screen.findByText('/etc/ateam/policy.json')).toBeInTheDocument()
    expect(screen.getByText('shell · git push * · Deny')).toBeInTheDocument()
  })

  it('shows detected formatters and language servers', async () => {
    mock = createApiMock({
      info: {
        workspacePath: '/tmp/workspace',
        appVersion: '0.1.0',
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
  it('edits the project config from the read-only card', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.config.project.update).mockResolvedValue({
      path: '/tmp/workspace/ateam.json',
      directory: '/tmp/workspace',
      root: '/tmp/workspace',
      exists: true,
      content: '{"snapshots": false}\n',
      diagnostics: []
    })
    render(<AgentSettings />)

    await user.click(await screen.findByRole('button', { name: 'Create project config' }))
    const editor = screen.getByRole('textbox', { name: /ateam\.json/ })
    fireEvent.change(editor, { target: { value: '{"snapshots": false}\n' } })
    await user.click(screen.getByRole('button', { name: 'Save project config' }))

    await waitFor(() =>
      expect(mock.api.agent.config.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ content: '{"snapshots": false}\n' })
      )
    )
  })
})
