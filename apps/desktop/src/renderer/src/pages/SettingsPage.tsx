import { Menu } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import AgentSettings from '../components/settings/AgentSettings'
import LanguageSettings from '../components/settings/LanguageSettings'
import McpServers from '../components/settings/McpServers'
import PermissionRules from '../components/settings/PermissionRules'
import WebSearchSettings from '../components/settings/WebSearchSettings'
import { SettingsGroup } from '../components/settings/SettingsGroup'
import ThemeSettings from '../components/settings/ThemeSettings'
import UpdateSettings from '../components/settings/UpdateSettings'

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
    id: 'permissions',
    labelKey: 'settings.permissions',
    descriptionKey: 'settings.permissionsDescription'
  },
  {
    id: 'mcp',
    labelKey: 'settings.mcp',
    descriptionKey: 'settings.mcpDescription'
  },
  {
    id: 'web',
    labelKey: 'settings.web',
    descriptionKey: 'settings.webDescription'
  },
  {
    id: 'agent',
    labelKey: 'settings.agent',
    descriptionKey: 'settings.agentDescription'
  },
  {
    id: 'update',
    labelKey: 'settings.update',
    descriptionKey: 'settings.updateDescription'
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
      <nav className="settings-nav flex w-[216px] flex-none flex-col overflow-y-auto border-r border-pane-divider px-2 py-3">
        <Menu
          mode="inline"
          inlineIndent={8}
          aria-label={t('settings.title')}
          selectedKeys={[section]}
          onClick={({ key }) => selectSection(key as SettingsSection)}
          items={SETTINGS_SECTIONS.map((item) => ({
            key: item.id,
            label: t(item.labelKey)
          }))}
        />
      </nav>
      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1240px] px-10 pt-7">
          <header className="mb-5">
            <h1 className="text-display font-semibold tracking-[-0.01em] text-foreground">
              {t(activeSection.labelKey)}
            </h1>
            <p className="mt-1.5 text-label leading-[1.6] text-muted">
              {t(activeSection.descriptionKey)}
            </p>
          </header>
          <div className="flex flex-col gap-4">
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
            {section === 'permissions' && (
              <SettingsGroup
                title={t('settings.permissionRules')}
                description={t('settings.permissionRulesDescription')}
              >
                <PermissionRules />
              </SettingsGroup>
            )}
            {section === 'mcp' && (
              <SettingsGroup
                title={t('settings.mcpServers')}
                description={t('settings.mcpServersDescription')}
              >
                <McpServers />
              </SettingsGroup>
            )}
            {section === 'web' && (
              <SettingsGroup title={t('settings.web')} description={t('settings.webDescription')}>
                <WebSearchSettings />
              </SettingsGroup>
            )}
            {section === 'agent' && (
              <SettingsGroup
                title={t('settings.agent')}
                description={t('settings.agentDescription')}
              >
                <AgentSettings />
              </SettingsGroup>
            )}
            {section === 'update' && (
              <SettingsGroup
                title={t('settings.update')}
                description={t('settings.updateDescription')}
              >
                <UpdateSettings />
              </SettingsGroup>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

export default SettingsPage
