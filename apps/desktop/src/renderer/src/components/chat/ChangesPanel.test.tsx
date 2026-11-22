import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileChange, TurnChanges } from '@ateam/shared'
import ChangesPanel from './ChangesPanel'
import { createApiMock, type ApiMock } from '../../test/api-mock'

function makeFile(overrides: Partial<FileChange> = {}): FileChange {
  return {
    path: 'src/a.ts',
    snapshotPath: 'src/a.ts',
    status: 'modified',
    binary: false,
    truncated: false,
    additions: 1,
    deletions: 1,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: ['-const a = 0', '+const a = 1']
      }
    ],
    error: null,
    ...overrides
  }
}

function makeTurn(overrides: Partial<TurnChanges> = {}): TurnChanges {
  return {
    sessionId: 's1',
    messageId: 'm1',
    latest: true,
    canRevert: true,
    truncated: false,
    files: [makeFile()],
    ...overrides
  }
}

let api: ApiMock

beforeEach(() => {
  api = createApiMock()
  Object.defineProperty(window, 'api', { value: api.api, configurable: true })
})

function renderPanel(onClose = vi.fn()): ReturnType<typeof render> {
  return render(<ChangesPanel sessionId="s1" messageId="m1" onClose={onClose} />)
}

describe('ChangesPanel', () => {
  it('lists changed files and renders unified diff lines', async () => {
    api.api.agent.sessions.changes = vi.fn(async () => makeTurn())

    renderPanel()

    expect(await screen.findAllByText('src/a.ts')).not.toHaveLength(0)
    expect(screen.getByText('Changes: 1 · +1 −1')).toBeInTheDocument()
    expect(screen.getByText('-const a = 0')).toBeInTheDocument()
    expect(screen.getByText('+const a = 1')).toBeInTheDocument()
    expect(screen.getAllByText('Modified').length).toBeGreaterThan(0)
  })

  it('is read-only for historical turns', async () => {
    api.api.agent.sessions.changes = vi.fn(async () =>
      makeTurn({ latest: false, canRevert: false })
    )

    renderPanel()

    expect(
      await screen.findByText('This turn is read-only. Only the latest turn can be reverted.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revert all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revert src/a.ts' })).not.toBeInTheDocument()
  })

  it('reverts a single file', async () => {
    const second = makeFile({ path: 'src/b.ts', snapshotPath: 'src/b.ts' })
    api.api.agent.sessions.changes = vi.fn(async () => makeTurn({ files: [makeFile(), second] }))
    api.api.agent.sessions.revertFiles = vi.fn(async () => makeTurn({ files: [second] }))

    renderPanel()
    await screen.findAllByText('src/a.ts')

    await userEvent.click(screen.getByRole('button', { name: 'Revert src/a.ts' }))

    await waitFor(() => {
      expect(api.api.agent.sessions.revertFiles).toHaveBeenCalledWith('s1', 'm1', ['src/a.ts'])
    })
    await waitFor(() => {
      expect(screen.queryAllByText('src/a.ts')).toHaveLength(0)
    })
    expect(screen.getAllByText('src/b.ts').length).toBeGreaterThan(0)
  })

  it('confirms before reverting every file', async () => {
    const second = makeFile({ path: 'src/b.ts', snapshotPath: 'src/b.ts' })
    api.api.agent.sessions.changes = vi.fn(async () => makeTurn({ files: [makeFile(), second] }))
    api.api.agent.sessions.revertFiles = vi.fn(async () => makeTurn({ files: [] }))

    renderPanel()
    await screen.findAllByText('src/a.ts')

    await userEvent.click(screen.getByRole('button', { name: 'Revert all' }))
    expect(screen.getByText('Revert all changes in this turn?')).toBeInTheDocument()
    expect(api.api.agent.sessions.revertFiles).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(api.api.agent.sessions.revertFiles).toHaveBeenCalledWith('s1', 'm1')
    })
    expect(await screen.findByText('No file changes in this turn.')).toBeInTheDocument()
  })

  it('explains binary and truncated files', async () => {
    api.api.agent.sessions.changes = vi.fn(async () =>
      makeTurn({
        files: [
          makeFile({
            path: 'img.png',
            snapshotPath: 'img.png',
            binary: true,
            hunks: [],
            additions: 0,
            deletions: 0
          }),
          makeFile({
            path: 'huge.ts',
            snapshotPath: 'huge.ts',
            truncated: true,
            hunks: [],
            additions: 0,
            deletions: 0
          })
        ]
      })
    )

    renderPanel()

    expect(
      await screen.findByText('Binary file — diff preview is not available.')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByTitle('huge.ts'))
    expect(
      screen.getByText('The diff was truncated because the file is too large.')
    ).toBeInTheDocument()
  })

  it('reports load failures', async () => {
    api.api.agent.sessions.changes = vi.fn(async () => {
      throw new Error('boom')
    })

    renderPanel()

    expect(await screen.findByText('Could not load file changes.')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('shows an empty state when nothing changed', async () => {
    api.api.agent.sessions.changes = vi.fn(async () => makeTurn({ files: [] }))

    renderPanel()

    expect(await screen.findByText('No file changes in this turn.')).toBeInTheDocument()
  })

  it('explains when a turn is no longer the latest', async () => {
    api.api.agent.sessions.changes = vi.fn(async () => makeTurn())
    api.api.agent.sessions.revertFiles = vi.fn(async () => {
      throw new Error('TURN_NOT_LATEST')
    })

    renderPanel()
    await screen.findAllByText('src/a.ts')

    await userEvent.click(screen.getByRole('button', { name: 'Revert src/a.ts' }))

    expect(
      await screen.findByText(
        'This turn is no longer the latest. Reopen the panel to review the current changes.'
      )
    ).toBeInTheDocument()
  })

  it('keeps file identity by snapshot path', async () => {
    api.api.agent.sessions.changes = vi.fn(async () =>
      makeTurn({
        files: [
          makeFile({ path: '@docs/guide.md', snapshotPath: 'guide.md' }),
          makeFile({
            path: '@docs/guide.md',
            snapshotPath: '\u0000refs/docs/guide.md',
            hunks: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                lines: ['-old ref', '+new ref']
              }
            ]
          })
        ]
      })
    )

    renderPanel()
    await screen.findAllByText('@docs/guide.md')

    await userEvent.click(screen.getAllByTitle('@docs/guide.md')[1])

    expect(screen.getByText('-old ref')).toBeInTheDocument()
    expect(screen.getByText('+new ref')).toBeInTheDocument()
  })

  it('closes from the header button', async () => {
    const onClose = vi.fn()
    api.api.agent.sessions.changes = vi.fn(async () => makeTurn())

    renderPanel(onClose)
    await screen.findAllByText('src/a.ts')

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onClose).toHaveBeenCalled()
  })
})
