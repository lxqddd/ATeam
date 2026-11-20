import { useTranslation } from 'react-i18next'
import { useElapsed } from '../../hooks/useElapsed'

interface StreamingStatusProps {
  startedAt: string
}

function StreamingStatus({ startedAt }: StreamingStatusProps): React.JSX.Element {
  const { t } = useTranslation()
  const seconds = useElapsed(startedAt, true)

  return (
    <div className="flex items-center gap-2 py-0.5 text-caption text-muted">
      <span
        aria-hidden
        className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
      />
      <span>{t('chat.working')}</span>
      {seconds > 0 && <span className="text-subtle">{t('chat.duration', { seconds })}</span>}
    </div>
  )
}

export default StreamingStatus
