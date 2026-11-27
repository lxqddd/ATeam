import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ExportDialog from './ExportDialog'
import { createApiMock } from '../../test/api-mock'

function setup(options: { sessionId?: string | null; initialScope?: 'current' | 'all' } = {}): {
  mock: ReturnType<typeof createApiMock>
  onClose: ReturnType<typeof vi.fn>
  onExported: ReturnType<typeof vi.fn>
} {
  const mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
  const onClose = vi.fn()
  const onExported = vi.fn()
  render(
    <ExportDialog
      initialScope={options.initialScope ?? 'current'}
      sessionId={options.sessionId === undefined ? 'session-1' : options.sessionId}
      onClose={onClose}
      onExported={onExported}
    />
  )
  return { mock, onClose, onExported }
}

describe('ExportDialog', () => {
  it('exports the current session as JSON with path redaction by default', async () => {
    const user = userEvent.setup()
    const { mock, onExported } = setup()

    expect(screen.getByRole('radio', { name: 'Current chat' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /redact absolute paths/i })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Export…' }))

    expect(mock.api.agent.sessions.export).toHaveBeenCalledWith({
      sessionId: 'session-1',
      format: 'json',
      redactPaths: true
    })
    await waitFor(() =>
      expect(onExported).toHaveBeenCalledWith(
        expect.objectContaining({ saved: true, path: '/tmp/ateam-export.json' })
      )
    )
  })

  it('exports all sessions in the selected format without path redaction', async () => {
    const user = userEvent.setup()
    const { mock } = setup()

    await user.click(screen.getByRole('radio', { name: 'All chats' }))
    await user.click(screen.getByRole('radio', { name: 'Markdown' }))
    await user.click(screen.getByRole('checkbox', { name: /redact absolute paths/i }))
    await user.click(screen.getByRole('button', { name: 'Export…' }))

    expect(mock.api.agent.sessions.export).toHaveBeenCalledWith({
      sessionId: null,
      format: 'markdown',
      redactPaths: false
    })
  })

  it('stays open without reporting when the save dialog is cancelled', async () => {
    const user = userEvent.setup()
    const { mock, onExported } = setup()
    vi.mocked(mock.api.agent.sessions.export).mockResolvedValue({
      saved: false,
      path: null,
      sessionCount: 1,
      messageCount: 0
    })

    await user.click(screen.getByRole('button', { name: 'Export…' }))

    await waitFor(() => expect(mock.api.agent.sessions.export).toHaveBeenCalled())
    expect(onExported).not.toHaveBeenCalled()
    expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
  })

  it('shows the underlying error when the export fails', async () => {
    const user = userEvent.setup()
    const { mock } = setup()
    vi.mocked(mock.api.agent.sessions.export).mockRejectedValue(
      new Error('EXPORT_INVALID_DOCUMENT')
    )

    await user.click(screen.getByRole('button', { name: 'Export…' }))

    expect(await screen.findByText('Export failed: EXPORT_INVALID_DOCUMENT')).toBeInTheDocument()
    expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
  })

  it('disables the current-chat scope when no session is selected', () => {
    setup({ sessionId: null, initialScope: 'all' })

    expect(screen.getByRole('radio', { name: 'Current chat' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'All chats' })).toBeChecked()
  })

  it('closes on Escape when not busy', async () => {
    const user = userEvent.setup()
    const { onClose } = setup()

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })
})
