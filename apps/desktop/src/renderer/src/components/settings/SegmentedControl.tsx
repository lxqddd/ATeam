import { useRef } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  testId?: string
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel
}: SegmentedControlProps<T>): React.JSX.Element {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = options.findIndex((option) => option.value === value)

  function moveSelection(direction: 1 | -1): void {
    if (options.length === 0) return
    const nextIndex = (selectedIndex + direction + options.length) % options.length
    const next = options[nextIndex]
    if (!next) return
    onChange(next.value)
    buttonsRef.current[nextIndex]?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveSelection(1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(-1)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background-subtle p-0.5"
    >
      {options.map((option, index) => {
        const selected = option.value === value
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
            data-testid={option.testId}
            onClick={() => {
              if (!selected) onChange(option.value)
            }}
            className={[
              'h-7 rounded-sm border px-3 text-label font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong',
              selected
                ? 'border-border bg-surface text-foreground shadow-sm'
                : 'border-transparent text-muted hover:bg-hover hover:text-foreground'
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
