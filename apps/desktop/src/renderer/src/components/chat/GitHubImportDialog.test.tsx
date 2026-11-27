import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubContextResult, GitHubItemSummary, GitHubTokenStatus } from '@ateam/shared'
import GitHubImportDialog from './GitHubImportDialog'
import { createApiMock, type ApiMock } from '../../test/api-mock'

const chatMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  renameSession: vi.fn(),
  setDraftPrompt: vi.fn(),
  setGitHubRef: vi.fn()
}))

vi.mock('../../chat/store', () => ({ chatStore: chatMocks }))

const TOKEN: GitHubTokenStatus = {
  hasToken: true,
  source: 'store',
  login: 'octocat',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

function contextResult(
  overrides: Partial<GitHubContextResult['context']> = {},
  prompt = 'GitHub context'
): GitHubContextResult {
  return {
    context: {
      owner: 'octo',
      repo: 'repo',
      kind: 'issue',
      number: 1,
      title: 'Example issue',
      url: 'https://github.com/octo/repo/issues/1',
      state: 'open',
      author: 'octocat',
      labels: ['bug'],
      comments: 2,
      updatedAt: '',
      body: 'Issue body',
      bodyTruncated: false,
      pull: null,
      ...overrides
    },
    prompt
  }
}

function item(number: number, title: string): GitHubItemSummary {
  return {
    owner: 'octo',
    repo: 'repo',
    kind: 'issue',
    number,
    title,
    url: `https://github.com/octo/repo/issues/${number}`,
    state: 'open',
    author: 'octocat',
    labels: [],
    comments: 0,
    updatedAt: ''
  }
}

let api: ApiMock

function renderDialog(): {
  onClose: ReturnType<typeof vi.fn>
  onImported: ReturnType<typeof vi.fn<(sessionId: string, title: string) => void>>
} {
  const onClose = vi.fn()
  const onImported = vi.fn<(sessionId: string, title: string) => void>()
  render(
    <MemoryRouter>
      <GitHubImportDialog initialDirectory={null} onClose={onClose} onImported={onImported} />
    </MemoryRouter>
  )
  return { onClose, onImported }
}

beforeEach(() => {
  api = createApiMock()
  Object.defineProperty(window, 'api', { value: api.api, configurable: true })
  chatMocks.createSession.mockReset()
  chatMocks.createSession.mockResolvedValue({ id: 'session-9' })
  chatMocks.renameSession.mockReset()
  chatMocks.renameSession.mockResolvedValue(undefined)
  chatMocks.setDraftPrompt.mockReset()
  chatMocks.setGitHubRef.mockReset()
})

describe('GitHubImportDialog', () => {
  it('warns about a missing token and links to settings without listing items', async () => {
    renderDialog()

    expect(
      await screen.findByText(
        'No GitHub token configured; browsing and importing issues/PRs is unavailable.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute(
      'href',
      '/settings?section=github'
    )
    expect(api.api.agent.github.repo).toHaveBeenCalledWith(null)
    expect(api.api.agent.github.list).not.toHaveBeenCalled()
  })

  it('detects the repository and shows the unknown hint without one', async () => {
    vi.mocked(api.api.agent.github.repo).mockResolvedValue(null)
    renderDialog()

    expect(await screen.findByText('No GitHub repository detected')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The origin of this folder is not a GitHub repository; you can still type owner/repo#number.'
      )
    ).toBeInTheDocument()
  })

  it('previews a typed reference and imports it as a chat draft', async () => {
    vi.mocked(api.api.agent.github.status).mockResolvedValue(TOKEN)
    const user = userEvent.setup()
    const { onImported } = renderDialog()
    await screen.findByText('Repository octo/repo · main')

    await user.type(screen.getByLabelText('Issue / PR'), 'https://github.com/octo/repo/issues/1')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(api.api.agent.github.context).toHaveBeenCalledWith(
      'https://github.com/octo/repo/issues/1'
    )
    expect(await screen.findByTestId('github-import-preview')).toBeInTheDocument()
    expect(screen.getByText('#1 Example issue')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Import and create chat' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith('session-9', 'Example issue'))
    expect(chatMocks.createSession).toHaveBeenCalledWith(null)
    expect(chatMocks.setGitHubRef).toHaveBeenCalledWith('session-9', 'octo/repo#1')
    expect(chatMocks.setDraftPrompt).toHaveBeenCalledWith(
      'GitHub context for https://github.com/octo/repo/issues/1'
    )
    expect(chatMocks.renameSession).toHaveBeenCalledWith('session-9', 'Example issue')
  })

  it('lists open items and loads a selected one', async () => {
    vi.mocked(api.api.agent.github.status).mockResolvedValue(TOKEN)
    vi.mocked(api.api.agent.github.list).mockResolvedValue([item(3, 'Third issue')])
    vi.mocked(api.api.agent.github.context).mockResolvedValue(
      contextResult({ number: 3, title: 'Third issue' }, 'context for 3')
    )
    const user = userEvent.setup()
    renderDialog()
    await screen.findByText('Repository octo/repo · main')

    await user.click(await screen.findByRole('button', { name: /#3 Third issue/ }))

    expect(api.api.agent.github.list).toHaveBeenCalledWith({ repo: 'octo/repo', kind: 'issue' })
    expect(api.api.agent.github.context).toHaveBeenCalledWith('octo/repo#3')
    await waitFor(() => expect(screen.getByTestId('github-import-preview')).toBeInTheDocument())
  })

  it('switches the recent list to pull requests', async () => {
    vi.mocked(api.api.agent.github.status).mockResolvedValue(TOKEN)
    const user = userEvent.setup()
    renderDialog()
    await screen.findByText('Repository octo/repo · main')
    await waitFor(() =>
      expect(api.api.agent.github.list).toHaveBeenCalledWith({ repo: 'octo/repo', kind: 'issue' })
    )

    await user.click(screen.getByRole('button', { name: 'Pull requests' }))

    await waitFor(() =>
      expect(api.api.agent.github.list).toHaveBeenCalledWith({ repo: 'octo/repo', kind: 'pull' })
    )
  })

  it('shows a translated error when the preview fails', async () => {
    vi.mocked(api.api.agent.github.status).mockResolvedValue(TOKEN)
    vi.mocked(api.api.agent.github.context).mockRejectedValue(
      new Error('GITHUB_NOT_FOUND: missing')
    )
    const user = userEvent.setup()

    renderDialog()
    await user.type(screen.getByLabelText('Issue / PR'), 'octo/repo#404')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The issue, pull request or repository could not be found.'
    )
    expect(chatMocks.createSession).not.toHaveBeenCalled()
  })

  it('keeps the import when renaming fails', async () => {
    vi.mocked(api.api.agent.github.status).mockResolvedValue(TOKEN)
    chatMocks.renameSession.mockRejectedValue(new Error('rename failed'))
    const user = userEvent.setup()
    const { onImported } = renderDialog()

    await screen.findByText('Repository octo/repo · main')
    await user.type(screen.getByLabelText('Issue / PR'), 'octo/repo#1')
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByTestId('github-import-preview')
    await user.click(screen.getByRole('button', { name: 'Import and create chat' }))

    await waitFor(() => expect(onImported).toHaveBeenCalledWith('session-9', 'Example issue'))
    expect(chatMocks.setDraftPrompt).toHaveBeenCalled()
  })
})
