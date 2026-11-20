import { Menu } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import LanguageSettings from '../components/settings/LanguageSettings'
import ModelSettings from '../components/settings/ModelSettings'
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
  },
  {
    id: 'models',
    labelKey: 'settings.models',
    descriptionKey: 'settings.modelsDescription'
  }
] as const

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id']

function isSettingsSection(value: string | null): value is SettingsSection {
  return SETTINGS_SECTIONS.some((item) => item.id === value)
}

function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('section')
  const section: SettingsSection = isSettingsSection(requested) ? requested : 'appearance'
  const activeSection =
    SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]

  function selectSection(next: SettingsSection): void {
    const params = new URLSearchParams(searchParams)
    params.set('section', next)
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden" data-testid="settings-page">
      <div className="flex w-[216px] flex-none flex-col border-r border-border-subtle px-2 py-3">
        <Menu
          mode="inline"
          aria-label={t('settings.title')}
          selectedKeys={[section]}
          onClick={({ key }) => selectSection(key as SettingsSection)}
          items={SETTINGS_SECTIONS.map((item) => ({
            key: item.id,
            label: t(item.labelKey)
          }))}
        />
      </div>
      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-7 lg:px-10">
          <header className="mb-6">
            <h1 className="text-display font-semibold tracking-[-0.01em] text-foreground">
              {t(activeSection.labelKey)}
            </h1>
            <p className="mt-1.5 text-label text-muted">{t(activeSection.descriptionKey)}</p>
          </header>
          {section === 'appearance' && (
            <SettingsGroup title={t('settings.theme')}>
              <ThemeSettings />
            </SettingsGroup>
          )}
          {section === 'language' && (
            <SettingsGroup
              title={t('settings.interfaceLanguage')}
              description={t('settings.interfaceLanguageDescription')}
              actions={<LanguageSettings />}
            />
          )}
          {section === 'models' && <ModelSettings />}
        </div>
      </section>
    </div>
  )
}

export default SettingsPage
