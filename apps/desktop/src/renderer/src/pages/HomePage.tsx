import { useTranslation } from 'react-i18next'

function HomePage(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <section className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <h1 className="text-[40px] font-bold tracking-tight">{t('app.name')}</h1>
      <p className="mt-3 text-[15px] text-zinc-600 dark:text-zinc-400">{t('app.description')}</p>
    </section>
  )
}

export default HomePage
