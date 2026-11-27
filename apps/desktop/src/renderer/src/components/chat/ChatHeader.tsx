import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionExportResult, SessionPlan } from '@ateam/shared'
import { chatStore, useChatStore } from '../../chat/store'

// Export is a rarely used action; load its dialog only when it is opened.
const ExportDialog = lazy(() => import('./ExportDialog'))

function statusLabel(sessionStatus: string | undefined): string | null {
  if (sessionStatus === 'running') return 'chat.running'
  if (sessionStatus === 'waiting-permission') return 'chat.waitingPermission'
  if (sessionStatus === 'error') return 'chat.error'
  return null
}

function statusColor(sessionStatus: string | undefined): string {
  if (sessionStatus === 'waiting-permission') return 'text-warning'
  if (sessionStatus === 'error') return 'text-danger'
  return 'text-accent-strong'
}

function baseName(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed || directory
}

function formatTokens(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(value)
}

function ChatHeaderContent(): React.JSX.Element {
  const { t } = useTranslation()
  const { sessions, selectedSessionId, messagesBySession, info } = useChatStore()
  const session = sessions.find((candidate) => candidate.id === selectedSessionId)
  const label = statusLabel(session?.status)
  const messages = selectedSessionId ? (messagesBySession[selectedSessionId] ?? []) : []
  const lastMessageStatus = messages[messages.length - 1]?.status
  const running = session?.status === 'running' || session?.status === 'waiting-permission'
  const [compacting, setCompacting] = useState(false)
  const [historyBusy, setHistoryBusy] = useState<'undo' | 'redo' | null>(null)
  const [headerError, setHeaderError] = useState<string | null>(null)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [plan, setPlan] = useState<SessionPlan | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planCopied, setPlanCopied] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const exportNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null)
  const canUndo = !running && messages.some((message) => message.role === 'assistant')
  const canRedo = !running && session?.redoAvailable === true
  const showPlan =
    Boolean(session) &&
    (session?.agent === 'plan' || session?.permissionMode === 'plan' || plan?.exists === true)
  const totalCost = messages.reduce((sum, message) => sum + (message.costUsd ?? 0), 0)
  const contextPercent =
    session?.contextTokens != null && session.contextWindow
      ? Math.min(100, Math.round((session.contextTokens / session.contextWindow) * 100))
      : null
  const defaultDirectory = info?.workspacePath ?? null
  const currentDirectory = session?.directory ?? defaultDirectory
  const recentDirectories = useMemo(() => {
    const seen = new Set<string>()
    if (defaultDirectory) seen.add(defaultDirectory)
    for (const entry of sessions) {
      if (entry.directory) seen.add(entry.directory)
    }
    return [...seen]
  }, [defaultDirectory, sessions])

  useEffect(() => {
    if (!workspaceMenuOpen) return undefined
    const onDown = (event: MouseEvent): void => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) setWorkspaceMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setWorkspaceMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [workspaceMenuOpen])

  useEffect(() => {
    if (!selectedSessionId) return undefined
    let active = true
    window.api.agent.sessions
      .plan(selectedSessionId)
      .then((next) => {
        if (active) setPlan(next)
      })
      .catch(() => {
        if (active) setPlan(null)
      })
    return () => {
      active = false
    }
  }, [selectedSessionId, lastMessageStatus, session?.agent, session?.permissionMode])

  useEffect(() => {
    if (!planOpen) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPlanOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [planOpen])

  useEffect(
    () => () => {
      if (exportNoticeTimer.current) clearTimeout(exportNoticeTimer.current)
    },
    []
  )

  async function openPlan(): Promise<void> {
    if (!selectedSessionId) return
    setPlanOpen(true)
    setPlanBusy(true)
    setPlanError(null)
    setPlanCopied(false)
    try {
      setPlan(await window.api.agent.sessions.plan(selectedSessionId))
    } catch (caught) {
      setPlanError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPlanBusy(false)
    }
  }

  async function copyPlanPath(): Promise<void> {
    if (!plan) return
    try {
      await navigator.clipboard.writeText(plan.absolutePath)
      setPlanCopied(true)
      setTimeout(() => setPlanCopied(false), 1_500)
    } catch {
      /* clipboard access can be unavailable */
    }
  }

  async function compactSession(): Promise<void> {
    setCompacting(true)
    setHeaderError(null)
    try {
      await chatStore.compactSession()
    } catch (caught) {
      setHeaderError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setCompacting(false)
    }
  }

  async function undo(): Promise<void> {
    setHistoryBusy('undo')
    setHeaderError(null)
    try {
      await chatStore.undoSession()
    } catch (caught) {
      setHeaderError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setHistoryBusy(null)
    }
  }

  async function redo(): Promise<void> {
    setHistoryBusy('redo')
    setHeaderError(null)
    try {
      await chatStore.redoSession()
    } catch (caught) {
      setHeaderError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setHistoryBusy(null)
    }
  }

  async function fork(): Promise<void> {
    setHistoryBusy(null)
    setHeaderError(null)
    try {
      await chatStore.forkSession()
    } catch (caught) {
      setHeaderError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  function handleExported(result: SessionExportResult): void {
    setExportOpen(false)
    setExportNotice(t('chat.exportDone', { path: result.path ?? '' }))
    if (exportNoticeTimer.current) clearTimeout(exportNoticeTimer.current)
    exportNoticeTimer.current = setTimeout(() => setExportNotice(null), 6_000)
  }

  async function changeWorkspace(directory: string): Promise<void> {
    if (!session) return
    setWorkspaceMenuOpen(false)
    setWorkspaceBusy(true)
    setHeaderError(null)
    try {
      await chatStore.setSessionDirectory(session.id, directory)
    } catch (caught) {
      setHeaderError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setWorkspaceBusy(false)
    }
  }

  async function chooseWorkspace(): Promise<void> {
    setWorkspaceMenuOpen(false)
    const picked = await window.api.workspace
      .pickDirectory(currentDirectory ?? undefined)
      .catch(() => null)
    if (picked) await changeWorkspace(picked)
  }

  const runUndo = useCallback(() => {
    void undo()
  }, [])
  const runRedo = useCallback(() => {
    void redo()
  }, [])

  useEffect(() => {
    if (running) return
    const handleKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (event.shiftKey) {
        if (!canRedo || historyBusy !== null) return
        event.preventDefault()
        runRedo()
      } else if (canUndo && historyBusy === null) {
        event.preventDefault()
        runUndo()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [running, canUndo, canRedo, historyBusy, runUndo, runRedo])

  return (
    <header data-testid="chat-header" className="flex h-11 flex-none items-center gap-3 px-4">
      <h1 className="min-w-0 flex-1 truncate text-body font-semibold tracking-[-0.01em] text-foreground">
        {session?.title || t('chat.untitled')}
      </h1>

      {session && currentDirectory && (
        <div className="relative flex-none" ref={workspaceMenuRef}>
          <button
            type="button"
            title={currentDirectory}
            aria-label={t('chat.sessionWorkspace')}
            aria-haspopup="menu"
            aria-expanded={workspaceMenuOpen}
            disabled={running || workspaceBusy}
            onClick={() => setWorkspaceMenuOpen((open) => !open)}
            className="flex h-8 max-w-[180px] items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-caption text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55"
          >
            {workspaceBusy ? (
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8a1.5 1.5 0 0 1 1.5 1.5V17.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <span className="truncate">{baseName(currentDirectory)}</span>
          </button>
          {workspaceMenuOpen && (
            <div
              role="menu"
              aria-label={t('chat.sessionWorkspace')}
              className="absolute right-0 top-9 z-30 max-h-80 w-72 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg"
            >
              <div className="px-2 py-1 text-caption text-muted">{t('chat.sessionWorkspace')}</div>
              {recentDirectories.map((directory) => (
                <button
                  key={directory}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void changeWorkspace(directory)
                  }}
                  title={directory}
                  className="flex w-full flex-col rounded px-2 py-1.5 text-left transition-colors hover:bg-hover"
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className="truncate text-label text-foreground">
                      {baseName(directory)}
                    </span>
                    {directory === defaultDirectory && (
                      <span className="flex-none rounded bg-hover px-1 text-caption text-muted">
                        {t('chat.defaultWorkspace')}
                      </span>
                    )}
                  </span>
                  <span className="block w-full truncate font-mono text-caption text-subtle">
                    {directory}
                  </span>
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void chooseWorkspace()
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-label text-foreground transition-colors hover:bg-hover"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
                {t('chat.chooseFolder')}
              </button>
            </div>
          )}
        </div>
      )}

      {headerError && (
        <span className="max-w-[200px] truncate text-caption text-danger" title={headerError}>
          {headerError}
        </span>
      )}

      {exportNotice && (
        <span
          className="max-w-[200px] truncate text-caption text-accent-strong"
          title={exportNotice}
        >
          {exportNotice}
        </span>
      )}

      {session?.contextTokens != null && session.contextWindow != null && (
        <span
          className="flex flex-none items-center gap-1.5 text-caption text-subtle"
          title={t('chat.contextUsageTitle')}
        >
          {formatTokens(session.contextTokens)} / {formatTokens(session.contextWindow)}
          {contextPercent !== null && (
            <span
              role="progressbar"
              aria-label={t('chat.contextUsageTitle')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={contextPercent}
              className="h-1 w-14 overflow-hidden rounded-full bg-active"
            >
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${contextPercent}%` }}
              />
            </span>
          )}
        </span>
      )}

      {totalCost > 0 && (
        <span className="flex-none text-caption text-subtle" title={t('chat.cost')}>
          ${totalCost.toFixed(6)}
        </span>
      )}

      {showPlan && (
        <button
          type="button"
          title={t('chat.plan')}
          aria-label={t('chat.plan')}
          onClick={() => {
            void openPlan()
          }}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
            <path d="M14 3.5V8h4M9 12h6M9 15.5h6M9 19h4" />
          </svg>
        </button>
      )}

      <button
        type="button"
        title={t('chat.changesSessionButton')}
        aria-label={t('chat.changesSessionButton')}
        disabled={running || messages.length === 0 || !selectedSessionId}
        onClick={() => {
          if (selectedSessionId) chatStore.openSessionChanges(selectedSessionId)
        }}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
          <path d="M14 3.5V8h4M8 13h3M9.5 11.5v3M13 17h3" />
        </svg>
      </button>

      <button
        type="button"
        title={t('chat.gitChangesButton')}
        aria-label={t('chat.gitChangesButton')}
        disabled={!selectedSessionId}
        onClick={() => {
          if (selectedSessionId) chatStore.openGitChanges(selectedSessionId)
        }}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="6" cy="5" r="2.2" />
          <circle cx="6" cy="19" r="2.2" />
          <circle cx="18" cy="9" r="2.2" />
          <path d="M6 7.2v9.6M18 11.2c0 2.5-2 4.5-4.5 4.5H8.2" />
        </svg>
      </button>

      <button
        type="button"
        title={t('chat.undo')}
        aria-label={t('chat.undo')}
        disabled={!canUndo || historyBusy !== null}
        onClick={() => {
          void undo()
        }}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
      >
        {historyBusy === 'undo' ? (
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m9 7-5 5 5 5" />
            <path d="M4 12h9a6 6 0 0 1 6 6v1" />
          </svg>
        )}
      </button>

      <button
        type="button"
        title={t('chat.redo')}
        aria-label={t('chat.redo')}
        disabled={!canRedo || historyBusy !== null}
        onClick={() => {
          void redo()
        }}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
      >
        {historyBusy === 'redo' ? (
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m15 7 5 5-5 5" />
            <path d="M20 12h-9a6 6 0 0 0-6 6v1" />
          </svg>
        )}
      </button>

      <button
        type="button"
        title={t('chat.compactContext')}
        aria-label={t('chat.compactContext')}
        disabled={compacting || historyBusy !== null || running || messages.length === 0}
        onClick={() => {
          void compactSession()
        }}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
      >
        {compacting ? (
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 9h16M4 15h16" />
            <path d="m9 5 3 4 3-4M9 19l3-4 3 4" />
          </svg>
        )}
      </button>

      <button
        type="button"
        title={t('chat.forkSession')}
        aria-label={t('chat.forkSession')}
        disabled={running || !session}
        onClick={() => {
          void fork()
        }}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="6" cy="5" r="2" />
          <circle cx="18" cy="5" r="2" />
          <circle cx="12" cy="19" r="2" />
          <path d="M6 7v3a4 4 0 0 0 4 4h2M18 7v3a4 4 0 0 1-4 4h-2M12 14v3" />
        </svg>
      </button>

      <button
        type="button"
        title={t('chat.exportSession')}
        aria-label={t('chat.exportSession')}
        disabled={!selectedSessionId}
        onClick={() => setExportOpen(true)}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 4v11M12 15l4-4M12 15l-4-4" />
          <path d="M5 19h14" />
        </svg>
      </button>

      {label && (
        <span className={`flex items-center gap-1.5 text-caption ${statusColor(session?.status)}`}>
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full bg-current ${
              session?.status === 'running' ? 'animate-pulse' : ''
            }`}
          />
          {t(label)}
        </span>
      )}

      <button
        type="button"
        title={t('chat.openWorkspace')}
        aria-label={t('chat.openWorkspace')}
        onClick={() => {
          void window.api.workspace.open(session?.directory ?? undefined).catch(() => undefined)
        }}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h5l2 2h8a1.5 1.5 0 0 1 1.5 1.5V17.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-10Z" />
        </svg>
      </button>

      {exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog
            initialScope="current"
            sessionId={selectedSessionId}
            onClose={() => setExportOpen(false)}
            onExported={handleExported}
          />
        </Suspense>
      )}

      {planOpen && session && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
          <div
            aria-hidden
            onClick={() => setPlanOpen(false)}
            className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('chat.plan')}
            className="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
          >
            <header className="flex flex-none items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-title font-semibold text-foreground">{t('chat.plan')}</h2>
                {plan && (
                  <p
                    className="mt-0.5 truncate font-mono text-caption text-muted"
                    title={plan.absolutePath}
                  >
                    {plan.path}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label={t('chat.planClose')}
                onClick={() => setPlanOpen(false)}
                className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M7 7l10 10M17 7 7 17"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              {planBusy ? (
                <p className="m-0 text-caption text-muted">{t('settings.loading')}</p>
              ) : planError ? (
                <p className="m-0 text-caption text-danger">{planError}</p>
              ) : plan?.exists ? (
                <pre className="m-0 whitespace-pre-wrap break-words font-mono text-caption leading-relaxed text-foreground">
                  {plan.content}
                </pre>
              ) : (
                <p className="m-0 text-caption text-muted">{t('chat.planEmpty')}</p>
              )}
            </div>
            <footer className="flex flex-none items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
              <button
                type="button"
                disabled={!plan?.exists}
                onClick={() => {
                  void copyPlanPath()
                }}
                className="h-8 rounded-md border border-border bg-surface px-3 text-label font-medium text-foreground transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-55"
              >
                {planCopied ? t('chat.planCopied') : t('chat.planCopyPath')}
              </button>
              <button
                type="button"
                onClick={() => setPlanOpen(false)}
                className="h-8 rounded-md bg-accent px-3 text-label font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
              >
                {t('chat.planClose')}
              </button>
            </footer>
          </div>
        </div>
      )}
    </header>
  )
}

// Remount per session so header-local menu and error state does not leak.
function ChatHeader(): React.JSX.Element {
  const { selectedSessionId } = useChatStore()
  return <ChatHeaderContent key={selectedSessionId ?? 'none'} />
}

export default ChatHeader
