import { Radio, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import { THEMES, useTheme } from '../../theme'
import type { ThemeMeta, ThemePreference } from '../../theme'

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function ThemePreview({ swatch }: { swatch: ThemeMeta['swatch'] }): React.JSX.Element {
  const [background, surface, text, accent] = swatch

  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-10 flex-none gap-[2.5px] overflow-hidden rounded-sm border border-[rgba(128,128,128,0.24)] p-[2.5px]"
      style={{ backgroundColor: background }}
    >
      <span className="flex h-full w-2 flex-none flex-col gap-[2.5px] rounded-[3.5px] bg-[rgba(128,128,128,0.1)] px-[1.5px] py-[3px]">
        <span
          className="h-[2px] w-full rounded-[2px]"
          style={{ backgroundColor: text, opacity: 0.28 }}
        />
        <span
          className="h-[2px] w-full rounded-[2px]"
          style={{ backgroundColor: text, opacity: 0.16 }}
        />
      </span>
      <span
        className="flex h-full flex-1 flex-col justify-between rounded-[4.5px] border border-[rgba(128,128,128,0.14)] px-1 py-[3px]"
        style={{ backgroundColor: surface }}
      >
        <span
          className="h-[3.5px] w-[48%] rounded-[2px]"
          style={{ backgroundColor: text, opacity: 0.52 }}
        />
        <span
          className="h-[3.5px] w-[11px] self-end rounded-[2px]"
          style={{ backgroundColor: accent }}
        />
      </span>
    </span>
  )
}

function ThemeSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const { preference, resolvedTheme, setThemePreference } = useTheme()

  return (
    <div data-testid="theme-settings" className="w-full">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-label font-medium text-foreground">{t('settings.themeSystem')}</span>
        <Switch
          checked={preference === 'system'}
          aria-label={t('settings.themeSystem')}
          onChange={(checked) => {
            setThemePreference(checked ? 'system' : resolvedTheme)
          }}
        />
      </div>
      <Radio.Group
        className="theme-choices"
        aria-label={t('settings.theme')}
        value={preference}
        onChange={(event) => {
          setThemePreference(event.target.value as ThemePreference)
        }}
      >
        {THEMES.map((theme) => {
          const selected = preference === theme.id
          return (
            <Radio key={theme.id} value={theme.id}>
              <span
                className={`theme-choice flex min-h-[46px] w-full items-center gap-2 rounded-lg border px-[10px] py-[9px] text-left transition-colors ${
                  selected
                    ? 'theme-choice-selected'
                    : 'border-border-subtle bg-surface [box-shadow:var(--highlight-inset)] hover:border-border hover:bg-hover'
                }`}
              >
                <ThemePreview swatch={theme.swatch} />
                <span
                  className={`min-w-0 truncate text-label leading-[1.3] ${
                    selected ? 'font-semibold' : 'font-medium'
                  }`}
                >
                  {t(theme.labelKey)}
                </span>
                <span
                  aria-hidden="true"
                  className={`ml-auto flex-none text-accent-strong transition-opacity ${
                    selected ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <CheckIcon />
                </span>
              </span>
            </Radio>
          )
        })}
      </Radio.Group>
    </div>
  )
}

export default ThemeSettings
