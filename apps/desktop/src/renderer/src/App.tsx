import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './components/LanguageSwitcher'

function App(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex justify-end px-6 py-5">
        <LanguageSwitcher />
      </header>
      <section className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <h1 className="text-[40px] font-bold tracking-tight">{t('app.name')}</h1>
        <p className="mt-3 text-[15px] text-zinc-600 dark:text-zinc-400">{t('app.description')}</p>
      </section>
    </main>
  )
}

export default App
