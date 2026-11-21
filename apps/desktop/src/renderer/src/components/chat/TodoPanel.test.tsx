import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TodoItem } from '@ateam/shared'
import TodoPanel from './TodoPanel'

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-1',
    content: 'Write tests',
    status: 'in_progress',
    priority: 'medium',
    ...overrides
  }
}

describe('TodoPanel', () => {
  it('renders tasks with progress', () => {
    render(
      <TodoPanel
        todos={[
          todo(),
          todo({ id: 'todo-2', content: 'Ship it', status: 'completed' }),
          todo({ id: 'todo-3', content: 'Dropped', status: 'cancelled' })
        ]}
      />
    )

    expect(screen.getByLabelText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText('Ship it')).toBeInTheDocument()
  })

  it('renders nothing without tasks', () => {
    const { container } = render(<TodoPanel todos={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
