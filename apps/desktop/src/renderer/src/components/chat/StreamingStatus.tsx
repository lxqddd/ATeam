import { useTranslation } from 'react-i18next'
import type { ChatRetryStatus } from '@ateam/shared'
import { useElapsed } from '../../hooks/useElapsed'

interface StreamingStatusProps {
  startedAt: string
  retry?: ChatRetryStatus
}

function StreamingStatus({ startedAt, retry }: StreamingStatusProps): React.JSX.Element {
  const { t } = useTranslation()
  const seconds = useElapsed(startedAt, true)

  return (
    <div className="flex flex-wrap items-center gap-2 py-0.5 text-caption text-muted">
      <span
        aria-hidden
        className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
      />
      <span>{retry ? t('chat.retrying') : t('chat.working')}</span>
      {retry && (
        <>
          <span className="text-subtle">
            {t('chat.retryStatus', {
              attempt: retry.attempt,
              max: retry.maxAttempts,
              seconds: Math.max(1, Math.ceil(retry.delayMs / 1_000))
            })}
          </span>
          {retry.reason && (
            <span className="max-w-[360px] truncate text-subtle" title={retry.reason}>
              {retry.reason}
            </span>
          )}
        </>
      )}
      {seconds > 0 && <span className="text-subtle">{t('chat.duration', { seconds })}</span>}
    </div>
  )
}

export default StreamingStatus
