import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitHubCommentDialog from './GitHubCommentDialog'
import { createApiMock, type ApiMock } from '../../test/api-mock'

let api: ApiMock

beforeEach(() => {
  api = createApiMock()
  Object.defineProperty(window, 'api', { value: api.api, configurable: true })
})

function renderDialog(options: { defaultRef?: string | null; defaultBody?: string } = {}): {
  onClose: ReturnType<typeof vi.fn>
} {
  const onClose = vi.fn()
  render(
    <GitHubCommentDialog
      defaultRef={options.defaultRef === undefined ? 'octo/repo#3' : options.defaultRef}
      defaultBody={options.defaultBody ?? 'Assistant summary'}
      onClose={onClose}
    />
  )
  return { onClose }
}

describe('GitHubCommentDialog', () => {
  it('prefills the reference and the last assistant text', () => {
    renderDialog()

    expect(screen.getByLabelText('Issue / PR reference')).toHaveValue('octo/repo#3')
    expect(screen.getByLabelText('Comment')).toHaveValue('Assistant summary')
    expect(
      screen.queryByText('The last turn produced no text to post; write a comment manually.')
    ).not.toBeInTheDocument()
  })

  it('explains when there is no assistant text to post', () => {
    renderDialog({ defaultRef: null, defaultBody: '' })

    expect(screen.getByLabelText('Issue / PR reference')).toHaveValue('')
    expect(
      screen.getByText('The last turn produced no text to post; write a comment manually.')
    ).toBeInTheDocument()
  })

  it('requires a reference and a comment', async () => {
    const user = userEvent.setup()
    renderDialog({ defaultRef: null, defaultBody: '' })

    await user.click(screen.getByRole('button', { name: 'Post comment' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter an issue/PR reference and a comment.'
    )
    expect(api.api.agent.github.comment).not.toHaveBeenCalled()
  })

  it('posts the edited comment and offers to open it', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.clear(screen.getByLabelText('Comment'))
    await user.type(screen.getByLabelText('Comment'), 'Thanks!')
    await user.click(screen.getByRole('button', { name: 'Post comment' }))

    expect(api.api.agent.github.comment).toHaveBeenCalledWith({
      ref: 'octo/repo#3',
      body: 'Thanks!'
    })
    expect(await screen.findByText('Comment posted.')).toBeInTheDocument()
    expect(
      screen.getByText('https://github.com/octo/repo/issues/1#issuecomment-1')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open comment' }))
    expect(api.api.openExternal).toHaveBeenCalledWith(
      'https://github.com/octo/repo/issues/1#issuecomment-1'
    )
  })

  it('translates a rejected comment', async () => {
    vi.mocked(api.api.agent.github.comment).mockRejectedValue(new Error('GITHUB_FORBIDDEN: nope'))
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole('button', { name: 'Post comment' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'GitHub denied this request; check the token scopes.'
    )
    expect(screen.queryByText('Comment posted.')).not.toBeInTheDocument()
  })
})
