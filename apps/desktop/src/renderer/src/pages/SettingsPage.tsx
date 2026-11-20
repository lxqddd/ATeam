import { useTranslation } from 'react-i18next'

function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <section className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>
      <p className="mt-3 max-w-md text-[15px] text-zinc-600 dark:text-zinc-400">
        {t('settings.description')}
      </p>
    </section>
  )
}

export default SettingsPage
