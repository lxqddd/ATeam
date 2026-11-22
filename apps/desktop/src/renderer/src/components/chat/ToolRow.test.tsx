import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import ToolRow from './ToolRow'
import { makeToolPart } from '../../test/factories'

describe('ToolRow', () => {
  it('renders images returned by a tool', async () => {
    const user = userEvent.setup()
    render(
      <ToolRow
        part={makeToolPart({
          toolCallId: 'call-1',
          toolName: 'read',
          state: 'completed',
          output: 'Image: pixel.png (2 bytes)',
          images: [{ mimeType: 'image/png', data: 'AQID' }]
        })}
      />
    )

    await user.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByRole('img', { name: 'Tool image' })).toHaveAttribute(
      'src',
      'data:image/png;base64,AQID'
    )
  })
})
