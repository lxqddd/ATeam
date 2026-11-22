import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileChangeStatus, TurnChanges } from '@ateam/shared'

const STATUS_CLASS: Record<FileChangeStatus, string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger'
}

const STATUS_KEY: Record<FileChangeStatus, string> = {
  added: 'chat.changesAdded',
  modified: 'chat.changesModified',
  deleted: 'chat.changesDeleted'
}

function lineClass(line: string): string {
  if (line.startsWith('+')) return 'bg-success/10 text-success'
  if (line.startsWith('-')) return 'bg-danger/10 text-danger'
  if (line.startsWith('@@')) return 'text-accent-strong'
  return 'text-muted'
}

interface ChangesPanelProps {
  sessionId: string
  messageId: string
  onClose: () => void
}

function ChangesPanel({ sessionId, messageId, onClose }: ChangesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [turn, setTurn] = useState<TurnChanges | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [revertError, setRevertError] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.agent.sessions
      .changes(sessionId, messageId)
      .then((result) => {
        if (cancelled) return
        setTurn(result)
        setSelectedPath(result.files[0]?.path ?? null)
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
  }, [sessionId, messageId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const selected = useMemo(
    () => turn?.files.find((file) => file.path === selectedPath) ?? null,
    [turn, selectedPath]
  )
  const totals = useMemo(() => {
    const files = turn?.files ?? []
    return {
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0)
    }
  }, [turn])

  async function revert(paths: string[]): Promise<void> {
    setBusyPath(paths.length === 1 ? paths[0] : 'all')
    setRevertError(null)
    try {
      const result = await window.api.agent.sessions.revertFiles(sessionId, messageId, paths)
      setTurn(result)
      setConfirmAll(false)
      setSelectedPath((current) =>
        result.files.some((file) => file.path === current)
          ? current
          : (result.files[0]?.path ?? null)
      )
    } catch (caught) {
      setRevertError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusyPath(null)
    }
  }

  const revertingAll = busyPath === 'all'
  const canRevert = Boolean(turn?.canRevert)

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.changesTitle')}
        className="relative flex h-full w-full max-w-[760px] flex-col border-l border-border bg-surface shadow-xl"
      >
        <header className="flex flex-none items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-foreground">{t('chat.changesTitle')}</h2>
            {turn && (
              <p className="mt-0.5 text-caption text-muted">
                {t('chat.changesSummary', {
                  count: turn.files.length,
                  additions: totals.additions,
                  deletions: totals.deletions
                })}
              </p>
            )}
          </div>
          <div className="flex flex-none items-center gap-2">
            {canRevert && (turn?.files.length ?? 0) > 0 && !confirmAll && (
              <button
                type="button"
                disabled={revertingAll}
                onClick={() => setConfirmAll(true)}
                className="h-8 rounded-md border border-danger/40 bg-danger/10 px-3 text-caption font-medium text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
              >
                {t('chat.changesRevertAll')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-md px-2 text-caption text-muted transition-colors hover:bg-hover hover:text-foreground"
            >
              {t('chat.dismiss')}
            </button>
          </div>
        </header>

        {confirmAll && (
          <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border-subtle bg-danger/5 px-4 py-2 text-caption">
            <span className="min-w-0 flex-1 text-danger">{t('chat.changesConfirmRevertAll')}</span>
            <button
              type="button"
              disabled={revertingAll}
              onClick={() => {
                void revert((turn?.files ?? []).map((file) => file.snapshotPath))
              }}
              className="h-7 rounded-md bg-danger px-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {revertingAll ? '…' : t('chat.changesConfirm')}
            </button>
            <button
              type="button"
              disabled={revertingAll}
              onClick={() => setConfirmAll(false)}
              className="h-7 rounded-md border border-border px-3 font-medium text-foreground transition-colors hover:bg-hover disabled:opacity-50"
            >
              {t('chat.changesCancel')}
            </button>
          </div>
        )}

        {!turn?.latest && !loading && (
          <p className="flex-none border-b border-border-subtle bg-background-subtle px-4 py-2 text-caption text-subtle">
            {t('chat.changesReadOnly')}
          </p>
        )}
        {turn?.latest && !turn.canRevert && !loading && (
          <p className="flex-none border-b border-border-subtle bg-background-subtle px-4 py-2 text-caption text-subtle">
            {t('chat.changesBusy')}
          </p>
        )}
        {turn?.truncated && (
          <p className="flex-none border-b border-border-subtle bg-warning/10 px-4 py-2 text-caption text-warning">
            {t('chat.changesListTruncated')}
          </p>
        )}
        {revertError && (
          <p className="flex-none border-b border-border-subtle bg-danger/10 px-4 py-2 text-caption text-danger">
            {revertError}
          </p>
        )}

        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-caption text-muted">
            <span
              aria-hidden
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
            {t('chat.changesLoading')}
          </div>
        ) : error ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-label font-medium text-danger">{t('chat.changesLoadFailed')}</p>
            <p className="max-w-[520px] break-words text-caption text-subtle">{error}</p>
          </div>
        ) : !turn || turn.files.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-caption text-muted">
            {t('chat.changesEmpty')}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <ul className="m-0 flex w-[260px] flex-none list-none flex-col gap-0.5 overflow-y-auto border-r border-border-subtle p-2">
              {turn.files.map((file) => (
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
                  {canRevert && (
                    <button
                      type="button"
                      aria-label={t('chat.changesRevertFile', { path: file.path })}
                      title={t('chat.changesRevertFile', { path: file.path })}
                      disabled={busyPath !== null}
                      onClick={() => {
                        void revert([file.snapshotPath])
                      }}
                      className="h-7 flex-none rounded-md px-1.5 text-caption font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                    >
                      {busyPath === file.snapshotPath ? '…' : t('chat.changesRevert')}
                    </button>
                  )}
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
                    {selected.error ? (
                      <p className="px-3 py-3 text-caption text-danger">{selected.error}</p>
                    ) : selected.binary ? (
                      <p className="px-3 py-3 text-caption text-subtle">
                        {t('chat.changesBinary')}
                      </p>
                    ) : selected.truncated ? (
                      <p className="px-3 py-3 text-caption text-warning">
                        {t('chat.changesTruncated')}
                      </p>
                    ) : selected.hunks.length === 0 ? (
                      <p className="px-3 py-3 text-caption text-subtle">
                        {t('chat.changesNoDiff')}
                      </p>
                    ) : (
                      selected.hunks.map((hunk, hunkIndex) => (
                        <div key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
                          <div className="sticky top-0 bg-background-subtle px-3 py-1 font-mono text-[11px] text-accent-strong">
                            {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
                          </div>
                          <pre className="m-0 overflow-x-auto px-0 py-0 font-mono text-[12px] leading-[1.6]">
                            {hunk.lines.map((line, lineIndex) => (
                              <div
                                key={lineIndex}
                                className={`whitespace-pre px-3 ${lineClass(line)}`}
                              >
                                {line || ' '}
                              </div>
                            ))}
                          </pre>
                        </div>
                      ))
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
      </aside>
    </div>
  )
}

export default ChangesPanel
