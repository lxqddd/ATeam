import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router'

function getNavLinkClass(isActive: boolean): string {
  const base = 'flex h-8 items-center rounded-md px-2.5 text-label font-medium transition-colors'
  return isActive
    ? `${base} bg-hover font-semibold text-foreground`
    : `${base} text-muted hover:bg-hover hover:text-foreground`
}

function App(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="app-titlebar flex h-11 flex-none items-center justify-between px-6">
        <span className="text-body font-medium tracking-[-0.01em] text-foreground">
          {t('app.name')}
        </span>
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={({ isActive }) => getNavLinkClass(isActive)}>
            {t('nav.home')}
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => getNavLinkClass(isActive)}>
            {t('nav.settings')}
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </main>
  )
}

export default App
