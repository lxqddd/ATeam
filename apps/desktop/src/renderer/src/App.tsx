import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import AppRail from './components/app/AppRail'
import { chatStore } from './chat/store'

function App(): React.JSX.Element {
  const { t } = useTranslation()

  // Settings routes subscribe to config change events through the chat store;
  // initialize it here so a reload that lands on `#/settings` still refreshes.
  useEffect(() => {
    void chatStore.init()
  }, [])

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background-subtle text-foreground">
      <header className="app-titlebar flex h-11 flex-none items-center justify-between px-6">
        <span className="text-body font-medium tracking-[-0.01em] text-foreground">
          {t('app.name')}
        </span>
        <span className="text-caption text-subtle" aria-hidden>
          AI Agent
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <AppRail />
        <div className="flex min-h-0 min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </main>
  )
}

export default App
