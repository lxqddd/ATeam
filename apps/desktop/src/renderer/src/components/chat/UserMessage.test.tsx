import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MessageAttachment } from '@ateam/shared'
import UserMessage from './UserMessage'
import { makeMessage, makeTextPart } from '../../test/factories'

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
