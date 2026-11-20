import type { ReactNode } from 'react'

interface SettingsGroupProps {
  title: string
  description?: string
  actions?: ReactNode
  children?: ReactNode
}

export function SettingsGroup({
  title,
  description,
  actions,
  children
}: SettingsGroupProps): React.JSX.Element {
  const hasChildren = children != null

  return (
    <section className="rounded-lg border border-border bg-surface-raised px-5 py-4 shadow-sm">
      <header className={`flex items-start justify-between gap-4 ${hasChildren ? 'mb-3' : ''}`}>
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-caption text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
      </header>
      {hasChildren && <div className="flex flex-col">{children}</div>}
    </section>
  )
}
