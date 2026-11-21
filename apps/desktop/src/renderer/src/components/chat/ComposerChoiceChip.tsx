import { useEffect, useRef, useState } from 'react'

export interface ComposerChoiceOption {
  value: string
  label: string
  description?: string
}

interface ComposerChoiceChipProps {
  ariaLabel: string
  accessibleLabel?: string
  label: string
  value: string
  options: ComposerChoiceOption[]
  onChange: (value: string) => void
  disabled?: boolean
  icon?: React.ReactNode
}

function ChevronDown(): React.JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="flex-none">
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m5 12 5 5L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ComposerChoiceChip({
  ariaLabel,
  accessibleLabel,
  label,
  value,
  options,
  onChange,
  disabled = false,
  icon
}: ComposerChoiceChipProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonLabel = accessibleLabel ?? `${ariaLabel}: ${label}`

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: MouseEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={buttonLabel}
        title={buttonLabel}
        onClick={() => setOpen((current) => !current)}
        className="flex h-7 max-w-[190px] items-center gap-1.5 rounded-md px-2 text-caption font-medium text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
      >
        {icon}
        <span className="truncate">{label}</span>
        <ChevronDown />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute bottom-full left-0 z-30 mb-1.5 w-64 rounded-md border border-border bg-surface-raised p-1 shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                setOpen(false)
                if (option.value !== value) onChange(option.value)
              }}
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-label text-foreground">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-caption leading-snug text-muted">
                    {option.description}
                  </span>
                )}
              </span>
              {option.value === value && (
                <span className="mt-0.5 flex-none text-accent-strong">
                  <CheckIcon />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default ComposerChoiceChip
