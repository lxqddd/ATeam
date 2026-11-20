import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router'
import LanguageSwitcher from './components/LanguageSwitcher'

function getNavLinkClass(isActive: boolean): string {
  const base = 'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors'
  return isActive
    ? `${base} bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50`
    : `${base} text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100`
}

function App(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 px-6 py-5">
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={({ isActive }) => getNavLinkClass(isActive)}>
            {t('nav.home')}
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => getNavLinkClass(isActive)}>
            {t('nav.settings')}
          </NavLink>
        </nav>
        <LanguageSwitcher />
      </header>
      <Outlet />
    </main>
  )
}

export default App
