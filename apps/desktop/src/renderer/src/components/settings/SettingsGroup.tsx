import { useId } from 'react'
import type { ReactNode } from 'react'

interface SettingsGroupProps {
  title?: string
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
  const id = useId()
  const hasHead = title != null || description != null || actions != null
  const hasChildren = children != null

  return (
    <section
      aria-labelledby={title != null ? id : undefined}
      className="flex flex-col gap-2 rounded-lg border border-border bg-settings-card-bg px-5 py-4 [box-shadow:var(--shadow-sm),var(--highlight-inset)]"
    >
      {hasHead && (
        <div className="settings-group__head flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title != null && (
              <h3 id={id} className="m-0 text-body font-semibold text-foreground">
                {title}
              </h3>
            )}
            {description != null && <p className="m-0 text-caption text-muted">{description}</p>}
          </div>
          {actions != null && <div className="flex flex-none items-center gap-2">{actions}</div>}
        </div>
      )}
      {hasChildren && (
        <div
          className={
            hasHead
              ? 'settings-group__rows mt-1 flex flex-col'
              : 'settings-group__rows flex flex-col'
          }
        >
          {children}
        </div>
      )}
    </section>
  )
}
