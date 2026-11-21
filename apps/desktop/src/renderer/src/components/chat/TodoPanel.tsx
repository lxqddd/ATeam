import { useTranslation } from 'react-i18next'
import type { TodoItem, TodoStatus } from '@ateam/shared'

const DOT_CLASS: Record<TodoStatus, string> = {
  pending: 'bg-subtle',
  in_progress: 'bg-accent',
  completed: 'bg-success',
  cancelled: 'bg-danger/60'
}

const TEXT_CLASS: Record<TodoStatus, string> = {
  pending: 'text-foreground',
  in_progress: 'text-foreground',
  completed: 'text-muted line-through',
  cancelled: 'text-subtle line-through'
}

interface TodoPanelProps {
  todos: TodoItem[]
}

function TodoPanel({ todos }: TodoPanelProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (todos.length === 0) return null
  const completed = todos.filter((todo) => todo.status === 'completed').length

  return (
    <section
      aria-label={t('chat.todos')}
      className="mx-auto w-full max-w-[768px] flex-none px-4 pt-2"
    >
      <details
        open
        className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
      >
        <summary className="flex cursor-pointer select-none items-center justify-between gap-2 text-caption text-muted">
          <span className="font-medium text-foreground">{t('chat.todos')}</span>
          <span>
            {completed}/{todos.length}
          </span>
        </summary>
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
          {todos.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2 text-caption">
              <span
                aria-hidden
                className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${DOT_CLASS[todo.status]}`}
              />
              <span className={`min-w-0 break-words ${TEXT_CLASS[todo.status]}`}>
                {todo.content}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}

export default TodoPanel
