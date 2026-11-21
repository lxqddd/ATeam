import type { TodoInput, TodoItem, TodoPriority, TodoStatus } from '@ateam/shared'

export const TODO_STATUSES: readonly TodoStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'cancelled'
]

export const TODO_PRIORITIES: readonly TodoPriority[] = ['high', 'medium', 'low']

export function normalizeTodos(input: TodoInput[]): TodoItem[] {
  return input
    .filter((todo) => todo.content.trim().length > 0)
    .map((todo, index) => ({
      id: `todo-${index + 1}`,
      content: todo.content.trim(),
      status: todo.status,
      priority: todo.priority
    }))
}

export function formatTodoList(todos: TodoItem[]): string {
  if (todos.length === 0) return 'No tasks.'
  const completed = todos.filter((todo) => todo.status === 'completed').length
  const lines = todos.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.content}`)
  return `Tasks (${completed}/${todos.length} completed):\n${lines.join('\n')}`
}
