import { useTranslation } from 'react-i18next'

function HomePage(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <section className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <h1 className="text-display font-semibold tracking-[-0.01em] text-foreground">
        {t('app.name')}
      </h1>
      <p className="mt-2 max-w-md text-body text-muted">{t('app.description')}</p>
    </section>
  )
}

export default HomePage
