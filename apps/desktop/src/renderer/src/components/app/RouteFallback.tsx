import { useTranslation } from 'react-i18next'

function RouteFallback(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center gap-2 text-caption text-muted"
      data-testid="route-loading"
      role="status"
    >
      <span
        aria-hidden
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      {t('app.loading')}
    </div>
  )
}

export default RouteFallback
