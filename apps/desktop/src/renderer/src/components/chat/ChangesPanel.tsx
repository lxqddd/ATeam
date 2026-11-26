import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionChangesSummary, TurnChanges } from '@ateam/shared'
import type { ChangesTab } from '../../chat/store'
import { DiffHunks } from './DiffHunks'
import { STATUS_CLASS, STATUS_KEY } from './diff-style'
import GitChangesView from './GitChangesView'

const REFERENCE_KEY_PREFIX = '\u0000refs/'

function displayPath(key: string): string {
  return key.startsWith(REFERENCE_KEY_PREFIX) ? `@${key.slice(REFERENCE_KEY_PREFIX.length)}` : key
}

interface ChangesPanelProps {
  sessionId: string
  /** Assistant message to inspect; null shows the whole-session summary. */
  messageId: string | null
  /** Diff source: recorded session snapshots or the working tree. */
  tab: ChangesTab
  onTabChange: (tab: ChangesTab) => void
  onClose: () => void
}

function ChangesPanel({
  sessionId,
  messageId,
  tab,
  onTabChange,
  onClose
}: ChangesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const isSummary = tab === 'session' && messageId === null
  const title =
    tab === 'git'
      ? t('chat.gitChangesTitle')
      : isSummary
        ? t('chat.changesSessionTitle')
        : t('chat.changesTitle')
  const [turn, setTurn] = useState<TurnChanges | null>(null)
  const [summary, setSummary] = useState<SessionChangesSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [revertError, setRevertError] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  // The panel is keyed by session/message/tab in ChatView, so each mount loads
  // its target exactly once and starts from the initial loading state.
  useEffect(() => {
    if (tab !== 'session') return
    let cancelled = false
    const request = messageId
      ? window.api.agent.sessions.changes(sessionId, messageId).then((result) => {
          if (cancelled) return
          setTurn(result)
          setSelectedKey(result.files[0]?.snapshotPath ?? null)
        })
      : window.api.agent.sessions.changesSummary(sessionId).then((result) => {
          if (!cancelled) setSummary(result)
        })
    request
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, messageId, tab])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const selected = useMemo(
    () => turn?.files.find((file) => file.snapshotPath === selectedKey) ?? null,
    [turn, selectedKey]
  )
  const totals = useMemo(() => {
    const files = turn?.files ?? []
    return {
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0)
    }
  }, [turn])

  function translateError(raw: string): string {
    if (raw.includes('TURN_NOT_LATEST')) return t('chat.changesNotLatest')
    if (raw.includes('SESSION_BUSY')) return t('chat.changesBusy')
    if (raw.includes('INVALID_CHANGE_PATH')) return t('chat.changesInvalidPath')
    if (raw.includes('INVALID_STEP_INDEX')) return t('chat.changesInvalidPart')
    if (raw.includes('NOTHING_TO_UNDO')) return t('chat.changesNothingToUndo')
    if (raw.includes('NOTHING_TO_UNREVERT')) return t('chat.changesNothingToUnrevert')
    if (raw.includes('SNAPSHOT_RESTORE_FAILED')) return t('chat.changesRestoreFailed')
    if (raw.includes('NO_SNAPSHOT')) return t('chat.changesNoSnapshot')
    return raw
  }

  async function revert(paths: string[]): Promise<void> {
    setBusyPath(paths.length === 1 ? paths[0] : 'all')
    setRevertError(null)
    try {
      const result =
        paths.length > 0
          ? await window.api.agent.sessions.revertFiles(sessionId, messageId as string, paths)
          : await window.api.agent.sessions.revertFiles(sessionId, messageId as string)
      setTurn(result)
      setConfirmAll(false)
      setSelectedKey((current) =>
        result.files.some((file) => file.snapshotPath === current)
          ? current
          : (result.files[0]?.snapshotPath ?? null)
      )
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : String(caught)
      setRevertError(translateError(raw))
    } finally {
      setBusyPath(null)
    }
  }

  async function unrevert(paths: string[]): Promise<void> {
    setBusyPath(paths.length === 1 ? paths[0] : 'all')
    setRevertError(null)
    try {
      const result =
        paths.length > 0
          ? await window.api.agent.sessions.unrevertFiles(sessionId, paths)
          : await window.api.agent.sessions.unrevertFiles(sessionId)
      setTurn(result)
      setSelectedKey((current) =>
        result.files.some((file) => file.snapshotPath === current)
          ? current
          : (result.files[0]?.snapshotPath ?? null)
      )
    } catch (caught) {
      const raw = caught instanceof Error ? caught.message : String(caught)
      setRevertError(translateError(raw))
    } finally {
      setBusyPath(null)
    }
  }

  const busyAll = busyPath === 'all'
  const canRevert = Boolean(turn?.canRevert)
  const canUnrevert = Boolean(turn?.canUnrevert)
  const revertedPaths = turn?.revertedPaths ?? []

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
        aria-label={title}
        className="relative flex h-full w-full max-w-[760px] flex-col border-l border-border bg-surface shadow-xl"
      >
        <header className="flex flex-none items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-foreground">{title}</h2>
            {isSummary && summary && (
              <p className="mt-0.5 text-caption text-muted">
                {t('chat.changesSessionSummary', {
                  turns: summary.turns.length,
                  files: summary.fileCount,
                  additions: summary.additions,
                  deletions: summary.deletions
                })}
              </p>
            )}
            {tab === 'session' && !isSummary && turn && (
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
            {tab === 'session' &&
              !isSummary &&
              canRevert &&
              (turn?.files.length ?? 0) > 0 &&
              !confirmAll && (
                <button
                  type="button"
                  disabled={busyAll}
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

        <div
          role="tablist"
          aria-label={t('chat.changesTitle')}
          className="flex flex-none gap-1 border-b border-border-subtle px-4 py-2"
        >
          {(['session', 'git'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => onTabChange(value)}
              className={`h-7 rounded-md px-3 text-caption font-medium transition-colors ${
                tab === value
                  ? 'bg-hover text-foreground'
                  : 'text-muted hover:bg-hover hover:text-foreground'
              }`}
            >
              {t(value === 'session' ? 'chat.changesTabSession' : 'chat.changesTabGit')}
            </button>
          ))}
        </div>

        {tab === 'git' ? (
          <GitChangesView sessionId={sessionId} />
        ) : (
          <>
            {confirmAll && (
              <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border-subtle bg-danger/5 px-4 py-2 text-caption">
                <span className="min-w-0 flex-1 text-danger">
                  {t('chat.changesConfirmRevertAll')}
                </span>
                <button
                  type="button"
                  disabled={busyAll}
                  onClick={() => {
                    void revert([])
                  }}
                  className="h-7 rounded-md bg-danger px-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busyAll ? '…' : t('chat.changesConfirm')}
                </button>
                <button
                  type="button"
                  disabled={busyAll}
                  onClick={() => setConfirmAll(false)}
                  className="h-7 rounded-md border border-border px-3 font-medium text-foreground transition-colors hover:bg-hover disabled:opacity-50"
                >
                  {t('chat.changesCancel')}
                </button>
              </div>
            )}

            {isSummary && summary?.truncated && (
              <p className="flex-none border-b border-border-subtle bg-warning/10 px-4 py-2 text-caption text-warning">
                {t('chat.changesSummaryTruncated')}
              </p>
            )}
            {!isSummary && !turn?.latest && !loading && !error && (
              <p className="flex-none border-b border-border-subtle bg-background-subtle px-4 py-2 text-caption text-subtle">
                {t('chat.changesReadOnly')}
              </p>
            )}
            {!isSummary && turn?.latest && !turn.canRevert && !loading && (
              <p className="flex-none border-b border-border-subtle bg-background-subtle px-4 py-2 text-caption text-subtle">
                {t('chat.changesBusy')}
              </p>
            )}
            {!isSummary && turn?.truncated && (
              <p className="flex-none border-b border-border-subtle bg-warning/10 px-4 py-2 text-caption text-warning">
                {t('chat.changesListTruncated')}
              </p>
            )}
            {revertError && (
              <p className="flex-none border-b border-border-subtle bg-danger/10 px-4 py-2 text-caption text-danger">
                {revertError}
              </p>
            )}
            {!isSummary && canUnrevert && revertedPaths.length > 0 && (
              <div className="flex flex-none flex-col gap-1 border-b border-border-subtle bg-accent/5 px-4 py-2 text-caption">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-accent-strong">
                    {t('chat.changesRevertedBanner', { count: revertedPaths.length })}
                  </span>
                  <button
                    type="button"
                    disabled={busyPath !== null}
                    onClick={() => {
                      void unrevert([])
                    }}
                    className="h-7 flex-none rounded-md border border-accent/40 px-2.5 font-medium text-accent-strong transition-colors hover:bg-accent/10 disabled:opacity-50"
                  >
                    {busyAll ? '…' : t('chat.changesUnrevertAll')}
                  </button>
                </div>
                <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                  {revertedPaths.map((path) => (
                    <li key={path}>
                      <button
                        type="button"
                        disabled={busyPath !== null}
                        title={displayPath(path)}
                        onClick={() => {
                          void unrevert([path])
                        }}
                        className="max-w-[260px] truncate rounded border border-border px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-hover disabled:opacity-50"
                      >
                        {busyPath === path
                          ? '…'
                          : `${t('chat.changesUnrevert')} ${displayPath(path)}`}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
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
            ) : isSummary ? (
              !summary || summary.turns.length === 0 ? (
                <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-caption text-muted">
                  {t('chat.changesSummaryEmpty')}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <p className="m-0 flex-none border-b border-border-subtle px-4 py-2 text-caption text-subtle">
                    {t('chat.changesSummaryReadOnly')}
                  </p>
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    <ul className="m-0 flex list-none flex-col gap-3 p-0">
                      {summary.turns.map((entry) => (
                        <li
                          key={entry.messageId}
                          className="overflow-hidden rounded-md border border-border-subtle"
                        >
                          <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-background-subtle px-3 py-1.5 text-caption text-subtle">
                            <span className="font-mono text-[11px]">
                              {new Date(entry.createdAt).toLocaleString()}
                            </span>
                            {entry.status === 'error' && (
                              <span className="rounded bg-danger/10 px-1 text-[11px] text-danger">
                                {t('chat.error')}
                              </span>
                            )}
                            <span className="flex-1" />
                            <span>
                              {t('chat.changesSummaryFiles', { count: entry.files.length })}
                            </span>
                            <span className="text-success">+{entry.additions}</span>
                            <span className="text-danger">−{entry.deletions}</span>
                          </div>
                          <ul className="m-0 flex list-none flex-col p-0">
                            {entry.files.map((file) => (
                              <li
                                key={file.snapshotPath}
                                className="flex items-center gap-2 px-3 py-1 text-caption"
                              >
                                <span
                                  className={`flex-none text-[11px] font-semibold uppercase ${STATUS_CLASS[file.status]}`}
                                >
                                  {t(STATUS_KEY[file.status])}
                                </span>
                                <span
                                  className="min-w-0 flex-1 truncate text-foreground"
                                  title={file.path}
                                >
                                  {file.path}
                                </span>
                                <span className="flex-none text-[11px] text-subtle">
                                  +{file.additions} −{file.deletions}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )
            ) : !turn || (turn.files.length === 0 && revertedPaths.length === 0) ? (
              <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-caption text-muted">
                {t('chat.changesEmpty')}
              </div>
            ) : turn.files.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-caption text-muted">
                {t('chat.changesAllReverted')}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1">
                <ul className="m-0 flex w-[260px] flex-none list-none flex-col gap-0.5 overflow-y-auto border-r border-border-subtle p-2">
                  {turn.files.map((file) => (
                    <li key={file.snapshotPath} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedKey(file.snapshotPath)}
                        title={file.path}
                        className={`flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                          file.snapshotPath === selectedKey ? 'bg-hover' : 'hover:bg-hover'
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
          </>
        )}
      </aside>
    </div>
  )
}

export default ChangesPanel
