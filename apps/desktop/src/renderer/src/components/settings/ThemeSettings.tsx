import { Radio } from 'antd'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'
import type { ThemePreference } from '../../theme'

interface ThemePreviewColors {
  background: string
  surface: string
  text: string
  accent: string
}

const THEME_OPTIONS = [
  {
    value: 'light',
    labelKey: 'settings.themeLight',
    preview: { background: '#faf9f6', surface: '#ffffff', text: '#211d19', accent: '#9d3f29' }
  },
  {
    value: 'dark',
    labelKey: 'settings.themeDark',
    preview: { background: '#141414', surface: '#1f1f1f', text: '#f2f2f2', accent: '#f08a5d' }
  },
  {
    value: 'system',
    labelKey: 'settings.themeSystem',
    preview: null
  }
] as const

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

function ThemePreview({ preview }: { preview: ThemePreviewColors | null }): React.JSX.Element {
  if (!preview) {
    return (
      <span
        aria-hidden="true"
        className="flex h-7 w-10 flex-none overflow-hidden rounded-sm border border-[rgba(128,128,128,0.24)]"
      >
        <span className="flex h-full w-1/2 flex-col justify-between bg-[#f5f5f5] p-1">
          <span className="h-[3.5px] w-[48%] rounded-[2px] bg-[#18181b]/55" />
        </span>
        <span className="flex h-full w-1/2 flex-col justify-between bg-[#141416] p-1">
          <span className="h-[3.5px] w-[11px] self-end rounded-[2px] bg-[#f08a5d]" />
          <span className="h-[3.5px] w-[48%] rounded-[2px] bg-[#f4f4f5]/65" />
        </span>
      </span>
    )
  }

  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-10 flex-none gap-[2.5px] overflow-hidden rounded-sm border border-[rgba(128,128,128,0.24)] p-[2.5px]"
      style={{ backgroundColor: preview.background }}
    >
      <span className="flex h-full w-2 flex-none flex-col gap-[2.5px] rounded-[3.5px] bg-[rgba(128,128,128,0.1)] px-[1.5px] py-[3px]">
        <span
          className="h-[2px] w-full rounded-[2px]"
          style={{ backgroundColor: preview.text, opacity: 0.28 }}
        />
        <span
          className="h-[2px] w-full rounded-[2px]"
          style={{ backgroundColor: preview.text, opacity: 0.16 }}
        />
      </span>
      <span
        className="flex h-full flex-1 flex-col justify-between rounded-[4.5px] border border-[rgba(128,128,128,0.14)] px-1 py-[3px]"
        style={{ backgroundColor: preview.surface }}
      >
        <span
          className="h-[3.5px] w-[48%] rounded-[2px]"
          style={{ backgroundColor: preview.text, opacity: 0.52 }}
        />
        <span
          className="h-[3.5px] w-[11px] self-end rounded-[2px]"
          style={{ backgroundColor: preview.accent }}
        />
      </span>
    </span>
  )
}

function ThemeSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const { preference, setThemePreference } = useTheme()

  return (
    <div data-testid="theme-settings" className="w-full">
      <Radio.Group
        className="theme-choices"
        aria-label={t('settings.theme')}
        value={preference}
        onChange={(event) => {
          setThemePreference(event.target.value as ThemePreference)
        }}
      >
        {THEME_OPTIONS.map((option) => {
          const selected = preference === option.value
          return (
            <Radio key={option.value} value={option.value}>
              <span
                className={`theme-choice flex min-h-[46px] w-full items-center gap-2 rounded-lg border px-[10px] py-[9px] text-left transition-colors ${
                  selected
                    ? 'theme-choice-selected'
                    : 'border-border-subtle bg-surface [box-shadow:var(--highlight-inset)] hover:border-border hover:bg-hover'
                }`}
              >
                <ThemePreview preview={option.preview} />
                <span
                  className={`min-w-0 truncate text-label leading-[1.3] ${
                    selected ? 'font-semibold' : 'font-medium'
                  }`}
                >
                  {t(option.labelKey)}
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
