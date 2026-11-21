import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { chatStore, useChatStore } from '../../chat/store'

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

function formatTokens(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(value)
}

function ChatHeader(): React.JSX.Element {
  const { t } = useTranslation()
  const { sessions, selectedSessionId, messagesBySession } = useChatStore()
  const session = sessions.find((candidate) => candidate.id === selectedSessionId)
  const label = statusLabel(session?.status)
  const messages = selectedSessionId ? (messagesBySession[selectedSessionId] ?? []) : []
  const running = session?.status === 'running' || session?.status === 'waiting-permission'
  const [compacting, setCompacting] = useState(false)
  const [historyBusy, setHistoryBusy] = useState<'undo' | 'redo' | null>(null)
  const [headerError, setHeaderError] = useState<string | null>(null)
  const canUndo = !running && messages.some((message) => message.role === 'assistant')
  const canRedo = !running && session?.redoAvailable === true
  const totalCost = messages.reduce((sum, message) => sum + (message.costUsd ?? 0), 0)
  const contextPercent =
    session?.contextTokens != null && session.contextWindow
      ? Math.min(100, Math.round((session.contextTokens / session.contextWindow) * 100))
      : null

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

      {headerError && (
        <span className="max-w-[200px] truncate text-caption text-danger" title={headerError}>
          {headerError}
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
          void window.api.workspace.open().catch(() => undefined)
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
    </header>
  )
}

export default ChatHeader
