import { useTranslation } from 'react-i18next'
import type { BackgroundTaskInfo } from '@ateam/shared'
import { chatStore } from '../../chat/store'

interface BackgroundNoticesProps {
  tasks: BackgroundTaskInfo[]
}

function BackgroundNotices({ tasks }: BackgroundNoticesProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const running = tasks.filter((task) => task.state === 'running')
  if (running.length === 0) return null

  return (
    <div className="mx-auto flex w-full max-w-[768px] flex-col gap-1 px-4 pb-2">
      {running.map((task) => (
        <div
          key={task.id}
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-background-subtle px-3 py-1.5 text-caption text-muted"
        >
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="font-medium text-foreground">
            {t(
              task.kind === 'shell'
                ? 'chat.backgroundShellRunning'
                : 'chat.backgroundSubagentRunning'
            )}
          </span>
          <code className="max-w-[280px] truncate text-muted" title={task.title}>
            {task.title}
          </code>
          <button
            type="button"
            onClick={() => {
              void chatStore.cancelBackgroundTask(task.id).catch(() => undefined)
            }}
            className="ml-auto rounded px-2 py-0.5 text-caption font-medium text-foreground transition-colors hover:bg-hover"
          >
            {t('chat.backgroundCancel')}
          </button>
        </div>
      ))}
    </div>
  )
}

export default BackgroundNotices
