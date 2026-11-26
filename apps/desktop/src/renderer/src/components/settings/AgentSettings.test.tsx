import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentSettings from './AgentSettings'
import { createApiMock, type ApiMock } from '../../test/api-mock'
import { chatStore } from '../../chat/store'

const DEFAULTS = {
  snapshots: true,
  instructions: [],
  lsp: true,
  formatters: true,
  formatterOverrides: {},
  retry: { maxRetries: 4, maxDelayMs: 60_000, timeoutMs: 0 }
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

  it('loads and saves retry settings', async () => {
    vi.mocked(mock.api.agent.config.update).mockResolvedValue({
      ...DEFAULTS,
      retry: { maxRetries: 2, maxDelayMs: 5_000, timeoutMs: 30_000 }
    })
    const user = userEvent.setup()
    render(<AgentSettings />)

    const retries = await screen.findByLabelText('Max retries')
    expect(retries).toHaveValue(4)
    expect(screen.getByLabelText('Max wait (s)')).toHaveValue(60)
    expect(screen.getByLabelText('Response timeout (s)')).toHaveValue(0)

    await user.clear(retries)
    await user.type(retries, '2')
    const delay = screen.getByLabelText('Max wait (s)')
    await user.clear(delay)
    await user.type(delay, '5')
    const timeout = screen.getByLabelText('Response timeout (s)')
    await user.clear(timeout)
    await user.type(timeout, '30')
    await user.click(screen.getByRole('button', { name: 'Save retry settings' }))

    await waitFor(() =>
      expect(mock.api.agent.config.update).toHaveBeenCalledWith({
        retry: { maxRetries: 2, maxDelayMs: 5_000, timeoutMs: 30_000 }
      })
    )
  })

  it('loads and saves environment settings', async () => {
    vi.mocked(mock.api.agent.config.get).mockResolvedValue({
      ...DEFAULTS,
      environment: { timezone: 'Asia/Shanghai', notes: 'Use bun.' }
    })
    vi.mocked(mock.api.agent.config.update).mockResolvedValue({
      ...DEFAULTS,
      environment: { timezone: 'UTC', notes: 'Use pnpm.' }
    })
    const user = userEvent.setup()
    render(<AgentSettings />)

    const timezone = await screen.findByLabelText('Timezone')
    expect(timezone).toHaveValue('Asia/Shanghai')
    expect(screen.getByLabelText('Environment notes')).toHaveValue('Use bun.')

    await user.clear(timezone)
    await user.type(timezone, 'UTC')
    const notes = screen.getByLabelText('Environment notes')
    await user.clear(notes)
    await user.type(notes, 'Use pnpm.')
    await user.click(screen.getByRole('button', { name: 'Save environment' }))

    await waitFor(() =>
      expect(mock.api.agent.config.update).toHaveBeenCalledWith({
        environment: { timezone: 'UTC', notes: 'Use pnpm.' },
        systemPrompt: undefined
      })
    )
  })

  it('shows retry metrics', async () => {
    mock = createApiMock({
      info: {
        workspacePath: '/tmp/workspace',
        appVersion: '0.1.0',
        instructionFiles: [],
        lspServers: [],
        formatters: [],
        retryMetrics: {
          retries: 3,
          successes: 2,
          failures: 1,
          successRate: 2 / 3,
          totalDelayMs: 12_000,
          averageDelayMs: 4_000,
          lastReason: 'HTTP 503',
          lastRetriedAt: '2026-11-24T00:00:00.000Z'
        }
      }
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })

    render(<AgentSettings />)

    expect(await screen.findByText('Retry metrics')).toBeInTheDocument()
    expect(screen.getByText('3 retries · 67% success · average wait 4.0s')).toBeInTheDocument()
    expect(screen.getByText('Last reason: HTTP 503')).toBeInTheDocument()
  })

  it('shows prompt cache metrics', async () => {
    mock = createApiMock({
      info: {
        workspacePath: '/tmp/workspace',
        appVersion: '0.1.0',
        instructionFiles: [],
        lspServers: [],
        formatters: [],
        cacheMetrics: {
          requests: 2,
          inputTokens: 150,
          cacheReadTokens: 70,
          cacheWriteTokens: 20,
          hitRate: 70 / 150,
          savedTokens: 70
        }
      }
    })
    Object.defineProperty(window, 'api', { value: mock.api, configurable: true })

    render(<AgentSettings />)

    expect(await screen.findByText('Prompt cache')).toBeInTheDocument()
    expect(
      screen.getByText('2 requests · 47% hit · 70 read / 20 written tokens')
    ).toBeInTheDocument()
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
  it('links to the project settings editor', async () => {
    render(<AgentSettings />)

    const link = await screen.findByRole('link', { name: 'Open project settings' })
    expect(link).toHaveAttribute('href', '#/settings?section=project')
    expect(await screen.findByText('/tmp/workspace/ateam.json')).toBeInTheDocument()
    expect(screen.getByText('Not created')).toBeInTheDocument()
  })

  it('reloads when the configuration changes externally', async () => {
    chatStore.dispose()
    await chatStore.init()
    vi.mocked(mock.api.agent.config.get).mockResolvedValue({
      ...DEFAULTS,
      instructions: ['first.md']
    })
    render(<AgentSettings />)

    expect(await screen.findByLabelText('Instruction files')).toHaveValue('first.md')

    vi.mocked(mock.api.agent.config.get).mockResolvedValue({
      ...DEFAULTS,
      instructions: ['second.md']
    })
    mock.emit({ type: 'config.changed', workspace: '/tmp/workspace' })

    await waitFor(
      () => expect(screen.getByLabelText('Instruction files')).toHaveValue('second.md'),
      { timeout: 2_000 }
    )
  })

  it('keeps an unsaved draft when the configuration changes externally', async () => {
    chatStore.dispose()
    await chatStore.init()
    vi.mocked(mock.api.agent.config.get).mockResolvedValue({
      ...DEFAULTS,
      instructions: ['first.md']
    })
    const user = userEvent.setup()
    render(<AgentSettings />)

    const input = await screen.findByLabelText('Instruction files')
    expect(input).toHaveValue('first.md')

    await user.clear(input)
    await user.type(input, 'draft.md')
    mock.emit({ type: 'config.changed', workspace: '/tmp/workspace' })

    expect(
      await screen.findByText(
        'Configuration changed externally, but there are unsaved edits, so it was not reloaded.'
      )
    ).toBeInTheDocument()
    expect(input).toHaveValue('draft.md')
    expect(mock.api.agent.config.get).toHaveBeenCalledTimes(1)
  })
})
