import { CheckCircleFilled } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, currentLanguage, setLanguage } from '../i18n'
import { THEMES, useTheme } from '../theme'

export function SettingsView() {
  const { t } = useTranslation()
  const { pref, setPref } = useTheme()
  const language = currentLanguage()

  return (
    <div className="space-y-4">
      <section id="settings-appearance" className="cd-card p-5">
        <h2 className="cd-subtitle">{t('settings.appearance.title')}</h2>
        <p className="cd-caption mt-1 text-faint">{t('settings.appearance.desc')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {THEMES.map((theme) => {
            const active = pref === theme.id
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={active}
                onClick={() => setPref(theme.id)}
                className={`cd-card p-3 text-left transition-colors ${
                  active ? 'ring-2 ring-accent' : 'hover:border-accent/40'
                }`}
              >
                <span className="flex h-9 overflow-hidden rounded-md border border-line">
                  {theme.swatch.map((color, index) => (
                    <span key={index} className="flex-1" style={{ background: color }} />
                  ))}
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <span className="cd-label">{t(theme.nameKey)}</span>
                  {active && <CheckCircleFilled className="text-accent" />}
                </span>
                <span className="mt-0.5 block text-[11px] leading-[17px] text-faint">
                  {t(theme.descKey)}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section id="settings-language" className="cd-card p-5">
        <h2 className="cd-subtitle">{t('settings.language.title')}</h2>
        <p className="cd-caption mt-1 text-faint">{t('settings.language.desc')}</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {LANGUAGES.map((item) => {
            const active = language === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => setLanguage(item.id)}
                className={`cd-card flex items-center justify-between gap-3 p-3 text-left transition-colors ${
                  active ? 'ring-2 ring-accent' : 'hover:border-accent/40'
                }`}
              >
                <span className="min-w-0">
                  <span className="cd-label block">{t(item.labelKey)}</span>
                  <span className="mt-0.5 block text-[11px] text-faint">{item.id}</span>
                </span>
                {active && <CheckCircleFilled className="text-accent" />}
              </button>
            )
          })}
        </div>
      </section>

      <section id="settings-kernel" className="cd-card p-5">
        <h2 className="cd-subtitle">{t('settings.kernel.title')}</h2>
        <p className="mt-1 text-[13px] leading-[20px] text-muted">{t('settings.kernel.desc')}</p>
      </section>

      <section id="settings-permissions" className="cd-card p-5">
        <h2 className="cd-subtitle">{t('settings.permissions.title')}</h2>
        <p className="mt-1 text-[13px] leading-[20px] text-muted">{t('settings.permissions.desc')}</p>
      </section>
    </div>
  )
}
