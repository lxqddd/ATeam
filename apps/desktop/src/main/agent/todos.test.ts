import { describe, expect, it } from 'vitest'
import { formatTodoList, normalizeTodos } from './todos'

describe('normalizeTodos', () => {
  it('assigns stable ids and keeps order', () => {
    expect(
      normalizeTodos([
        { content: 'Write tests', status: 'in_progress', priority: 'high' },
        { content: 'Ship it', status: 'pending', priority: 'medium' }
      ])
    ).toEqual([
      { id: 'todo-1', content: 'Write tests', status: 'in_progress', priority: 'high' },
      { id: 'todo-2', content: 'Ship it', status: 'pending', priority: 'medium' }
    ])
  })

  it('drops empty entries', () => {
    expect(
      normalizeTodos([
        { content: '  ', status: 'pending', priority: 'low' },
        { content: 'Keep', status: 'cancelled', priority: 'low' }
      ])
    ).toEqual([{ id: 'todo-1', content: 'Keep', status: 'cancelled', priority: 'low' }])
  })
})

describe('formatTodoList', () => {
  it('renders progress and item statuses', () => {
    const text = formatTodoList(
      normalizeTodos([
        { content: 'Write tests', status: 'completed', priority: 'high' },
        { content: 'Implement', status: 'in_progress', priority: 'medium' },
        { content: 'Docs', status: 'pending', priority: 'low' }
      ])
    )

    expect(text).toContain('Tasks (1/3 completed):')
    expect(text).toContain('1. [completed] Write tests')
    expect(text).toContain('2. [in_progress] Implement')
    expect(text).toContain('3. [pending] Docs')
  })

  it('handles empty lists', () => {
    expect(formatTodoList([])).toBe('No tasks.')
  })
})
