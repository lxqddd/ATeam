import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ProjectConfigFile } from '@ateam/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSettings from './ProjectSettings'
import { createApiMock, type ApiMock } from '../../../test/api-mock'

let mock: ApiMock

function projectFile(overrides: Partial<ProjectConfigFile> = {}): ProjectConfigFile {
  return {
    path: '/tmp/workspace/ateam.json',
    directory: '/tmp/workspace',
    root: '/tmp/workspace',
    exists: true,
    content: '{}',
    diagnostics: [],
    document: {},
    raw: {},
    ...overrides
  }
}

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

async function openTab(name: string): Promise<void> {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('tab', { name }))
}

describe('ProjectSettings', () => {
  it('renders the overview tabs and project path', async () => {
    render(<ProjectSettings />)

    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    for (const name of ['Providers', 'LSP', 'Formatters', 'Commands', 'Skills', 'Raw JSONC']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByText('/tmp/workspace/ateam.json').length).toBeGreaterThan(0)
  })

  it('disables structured panels when the JSONC is invalid', async () => {
    vi.mocked(mock.api.agent.config.project.get).mockResolvedValue(
      projectFile({
        content: '{ not json',
        diagnostics: [
          {
            source: '/tmp/workspace/ateam.json',
            path: '$',
            severity: 'error',
            message: 'invalid JSONC'
          }
        ],
        raw: undefined
      })
    )

    render(<ProjectSettings />)
    expect(await screen.findByText('Invalid JSONC')).toBeInTheDocument()

    await openTab('Providers')

    expect(
      screen.getByText('Invalid JSONC. Structured forms are disabled; fix it in Raw JSONC.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add provider' })).not.toBeInTheDocument()
  })

  it('saves the raw JSONC editor content', async () => {
    const user = userEvent.setup()
    render(<ProjectSettings />)
    await openTab('Raw JSONC')

    const editor = await screen.findByLabelText('Project config file content')
    fireEvent.change(editor, { target: { value: '{"skills":["a"]}' } })
    await user.click(screen.getByRole('button', { name: 'Save project config' }))

    await waitFor(() =>
      expect(mock.api.agent.config.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ content: '{"skills":["a"]}' })
      )
    )
  })

  it('adds a provider with a model through path edits', async () => {
    const user = userEvent.setup()
    render(<ProjectSettings />)
    await openTab('Providers')

    await user.click(await screen.findByRole('button', { name: 'Add provider' }))
    await user.type(screen.getByLabelText('Provider ID'), 'local')
    await user.type(screen.getByLabelText('Name'), 'Local')
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(screen.getByLabelText('Model ID 1'), 'm')
    await user.type(screen.getByLabelText('Display name 1'), 'M')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.project.edit).toHaveBeenCalledWith(
        expect.objectContaining({
          edits: [
            {
              path: ['providers'],
              value: { local: { name: 'Local', models: { m: { name: 'M' } } } }
            }
          ]
        })
      )
    )
  })

  it('shows a hint instead of the form when providers use the array format', async () => {
    vi.mocked(mock.api.agent.config.project.get).mockResolvedValue(
      projectFile({ raw: { providers: [] } })
    )

    render(<ProjectSettings />)
    await openTab('Providers')

    expect(
      await screen.findByText(
        'providers is currently an array. The structured editor only handles the object form; convert it in Raw JSONC.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add provider' })).not.toBeInTheDocument()
  })

  it('asks for confirmation before renaming a provider id', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.config.project.get).mockResolvedValue(
      projectFile({ raw: { providers: { a: { name: 'A' } } } })
    )

    render(<ProjectSettings />)
    await openTab('Providers')
    await user.click(await screen.findByRole('button', { name: 'Edit provider' }))
    const idInput = screen.getByLabelText('Provider ID')
    await user.clear(idInput)
    await user.type(idInput, 'b')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Renaming a to b; click save again to confirm.')).toBeInTheDocument()
    expect(mock.api.agent.config.project.edit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.project.edit).toHaveBeenCalledWith(
        expect.objectContaining({
          edits: [{ path: ['providers', 'a'] }, { path: ['providers', 'b'], value: { name: 'A' } }]
        })
      )
    )
  })

  it('converts a boolean lsp switch into a project server list', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.config.project.get).mockResolvedValue(
      projectFile({ raw: { lsp: true } })
    )

    render(<ProjectSettings />)
    await openTab('LSP')

    expect(await screen.findByRole('radio', { name: 'Toggle only' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    await user.click(screen.getByRole('radio', { name: 'Project servers' }))
    await user.click(screen.getByRole('button', { name: 'Add LSP server' }))
    await user.type(screen.getByLabelText('Server ID'), 'ts')
    await user.type(screen.getByLabelText('Command (one argument per line)'), 'ts-ls')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.project.edit).toHaveBeenCalledWith(
        expect.objectContaining({
          edits: [{ path: ['lsp'], value: { ts: { command: ['ts-ls'] } } }]
        })
      )
    )
  })

  it('rejects invalid initialization JSON inline', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.config.project.get).mockResolvedValue(
      projectFile({ raw: { lsp: { ts: { command: ['ts-ls'] } } } })
    )

    render(<ProjectSettings />)
    await openTab('LSP')
    await user.click(await screen.findByRole('button', { name: 'Edit LSP server' }))
    const initialization = screen.getByLabelText('Initialization (JSON object)')
    fireEvent.change(initialization, { target: { value: '{bad' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Initialization must be a JSON object.')).toBeInTheDocument()
    expect(mock.api.agent.config.project.edit).not.toHaveBeenCalled()
  })

  it('saves a command template', async () => {
    const user = userEvent.setup()
    render(<ProjectSettings />)
    await openTab('Commands')

    await user.click(await screen.findByRole('button', { name: 'Add command' }))
    await user.type(screen.getByLabelText('Command name'), 'review')
    await user.type(screen.getByLabelText('Template'), 'Review $ARGUMENTS')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.project.edit).toHaveBeenCalledWith(
        expect.objectContaining({
          edits: [{ path: ['commands'], value: { review: { template: 'Review $ARGUMENTS' } } }]
        })
      )
    )
  })

  it('replaces the skills array from the editor', async () => {
    const user = userEvent.setup()
    vi.mocked(mock.api.agent.config.project.get).mockResolvedValue(
      projectFile({ raw: { skills: ['a'] } })
    )

    render(<ProjectSettings />)
    await openTab('Skills')
    await user.click(await screen.findByRole('button', { name: 'Edit skills' }))
    const editor = screen.getByLabelText('Skill paths (one per line)')
    await user.clear(editor)
    await user.type(editor, 'x\ny')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mock.api.agent.config.project.edit).toHaveBeenCalledWith(
        expect.objectContaining({ edits: [{ path: ['skills'], value: ['x', 'y'] }] })
      )
    )
  })
})
