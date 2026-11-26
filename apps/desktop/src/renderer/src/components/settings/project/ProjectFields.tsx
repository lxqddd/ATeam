import type { ReactNode } from 'react'

export const inputClass =
  'h-8 w-full rounded-md border border-border bg-surface px-2 text-label text-foreground outline-none placeholder:text-subtle focus:border-border-strong'

export const monoInputClass = `${inputClass} font-mono`

export const textareaClass =
  'w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-caption text-foreground outline-none placeholder:text-subtle focus:border-border-strong'

export const monoTextareaClass = `${textareaClass} font-mono`

export const primaryButtonClass =
  'h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-55'

export const subtleButtonClass =
  'h-8 rounded-md border border-border px-2.5 text-caption font-medium text-foreground transition-colors hover:bg-background-subtle disabled:opacity-55'

export const textButtonClass =
  'h-7 rounded-md px-2 text-caption font-medium text-foreground transition-colors hover:bg-background-subtle disabled:opacity-55'

export const dangerButtonClass =
  'h-7 rounded-md px-2 text-caption font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-55'

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-caption text-muted">
      <span>{label}</span>
      {children}
      {hint !== undefined && <span className="text-[11px] leading-snug text-subtle">{hint}</span>}
    </label>
  )
}

export function PanelHint({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="m-0 text-caption leading-relaxed text-muted">{children}</p>
}

export function PanelError({
  children,
  tone = 'danger'
}: {
  children: ReactNode
  tone?: 'danger' | 'warning'
}): React.JSX.Element {
  return (
    <p
      role="alert"
      className={`m-0 rounded-md px-2.5 py-1.5 text-caption ${
        tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning-soft text-warning'
      }`}
    >
      {children}
    </p>
  )
}

export function FormActions({
  saving,
  onSave,
  onCancel,
  saveLabel,
  cancelLabel,
  disabled
}: {
  saving: boolean
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  cancelLabel: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} className={textButtonClass}>
        {cancelLabel}
      </button>
      <button
        type="button"
        disabled={saving || disabled}
        onClick={onSave}
        className={primaryButtonClass}
      >
        {saveLabel}
      </button>
    </div>
  )
}
