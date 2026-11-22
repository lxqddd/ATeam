import { useTranslation } from 'react-i18next'

interface SettingsLoadErrorProps {
  message: string
  onRetry: () => void
}

function SettingsLoadError({ message, onRetry }: SettingsLoadErrorProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <p
        role="alert"
        className="m-0 min-w-0 flex-1 truncate text-caption text-danger"
        title={message}
      >
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="h-7 flex-none rounded-md border border-border bg-surface px-2.5 text-caption font-medium text-foreground transition-colors hover:bg-hover"
      >
        {t('settings.retry')}
      </button>
    </div>
  )
}

export default SettingsLoadError
