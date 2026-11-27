import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Empty, Segmented, Spin, Table } from 'antd'
import type { TableProps } from 'antd'
import type {
  UsageStats,
  UsageStatsModelRow,
  UsageStatsRange,
  UsageStatsToolRow
} from '@ateam/shared'
import { errorMessage } from '../lib/errors'

function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language).format(value)
}

function formatCost(value: number): string {
  return `$${value.toFixed(6)}`
}

function StatCard({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-settings-card-bg px-4 py-3">
      <p className="text-caption text-muted">{label}</p>
      <p className="mt-1 truncate text-title font-semibold tracking-[-0.01em] text-foreground">
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-caption text-subtle">{hint}</p>}
    </div>
  )
}

function DistributionCard({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-settings-card-bg">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-body font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-caption text-muted">{description}</p>
      </header>
      {children}
    </section>
  )
}

function isStatsEmpty(stats: UsageStats): boolean {
  return stats.sessionCount === 0 && stats.messageCount === 0
}

function UsagePage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [range, setRange] = useState<UsageStatsRange>('all')
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    window.api.agent.sessions
      .usage(range)
      .then((next) => {
        if (active) setStats(next)
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [range, revision])

  const reload = (): void => {
    setLoading(true)
    setError(null)
    setRevision((current) => current + 1)
  }

  const changeRange = (next: UsageStatsRange): void => {
    if (next === range) return
    setLoading(true)
    setError(null)
    setRange(next)
  }

  const number = (value: number): string => formatNumber(value, i18n.language)

  const toolColumns: TableProps<UsageStatsToolRow>['columns'] = [
    {
      title: t('usage.toolName'),
      dataIndex: 'toolName',
      key: 'toolName',
      render: (value: string) => <span className="font-mono text-caption">{value}</span>,
      sorter: (a, b) => a.toolName.localeCompare(b.toolName)
    },
    {
      title: t('usage.calls'),
      dataIndex: 'calls',
      key: 'calls',
      align: 'right',
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.calls - b.calls
    },
    {
      title: t('usage.failures'),
      dataIndex: 'failed',
      key: 'failed',
      align: 'right',
      sorter: (a, b) => a.failed - b.failed
    }
  ]

  const modelColumns: TableProps<UsageStatsModelRow>['columns'] = [
    {
      title: t('usage.model'),
      key: 'model',
      render: (_, row) => (
        <span className="font-mono text-caption">
          {row.providerId}/{row.modelId}
        </span>
      ),
      sorter: (a, b) => `${a.providerId}/${a.modelId}`.localeCompare(`${b.providerId}/${b.modelId}`)
    },
    {
      title: t('usage.modelMessages'),
      dataIndex: 'messages',
      key: 'messages',
      align: 'right',
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.messages - b.messages
    },
    {
      title: t('usage.inputTokens'),
      dataIndex: 'inputTokens',
      key: 'inputTokens',
      align: 'right',
      sorter: (a, b) => a.inputTokens - b.inputTokens,
      render: (value: number) => number(value)
    },
    {
      title: t('usage.outputTokens'),
      dataIndex: 'outputTokens',
      key: 'outputTokens',
      align: 'right',
      sorter: (a, b) => a.outputTokens - b.outputTokens,
      render: (value: number) => number(value)
    },
    {
      title: t('usage.estimatedCost'),
      dataIndex: 'costUsd',
      key: 'costUsd',
      align: 'right',
      sorter: (a, b) => a.costUsd - b.costUsd,
      render: (value: number) => formatCost(value)
    }
  ]

  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto" data-testid="usage-page">
      <div className="mx-auto w-full max-w-[1100px] px-8 py-7">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-display font-semibold tracking-[-0.01em] text-foreground">
              {t('usage.title')}
            </h1>
            <p className="mt-1.5 text-label text-muted">{t('usage.description')}</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <Segmented
              aria-label={t('usage.range')}
              options={[
                { value: 'all', label: t('usage.rangeAll') },
                { value: '7d', label: t('usage.range7d') },
                { value: '30d', label: t('usage.range30d') }
              ]}
              value={range}
              onChange={(value) => changeRange(value as UsageStatsRange)}
            />
            <Button onClick={reload} loading={loading}>
              {t('usage.refresh')}
            </Button>
          </div>
        </header>

        {error && (
          <Alert
            className="mb-4"
            type="error"
            showIcon
            title={`${t('usage.loadFailed')} ${error}`}
            action={
              <Button size="small" onClick={reload}>
                {t('chat.retry')}
              </Button>
            }
          />
        )}

        {!stats ? (
          <div className="flex items-center justify-center py-24">
            {loading ? (
              <div className="flex items-center gap-2">
                <Spin size="small" />
                <span className="text-label text-muted">{t('usage.loading')}</span>
              </div>
            ) : null}
          </div>
        ) : isStatsEmpty(stats) ? (
          <div className="py-20">
            <Empty
              description={
                <span className="flex flex-col gap-1">
                  <span className="text-label text-muted">{t('usage.empty')}</span>
                  <span className="text-caption text-subtle">{t('usage.emptyHint')}</span>
                </span>
              }
            />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <StatCard label={t('usage.sessions')} value={number(stats.sessionCount)} />
              <StatCard
                label={t('usage.messages')}
                value={number(stats.messageCount)}
                hint={t('usage.assistantMessagesHint', { count: stats.assistantMessageCount })}
              />
              <StatCard label={t('usage.toolCalls')} value={number(stats.toolCallCount)} />
              <StatCard
                label={t('usage.totalTokens')}
                value={number(stats.tokens.totalTokens)}
                hint={`${t('usage.inputTokens')} ${number(stats.tokens.inputTokens)} · ${t(
                  'usage.outputTokens'
                )} ${number(stats.tokens.outputTokens)} · ${t(
                  'usage.cacheReadTokens'
                )} ${number(stats.tokens.cacheReadTokens)}`}
              />
              <StatCard
                label={t('usage.estimatedCost')}
                value={formatCost(stats.costUsd)}
                hint={t('usage.costHint')}
              />
            </div>

            {(stats.assistantMessagesWithoutUsage > 0 ||
              stats.assistantMessagesWithoutCost > 0) && (
              <p className="mt-3 text-caption text-warning">
                {stats.assistantMessagesWithoutUsage > 0
                  ? t('usage.missingUsage', { count: stats.assistantMessagesWithoutUsage })
                  : ''}
                {stats.assistantMessagesWithoutUsage > 0 && stats.assistantMessagesWithoutCost > 0
                  ? ' '
                  : ''}
                {stats.assistantMessagesWithoutCost > 0
                  ? t('usage.missingCost', { count: stats.assistantMessagesWithoutCost })
                  : ''}
              </p>
            )}

            <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
              <DistributionCard
                title={t('usage.toolsTitle')}
                description={t('usage.toolsDescription')}
              >
                <Table
                  size="small"
                  rowKey="toolName"
                  columns={toolColumns}
                  dataSource={stats.tools}
                  pagination={false}
                  locale={{ emptyText: t('usage.toolsEmpty') }}
                />
              </DistributionCard>
              <DistributionCard
                title={t('usage.modelsTitle')}
                description={t('usage.modelsDescription')}
              >
                <Table
                  size="small"
                  rowKey={(row) => `${row.providerId}/${row.modelId}`}
                  columns={modelColumns}
                  dataSource={stats.models}
                  pagination={false}
                  locale={{ emptyText: t('usage.modelsEmpty') }}
                />
              </DistributionCard>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default UsagePage
