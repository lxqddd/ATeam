import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitHubPullDialog from './GitHubPullDialog'
import { createApiMock, type ApiMock } from '../../test/api-mock'

let api: ApiMock

beforeEach(() => {
  api = createApiMock()
  Object.defineProperty(window, 'api', { value: api.api, configurable: true })
})

function renderDialog(
  options: { directory?: string | null; defaultTitle?: string; defaultBody?: string } = {}
): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  render(
    <GitHubPullDialog
      directory={options.directory === undefined ? '/workspace' : options.directory}
      defaultTitle={options.defaultTitle ?? 'Fix login'}
      defaultBody={options.defaultBody ?? 'Assistant summary'}
      onClose={onClose}
    />
  )
  return { onClose }
}

describe('GitHubPullDialog', () => {
  it('prefills the repository, branches, title and body', async () => {
    renderDialog()

    expect(await screen.findByLabelText('Repository')).toHaveValue('octo/repo')
    expect(screen.getByLabelText('Base branch')).toHaveValue('main')
    expect(screen.getByLabelText('Head branch')).toHaveValue('main')
    expect(screen.getByLabelText('Title')).toHaveValue('Fix login')
    expect(screen.getByLabelText('Description')).toHaveValue('Assistant summary')
    expect(api.api.agent.github.repo).toHaveBeenCalledWith('/workspace')
  })

  it('creates a pull request and shows its number and URL', async () => {
    const user = userEvent.setup()
    renderDialog()
    await screen.findByLabelText('Repository')

    await user.clear(screen.getByLabelText('Head branch'))
    await user.type(screen.getByLabelText('Head branch'), 'feature/login')
    await user.click(screen.getByRole('checkbox', { name: 'Create as draft' }))
    await user.click(screen.getByRole('button', { name: 'Create pull request' }))

    expect(api.api.agent.github.createPull).toHaveBeenCalledWith({
      repo: 'octo/repo',
      title: 'Fix login',
      body: 'Assistant summary',
      base: 'main',
      head: 'feature/login',
      draft: true
    })
    expect(await screen.findByText('Pull request #1 created.')).toBeInTheDocument()
    expect(screen.getByText('https://github.com/octo/repo/pull/1')).toBeInTheDocument()
  })

  it('requires a repository, branches and a title', async () => {
    const user = userEvent.setup()
    renderDialog()
    await screen.findByLabelText('Repository')

    await user.clear(screen.getByLabelText('Head branch'))
    await user.click(screen.getByRole('button', { name: 'Create pull request' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a repository, branches and a title.')
    expect(api.api.agent.github.createPull).not.toHaveBeenCalled()
  })

  it('explains a rejected pull request, for example an unpushed branch', async () => {
    vi.mocked(api.api.agent.github.createPull).mockRejectedValue(
      new Error('GITHUB_UNPROCESSABLE: Validation Failed')
    )
    const user = userEvent.setup()
    renderDialog()
    await screen.findByLabelText('Repository')

    await user.click(screen.getByRole('button', { name: 'Create pull request' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'GitHub rejected this pull request; make sure the head branch is pushed and no pull request exists for it.'
    )
  })

  it('keeps the fields editable when repository detection fails', async () => {
    vi.mocked(api.api.agent.github.repo).mockRejectedValue(new Error('no repo'))
    const user = userEvent.setup()
    renderDialog({ directory: null })

    await waitFor(() => expect(screen.getByLabelText('Repository')).toHaveValue(''))
    await user.type(screen.getByLabelText('Repository'), 'octo/repo')
    await user.type(screen.getByLabelText('Head branch'), 'feature')
    await user.click(screen.getByRole('button', { name: 'Create pull request' }))

    expect(api.api.agent.github.createPull).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'octo/repo', base: 'main', head: 'feature' })
    )
  })
})
