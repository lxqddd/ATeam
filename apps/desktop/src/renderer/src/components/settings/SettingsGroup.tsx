import type { ReactNode } from 'react'
import { Card, Typography } from 'antd'

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
    <Card
      size="small"
      title={
        <div className="min-w-0">
          <Typography.Title level={5} className="!mb-0 !text-body">
            {title}
          </Typography.Title>
          {description && (
            <Typography.Text type="secondary" className="!text-caption">
              {description}
            </Typography.Text>
          )}
        </div>
      }
      extra={actions}
    >
      {hasChildren && <div className="flex flex-col">{children}</div>}
    </Card>
  )
}
