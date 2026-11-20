import type { ReactNode } from 'react'

interface SettingsRowProps {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
}

export function SettingsRow({ title, description, children }: SettingsRowProps): React.JSX.Element {
  return (
    <div className="settings-row flex min-h-9 flex-wrap items-center gap-x-4 gap-y-2 py-2">
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
        <div className="text-label font-medium text-foreground">{title}</div>
        {description != null && <p className="m-0 text-caption text-muted">{description}</p>}
      </div>
      {children != null && (
        <div className="ml-auto flex flex-none items-center gap-2">{children}</div>
      )}
    </div>
  )
}
