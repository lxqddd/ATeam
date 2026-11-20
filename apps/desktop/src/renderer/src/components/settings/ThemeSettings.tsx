import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme'

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

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.75}
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  )
}

function ThemeSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const { preference, setThemePreference } = useTheme()
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const direction =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0

    if (direction === 0) return

    event.preventDefault()
    const currentIndex = THEME_OPTIONS.findIndex((option) => option.value === preference)
    const nextIndex = (currentIndex + direction + THEME_OPTIONS.length) % THEME_OPTIONS.length
    const next = THEME_OPTIONS[nextIndex]
    if (!next) return

    setThemePreference(next.value)
    buttonsRef.current[nextIndex]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('settings.theme')}
      data-testid="theme-settings"
      onKeyDown={handleKeyDown}
      className="grid grid-cols-[repeat(auto-fit,minmax(156px,1fr))] gap-2"
    >
      {THEME_OPTIONS.map((option, index) => {
        const selected = preference === option.value
        return (
          <button
            key={option.value}
            ref={(element): void => {
              buttonsRef.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={`theme-${option.value}`}
            onClick={() => setThemePreference(option.value)}
            className={[
              'group flex min-h-[46px] items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong',
              selected
                ? 'border-accent bg-accent-soft shadow-sm'
                : 'border-border-subtle bg-surface hover:bg-hover'
            ].join(' ')}
          >
            <ThemePreview preview={option.preview} />
            <span
              className={[
                'min-w-0 flex-1 truncate text-label text-foreground',
                selected ? 'font-semibold' : 'font-medium'
              ].join(' ')}
            >
              {t(option.labelKey)}
            </span>
            <span
              aria-hidden="true"
              className={[
                'flex h-4 w-4 flex-none items-center justify-center text-accent-strong transition-all duration-200',
                selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
              ].join(' ')}
            >
              <CheckIcon />
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default ThemeSettings
