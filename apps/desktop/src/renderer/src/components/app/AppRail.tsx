import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'

function ChatIcon(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.3 9.3 0 0 1-3.8-.8L3 21l1.9-4.6a8.2 8.2 0 0 1-1-4A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
    </svg>
  )
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  )
}

function railLinkClass({ isActive }: { isActive: boolean }): string {
  const base = 'flex h-8 w-8 items-center justify-center rounded-md transition-colors'
  return isActive
    ? `${base} bg-hover text-foreground`
    : `${base} text-muted hover:bg-hover hover:text-foreground`
}

function AppRail(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <nav
      aria-label={t('app.name')}
      data-testid="app-rail"
      className="flex w-[52px] flex-none flex-col items-center gap-1 px-2 py-2.5"
    >
      <NavLink
        to="/"
        end
        className={railLinkClass}
        title={t('nav.chat')}
        aria-label={t('nav.chat')}
      >
        <ChatIcon />
      </NavLink>
      <span className="flex-1" />
      <NavLink
        to="/settings"
        className={railLinkClass}
        title={t('nav.settings')}
        aria-label={t('nav.settings')}
      >
        <SettingsIcon />
      </NavLink>
    </nav>
  )
}

export default AppRail
