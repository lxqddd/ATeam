import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageAttachment } from '@ateam/shared'
import UserMessage from './UserMessage'
import { makeMessage, makeTextPart } from '../../test/factories'
import { createApiMock, type ApiMock } from '../../test/api-mock'

let api: ApiMock

function attachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: 'att-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: 11,
    kind: 'text',
    path: '/tmp/notes.txt',
    ...overrides
  }
}

beforeEach(() => {
  api = createApiMock()
  Object.defineProperty(window, 'api', { value: api.api, configurable: true })
})

describe('UserMessage', () => {
  it('renders text and attachment chips', () => {
    render(
      <UserMessage
        message={makeMessage({
          role: 'user',
          parts: [makeTextPart('read this'), { type: 'attachment', attachment: attachment() }]
        })}
      />
    )

    expect(screen.getByText('read this')).toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(screen.getByText('11 B')).toBeInTheDocument()
  })

  it('shows image thumbnails when previews are available', async () => {
    vi.mocked(window.api.agent.attachments.preview).mockResolvedValueOnce(
      'data:image/png;base64,AQID'
    )

    render(
      <UserMessage
        sessionId="session-1"
        message={makeMessage({
          role: 'user',
          parts: [
            {
              type: 'attachment',
              attachment: attachment({
                id: 'img',
                name: 'shot.png',
                kind: 'image',
                mimeType: 'image/png',
                size: 2048,
                path: '/tmp/attachments/session-1/shot.png'
              })
            }
          ]
        })}
      />
    )

    const image = await screen.findByRole('img', { name: 'shot.png' })
    expect(image).toHaveAttribute('src', 'data:image/png;base64,AQID')
  })

  it('renders attachment-only messages without an empty bubble', () => {
    render(
      <UserMessage
        message={makeMessage({
          role: 'user',
          parts: [
            {
              type: 'attachment',
              attachment: attachment({ id: 'img', name: 'shot.png', kind: 'image', size: 2048 })
            }
          ]
        })}
      />
    )

    expect(screen.getByText('shot.png')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    expect(document.querySelector('.whitespace-pre-wrap')).toBeNull()
  })
})
