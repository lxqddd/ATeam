import { Segmented } from 'antd'
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

function ThemePreview({ preview }: { preview: ThemePreviewColors | null }): React.JSX.Element {
  if (!preview) {
    return (
      <span
        aria-hidden="true"
        className="flex h-7 w-10 flex-none overflow-hidden rounded-sm border border-black/10"
      >
        <span className="flex h-full w-1/2 flex-col justify-between bg-[#f5f5f5] p-1">
          <span className="h-[3px] w-2/3 rounded-[2px] bg-[#18181b]/40" />
          <span className="h-[3px] w-1/2 self-end rounded-[2px] bg-[#f08a5d]" />
        </span>
        <span className="flex h-full w-1/2 flex-col justify-between bg-[#141416] p-1">
          <span className="h-[3px] w-2/3 rounded-[2px] bg-[#f4f4f5]/50" />
          <span className="h-[3px] w-1/2 self-end rounded-[2px] bg-[#f08a5d]" />
        </span>
      </span>
    )
  }

  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-10 flex-none gap-[2px] overflow-hidden rounded-sm border border-black/10 p-[2px]"
      style={{ backgroundColor: preview.background }}
    >
      <span className="flex h-full w-2 flex-col gap-[2px] rounded-[3px] bg-black/5 p-[2px]">
        <span
          className="h-[2px] w-full rounded-full"
          style={{ backgroundColor: preview.text, opacity: 0.28 }}
        />
        <span
          className="h-[2px] w-full rounded-full"
          style={{ backgroundColor: preview.text, opacity: 0.16 }}
        />
      </span>
      <span
        className="flex h-full flex-1 flex-col justify-between rounded-[3px] border border-black/10 p-[3px]"
        style={{ backgroundColor: preview.surface }}
      >
        <span
          className="h-[3.5px] w-1/2 rounded-[2px]"
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

  const options = THEME_OPTIONS.map((option) => ({
    value: option.value,
    label: (
      <span className="flex min-h-[30px] items-center gap-2">
        <ThemePreview preview={option.preview} />
        <span className="text-label font-medium">{t(option.labelKey)}</span>
      </span>
    )
  }))

  return (
    <div data-testid="theme-settings">
      <Segmented
        block
        aria-label={t('settings.theme')}
        options={options}
        value={preference}
        onChange={(value) => setThemePreference(value as ThemePreference)}
      />
    </div>
  )
}

export default ThemeSettings
