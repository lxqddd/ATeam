import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VcsDiffResult, VcsStatus } from '@ateam/shared'
import { DiffHunks } from './DiffHunks'
import { STATUS_CLASS, STATUS_KEY } from './diff-style'

interface GitChangesViewProps {
  sessionId: string
}

/**
 * Read-only snapshot of the session workspace's Git state.
 *
 * Loads once when opened; closing and reopening the panel refreshes it.
 */
export function GitChangesView({ sessionId }: GitChangesViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = useState<VcsStatus | null>(null)
  const [diff, setDiff] = useState<VcsDiffResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.api.agent.vcs.status(sessionId),
      window.api.agent.vcs.diff(sessionId, { mode: 'working' })
    ])
      .then(([nextStatus, nextDiff]) => {
        if (cancelled) return
        setStatus(nextStatus)
        setDiff(nextDiff)
        setSelectedPath(nextDiff.files[0]?.path ?? null)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const files = useMemo(() => diff?.files ?? [], [diff])
  const selected = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? null,
    [files, selectedPath]
  )
  const totals = useMemo(
    () => ({
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0)
    }),
    [files]
  )

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-caption text-muted">
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        {t('chat.changesLoading')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-label font-medium text-danger">{t('chat.gitLoadFailed')}</p>
        <p className="max-w-[520px] break-words text-caption text-subtle">{error}</p>
      </div>
    )
  }

  if (!status?.info.isRepository) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-caption text-muted">
        {t('chat.gitNotRepository')}
      </div>
    )
  }

  const { branch, defaultBranch } = status.info

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2 text-caption">
        <span className="text-subtle">
          {branch ? t('chat.gitBranch', { branch }) : t('chat.gitDetached')}
        </span>
        {defaultBranch && (
          <span className="text-subtle">
            {t('chat.gitDefaultBranch', { branch: defaultBranch })}
          </span>
        )}
        <span className="flex-1" />
        <span className="text-subtle">
          {t('chat.changesSummary', {
            count: files.length,
            additions: totals.additions,
            deletions: totals.deletions
          })}
        </span>
      </div>

      {diff?.truncated && (
        <p className="flex-none border-b border-border-subtle bg-warning/10 px-4 py-2 text-caption text-warning">
          {t('chat.gitTruncated')}
        </p>
      )}

      {files.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-caption text-muted">
          {t('chat.gitEmpty')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ul className="m-0 flex w-[260px] flex-none list-none flex-col gap-0.5 overflow-y-auto border-r border-border-subtle p-2">
            {files.map((file) => (
              <li key={file.path} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  title={file.path}
                  className={`flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                    file.path === selectedPath ? 'bg-hover' : 'hover:bg-hover'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`flex-none text-[11px] font-semibold uppercase ${STATUS_CLASS[file.status]}`}
                    >
                      {t(STATUS_KEY[file.status])}
                    </span>
                    <span className="min-w-0 truncate text-caption text-foreground">
                      {file.path}
                    </span>
                  </span>
                  <span className="text-[11px] text-subtle">
                    +{file.additions} −{file.deletions}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                <div className="flex flex-none items-center gap-2 border-b border-border-subtle px-3 py-2">
                  <span
                    className="min-w-0 flex-1 truncate text-caption font-medium text-foreground"
                    title={selected.path}
                  >
                    {selected.path}
                  </span>
                  <span
                    className={`flex-none text-[11px] font-semibold uppercase ${STATUS_CLASS[selected.status]}`}
                  >
                    {t(STATUS_KEY[selected.status])}
                  </span>
                  <span className="flex-none text-[11px] text-subtle">
                    +{selected.additions} −{selected.deletions}
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-background-subtle">
                  {selected.binary ? (
                    <p className="px-3 py-3 text-caption text-subtle">{t('chat.changesBinary')}</p>
                  ) : selected.truncated ? (
                    <p className="px-3 py-3 text-caption text-warning">
                      {t('chat.changesTruncated')}
                    </p>
                  ) : selected.hunks.length === 0 ? (
                    <p className="px-3 py-3 text-caption text-subtle">{t('chat.changesNoDiff')}</p>
                  ) : (
                    <DiffHunks hunks={selected.hunks} />
                  )}
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-caption text-muted">
                {t('chat.changesSelectFile')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default GitChangesView
