import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import LanguageSettings from '../components/settings/LanguageSettings'
import { SettingsGroup } from '../components/settings/SettingsGroup'
import ThemeSettings from '../components/settings/ThemeSettings'

const SETTINGS_SECTIONS = [
  {
    id: 'appearance',
    labelKey: 'settings.appearance',
    descriptionKey: 'settings.appearanceDescription'
  },
  {
    id: 'language',
    labelKey: 'settings.language',
    descriptionKey: 'settings.languageDescription'
  }
] as const

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id']

function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<SettingsSection>('appearance')
  const activeSection =
    SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden" data-testid="settings-page">
      <nav
        aria-label={t('settings.title')}
        className="flex w-[216px] flex-none flex-col gap-0.5 border-r border-border-subtle px-2 py-3"
      >
        {SETTINGS_SECTIONS.map((item) => {
          const active = item.id === section
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              data-testid={`settings-nav-${item.id}`}
              onClick={() => setSection(item.id)}
              className={[
                'flex h-8 w-full items-center rounded-md px-2 text-left text-label font-medium transition-colors',
                active
                  ? 'bg-hover font-semibold text-foreground'
                  : 'text-muted hover:bg-hover hover:text-foreground'
              ].join(' ')}
            >
              {t(item.labelKey)}
            </button>
          )
        })}
      </nav>
      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-7 lg:px-10">
          <header className="mb-6">
            <h1 className="text-display font-semibold tracking-[-0.01em] text-foreground">
              {t(activeSection.labelKey)}
            </h1>
            <p className="mt-1.5 text-label text-muted">{t(activeSection.descriptionKey)}</p>
          </header>
          {section === 'appearance' ? (
            <SettingsGroup title={t('settings.theme')}>
              <ThemeSettings />
            </SettingsGroup>
          ) : (
            <SettingsGroup
              title={t('settings.interfaceLanguage')}
              description={t('settings.interfaceLanguageDescription')}
              actions={<LanguageSettings />}
            />
          )}
        </div>
      </section>
    </div>
  )
}

export default SettingsPage
