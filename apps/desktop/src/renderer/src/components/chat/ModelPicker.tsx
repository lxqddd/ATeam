import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelRef, ModelsConfigPublic } from '@ateam/shared'

interface ModelPickerProps {
  models: ModelsConfigPublic | null
  value: ModelRef | null
  onChange: (model: ModelRef) => void
  disabled?: boolean
}

function sameModel(a: ModelRef | null, b: ModelRef): boolean {
  return Boolean(a && a.providerId === b.providerId && a.modelId === b.modelId)
}

function ModelPicker({
  models,
  value,
  onChange,
  disabled = false
}: ModelPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const available = models?.models ?? []
  const current = value
    ? models?.models.find(
        (model) => model.providerId === value.providerId && model.modelId === value.modelId
      )
    : undefined
  const label =
    current?.name ?? (value ? `${value.providerId}/${value.modelId}` : t('chat.selectModel'))
  const empty = available.length === 0

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled || empty}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={empty ? t('chat.noModel') : label}
        className="flex h-7 max-w-[240px] items-center gap-1.5 rounded-md px-2 text-caption font-medium text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M9 9h6M9 13h6M9 17h3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <span className="truncate">{empty ? t('chat.noModel') : label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="flex-none"
        >
          <path
            d="m6 9 6 6 6-6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && models && (
        <div
          role="listbox"
          aria-label={t('chat.selectModel')}
          className="absolute bottom-full left-0 z-30 mb-1.5 max-h-72 w-72 overflow-y-auto rounded-md border border-border bg-surface-raised p-1 shadow-lg"
        >
          {models.providers.map((provider) => {
            const providerModels = models.models.filter((model) => model.providerId === provider.id)
            if (providerModels.length === 0) return null
            return (
              <div key={provider.id} className="pb-1">
                <div className="px-2 py-1 text-caption font-medium text-subtle">
                  {provider.name}
                </div>
                {providerModels.map((model) => {
                  const ref = { providerId: model.providerId, modelId: model.modelId }
                  const active = sameModel(value, ref)
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onChange(ref)
                        setOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-hover ${
                        active ? 'bg-hover' : ''
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label font-medium text-foreground">
                          {model.name}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-subtle">
                          {model.modelId}
                        </span>
                      </span>
                      {active && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="m5 12.5 4.2 4L19 7"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ModelPicker
