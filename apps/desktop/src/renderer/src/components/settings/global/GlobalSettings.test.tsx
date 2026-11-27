import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GlobalConfigFile, ProjectConfigEdit } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GlobalSettings from './GlobalSettings'
import { createApiMock, type ApiMock } from '../../../test/api-mock'

type JsonRecord = Record<string, unknown>

let mock: ApiMock
let state: JsonRecord

function globalFile(
  raw: JsonRecord = {},
  overrides: Partial<GlobalConfigFile> = {}
): GlobalConfigFile {
  return {
    path: '/tmp/user-data/agent/config.json',
    exists: true,
    content: JSON.stringify(raw, null, 2),
    diagnostics: [],
    document: {},
    raw,
    ...overrides
  }
}

function applyEdits(raw: JsonRecord, edits: ProjectConfigEdit[]): JsonRecord {
  const next = structuredClone(raw)
  for (const edit of edits) {
    let cursor: JsonRecord = next
    for (const segment of edit.path.slice(0, -1)) {
      const key = String(segment)
      const child = cursor[key]
      if (typeof child !== 'object' || child === null || Array.isArray(child)) {
        cursor[key] = {}
      }
      cursor = cursor[key] as JsonRecord
    }
    const last = String(edit.path[edit.path.length - 1])
    if (Object.prototype.hasOwnProperty.call(edit, 'value')) cursor[last] = edit.value
    else delete cursor[last]
  }
  return next
}

function useFile(raw: JsonRecord): void {
  state = raw
  vi.mocked(mock.api.agent.config.global.get).mockImplementation(async () =>
    globalFile(structuredClone(state))
  )
  vi.mocked(mock.api.agent.config.global.edit).mockImplementation(
    async (input: { edits: ProjectConfigEdit[] }) => {
      state = applyEdits(state, input.edits)
      return globalFile(structuredClone(state))
    }
  )
}

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
  useFile({})
})

async function openTab(name: string): Promise<void> {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('tab', { name }))
}

describe('GlobalSettings', () => {
  it('renders the global path and five tabs', async () => {
    render(<GlobalSettings />)

    expect(await screen.findByRole('tab', { name: 'LSP' })).toHaveAttribute('aria-selected', 'true')
    for (const name of ['Formatters', 'Commands', 'Skills', 'Raw JSON']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByText('/tmp/user-data/agent/config.json').length).toBeGreaterThan(0)
  })

  it('disables structured forms when the JSON is invalid but keeps raw editing', async () => {
    vi.mocked(mock.api.agent.config.global.get).mockResolvedValue(
      globalFile(
        {},
        {
          content: '{ not json',
          raw: undefined,
          diagnostics: [
            {
              source: '/tmp/user-data/agent/config.json',
              path: '$',
              severity: 'error',
              message: 'invalid JSON'
            }
          ]
        }
      )
    )

    render(<GlobalSettings />)
    expect(await screen.findByText('Invalid JSON')).toBeInTheDocument()
    expect(
      screen.getByText('Invalid JSON. Structured forms are disabled; fix it in Raw JSON.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add LSP server' })).not.toBeInTheDocument()

    await openTab('Raw JSON')
    const editor = await screen.findByLabelText('Global config file content')
    fireEvent.change(editor, { target: { value: '{"lsp":true}' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save global config' }))

    await waitFor(() =>
      expect(mock.api.agent.config.global.update).toHaveBeenCalledWith({
        content: '{"lsp":true}'
      })
    )
  })

  it('saves a boolean toggle for the default state', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)

    await user.click(await screen.findByRole('radio', { name: 'On/off' }))
    await user.click(screen.getByRole('checkbox', { name: 'Enable LSP' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.global.edit).toHaveBeenCalledWith({
        edits: [{ path: ['lsp'], value: false }]
      })
    )
  })

  it('adds a server to a disabled switch and keeps it disabled', async () => {
    const user = userEvent.setup()
    useFile({ lsp: false })

    render(<GlobalSettings />)
    await user.click(await screen.findByRole('radio', { name: 'Global servers' }))
    await user.click(screen.getByRole('button', { name: 'Add LSP server' }))
    await user.type(screen.getByLabelText('Server ID'), 'ts')
    await user.type(screen.getByLabelText('Command (one argument per line)'), 'ts-ls')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.global.edit).toHaveBeenCalledWith({
        edits: [
          { path: ['lsp'], value: { ts: { command: ['ts-ls'] } } },
          { path: ['lspEnabled'], value: false }
        ]
      })
    )
  })

  it('enables an existing disabled list without touching the list', async () => {
    const user = userEvent.setup()
    useFile({ lsp: { ts: { command: ['ts-ls'] } }, lspEnabled: false })

    render(<GlobalSettings />)
    await user.click(await screen.findByRole('checkbox', { name: 'Enable these servers' }))

    await waitFor(() =>
      expect(mock.api.agent.config.global.edit).toHaveBeenCalledWith({
        edits: [{ path: ['lspEnabled'] }]
      })
    )
  })

  it('keeps a custom server list when switching it off', async () => {
    const user = userEvent.setup()
    useFile({ lsp: { ts: { command: ['ts-ls'] } } })

    render(<GlobalSettings />)
    await user.click(await screen.findByRole('radio', { name: 'On/off' }))
    await user.click(screen.getByRole('checkbox', { name: 'Enable LSP' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.global.edit).toHaveBeenCalledWith({
        edits: [{ path: ['lspEnabled'], value: false }]
      })
    )
  })

  it('clears both keys when the last server is removed', async () => {
    const user = userEvent.setup()
    useFile({ lsp: { ts: { command: ['ts-ls'] } }, lspEnabled: false })

    render(<GlobalSettings />)
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() =>
      expect(mock.api.agent.config.global.edit).toHaveBeenCalledWith({
        edits: [{ path: ['lsp'] }, { path: ['lspEnabled'] }]
      })
    )
  })

  it('drops a stale disabled flag when the effective state is enabled', async () => {
    const user = userEvent.setup()
    useFile({ lsp: true, lspEnabled: false })

    render(<GlobalSettings />)
    await user.click(await screen.findByRole('radio', { name: 'Global servers' }))
    await user.click(screen.getByRole('button', { name: 'Add LSP server' }))
    await user.type(screen.getByLabelText('Server ID'), 'ts')
    await user.type(screen.getByLabelText('Command (one argument per line)'), 'ts-ls')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.global.edit).toHaveBeenCalledWith({
        edits: [{ path: ['lsp'], value: { ts: { command: ['ts-ls'] } } }, { path: ['lspEnabled'] }]
      })
    )
  })

  it('uses the formatter keys for the formatter toggle', async () => {
    const user = userEvent.setup()
    useFile({ formatters: false })

    render(<GlobalSettings />)
    await openTab('Formatters')
    await user.click(await screen.findByRole('checkbox', { name: 'Enable formatters' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.global.edit).toHaveBeenCalledWith({
        edits: [{ path: ['formatters'], value: true }]
      })
    )
  })

  it('saves a global command with its metadata', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await openTab('Commands')

    await user.click(await screen.findByRole('button', { name: 'Add command' }))
    await user.type(screen.getByLabelText('Command name'), 'review')
    await user.type(screen.getByLabelText('Template'), 'Review $ARGUMENTS')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.global.edit).toHaveBeenCalledWith({
        edits: [{ path: ['commands'], value: { review: { template: 'Review $ARGUMENTS' } } }]
      })
    )
  })

  it('rejects an invalid command id inline', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await openTab('Commands')

    await user.click(await screen.findByRole('button', { name: 'Add command' }))
    await user.type(screen.getByLabelText('Command name'), 'bad id!')
    await user.type(screen.getByLabelText('Template'), 'x')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      screen.getByText(
        'Command names may only contain letters, digits, dots, underscores and dashes, and must start with a letter or digit.'
      )
    ).toBeInTheDocument()
    expect(mock.api.agent.config.global.edit).not.toHaveBeenCalled()
  })

  it('rejects an empty command template inline', async () => {
    const user = userEvent.setup()
    render(<GlobalSettings />)
    await openTab('Commands')

    await user.click(await screen.findByRole('button', { name: 'Add command' }))
    await user.type(screen.getByLabelText('Command name'), 'review')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Enter a command template.')).toBeInTheDocument()
    expect(mock.api.agent.config.global.edit).not.toHaveBeenCalled()
  })

  it('rejects invalid initialization JSON inline', async () => {
    const user = userEvent.setup()
    useFile({ lsp: { ts: { command: ['ts-ls'] } } })

    render(<GlobalSettings />)
    await user.click(await screen.findByRole('button', { name: 'Edit LSP server' }))
    fireEvent.change(screen.getByLabelText('Initialization (JSON object)'), {
      target: { value: '{bad' }
    })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Initialization must be a JSON object.')).toBeInTheDocument()
    expect(mock.api.agent.config.global.edit).not.toHaveBeenCalled()
  })

  it('explains the array command format instead of editing it', async () => {
    useFile({ commands: [] })
    render(<GlobalSettings />)
    await openTab('Commands')

    expect(
      await screen.findByText(
        'commands is currently an array. The structured editor only handles the object form; convert it in Raw JSON.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add command' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Raw JSON' })).toBeInTheDocument()
  })

  it('replaces the global skills array', async () => {
    const user = userEvent.setup()
    useFile({ skills: ['a'] })

    render(<GlobalSettings />)
    await openTab('Skills')
    await user.click(await screen.findByRole('button', { name: 'Edit skills' }))
    const editor = screen.getByLabelText('Skill paths (one per line)')
    await user.clear(editor)
    await user.type(editor, 'x\ny')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.global.edit).toHaveBeenCalledWith({
        edits: [{ path: ['skills'], value: ['x', 'y'] }]
      })
    )
  })
})
