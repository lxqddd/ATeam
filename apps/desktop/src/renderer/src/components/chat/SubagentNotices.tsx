import { useTranslation } from 'react-i18next'
import type { SubagentResult } from '@ateam/shared'

interface SubagentNoticesProps {
  results: SubagentResult[]
  onDismiss: (toolCallId: string) => void
}

const STATUS_KEYS: Record<SubagentResult['status'], string> = {
  completed: 'chat.subagentStatusCompleted',
  failed: 'chat.subagentStatusFailed',
  interrupted: 'chat.subagentStatusInterrupted'
}

function SubagentNotices({ results, onDismiss }: SubagentNoticesProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (results.length === 0) return null

  return (
    <div className="mx-auto flex w-full max-w-[768px] flex-col gap-2 px-4 pb-2">
      {results.map((result) => (
        <div
          key={result.toolCallId}
          role="status"
          className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-caption font-medium text-foreground">
              {t('chat.subagentFinished')} · {result.agentId} · {t(STATUS_KEYS[result.status])}
            </span>
            <button
              type="button"
              aria-label={t('chat.dismiss')}
              onClick={() => onDismiss(result.toolCallId)}
              className="h-6 flex-none rounded px-1.5 text-caption text-subtle transition-colors hover:bg-hover hover:text-foreground"
            >
              ×
            </button>
          </div>
          {result.result && (
            <p className="mt-1 mb-0 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-caption leading-[1.55] text-muted">
              {result.result}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

export default SubagentNotices
