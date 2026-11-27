import { errorMessage } from '../../lib/errors'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionExportResult, SessionMeta, SessionSearchResult } from '@ateam/shared'
import { chatStore, useChatStore } from '../../chat/store'
import ExportDialog from './ExportDialog'

function PlusIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function PencilIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TrashIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m-9 0 1 12h10l1-12M10 11v5M14 11v5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m5 12.5 4.2 4L19 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function XIcon(): React.JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function statusDot(status: SessionMeta['status']): string {
  if (status === 'running') return 'bg-accent-strong animate-pulse'
  if (status === 'waiting-permission') return 'bg-warning animate-pulse'
  if (status === 'error') return 'bg-danger'
  return 'bg-transparent'
}

interface SessionRowProps {
  session: SessionMeta
  active: boolean
  onError: (message: string) => void
}

function SessionRow({ session, active, onError }: SessionRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const committed = useRef(false)

  function startRename(): void {
    committed.current = false
    setDraft(session.title)
    setConfirming(false)
    setRenaming(true)
  }

  async function commitRename(): Promise<void> {
    if (committed.current) return
    committed.current = true
    const title = draft.trim()
    setRenaming(false)
    if (!title || title === session.title) return
    try {
      await chatStore.renameSession(session.id, title)
    } catch (caught) {
      onError(errorMessage(caught))
    }
  }

  function cancelRename(): void {
    committed.current = true
    setRenaming(false)
    setDraft(session.title)
  }

  async function remove(): Promise<void> {
    setBusy(true)
    try {
      await chatStore.deleteSession(session.id)
    } catch (caught) {
      onError(errorMessage(caught))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (renaming) {
    return (
      <div className="flex h-8 flex-none items-center rounded-md bg-hover px-1.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            void commitRename()
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void commitRename()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelRename()
            }
          }}
          maxLength={60}
          aria-label={t('chat.renameSession')}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          className="h-7 w-full min-w-0 rounded-sm border border-border bg-surface px-1.5 text-label text-foreground outline-none"
        />
      </div>
    )
  }

  return (
    <div
      data-testid="session-row"
      data-active={active || undefined}
      className={`group flex h-8 flex-none items-center rounded-md pr-1 transition-colors ${
        active ? 'bg-selected text-selected-foreground' : 'text-muted hover:bg-hover'
      }`}
    >
      <button
        type="button"
        onClick={() => chatStore.selectSession(session.id)}
        title={session.title}
        className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pl-2 text-left text-label ${
          active ? 'font-medium text-selected-foreground' : 'hover:text-foreground'
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 flex-none rounded-full ${statusDot(session.status)}`}
        />
        <span className="truncate">{session.title || t('chat.untitled')}</span>
      </button>

      {confirming ? (
        <div className="flex flex-none items-center gap-0.5">
          <button
            type="button"
            title={t('chat.confirmDelete')}
            aria-label={t('chat.deleteSession')}
            disabled={busy}
            onClick={() => {
              void remove()
            }}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
          >
            <CheckIcon />
          </button>
          <button
            type="button"
            title={t('chat.cancel')}
            aria-label={t('chat.cancel')}
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted transition-colors hover:bg-active hover:text-foreground disabled:opacity-50"
          >
            <XIcon />
          </button>
        </div>
      ) : (
        <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            title={t('chat.rename')}
            aria-label={t('chat.renameSession')}
            onClick={(event) => {
              event.stopPropagation()
              startRename()
            }}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted transition-colors hover:bg-active hover:text-foreground"
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            title={t('chat.delete')}
            aria-label={t('chat.deleteSession')}
            onClick={(event) => {
              event.stopPropagation()
              setConfirming(true)
            }}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-muted transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </div>
  )
}

function DownloadIcon(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v11M12 15l4-4M12 15l-4-4M5 19h14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SessionPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const { sessions, selectedSessionId } = useChatStore()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [creating, setCreating] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SessionSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    },
    []
  )

  function handleExported(result: SessionExportResult): void {
    setExportOpen(false)
    setNotice(t('chat.exportDone', { path: result.path ?? '' }))
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 6_000)
  }

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) return undefined
    let active = true
    const timer = setTimeout(() => {
      window.api.agent.sessions
        .search(trimmed)
        .then((next) => {
          if (active) setResults(next)
        })
        .catch((caught: unknown) => {
          if (!active) return
          setError(errorMessage(caught))
          setResults([])
        })
        .finally(() => {
          if (active) setSearching(false)
        })
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query])

  async function newChat(): Promise<void> {
    setCreating(true)
    setError(null)
    try {
      await chatStore.createSession()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setCreating(false)
    }
  }

  return (
    <aside data-testid="session-panel" className="flex w-[260px] flex-none flex-col px-2 pt-2 pb-1">
      <div className="flex h-11 flex-none items-center justify-between gap-2 px-1">
        <span className="text-label font-semibold text-foreground">{t('chat.sessions')}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={sessions.length === 0}
            title={t('chat.exportAllSessions')}
            aria-label={t('chat.exportAllSessions')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <DownloadIcon />
          </button>
          <button
            type="button"
            onClick={() => {
              void newChat()
            }}
            disabled={creating}
            title={t('chat.newChat')}
            aria-label={t('chat.newChat')}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
          >
            {creating ? (
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
            ) : (
              <PlusIcon />
            )}
          </button>
        </div>
      </div>

      {error && <p className="px-1 py-1 text-caption text-danger">{error}</p>}
      {notice && (
        <p className="truncate px-1 py-1 text-caption text-accent-strong" title={notice}>
          {notice}
        </p>
      )}

      <div className="px-1 pb-1">
        <input
          value={query}
          onChange={(event) => {
            const value = event.target.value
            setQuery(value)
            setResults(null)
            setError(null)
            setSearching(Boolean(value.trim()))
          }}
          aria-label={t('chat.searchSessions')}
          placeholder={t('chat.searchPlaceholder')}
          className="h-8 w-full rounded-md border border-border bg-surface px-2 text-label text-foreground outline-none placeholder:text-subtle focus:border-border-strong"
        />
      </div>

      {query.trim() ? (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1">
          {searching && <p className="px-2 py-2 text-caption text-subtle">{t('chat.searching')}</p>}
          {!searching && results?.length === 0 && (
            <p className="px-2 py-2 text-caption text-subtle">{t('chat.searchNoResults')}</p>
          )}
          {results?.map((result) => (
            <button
              key={result.session.id}
              type="button"
              onClick={() => chatStore.selectSession(result.session.id)}
              title={result.session.title}
              className="flex flex-col rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
            >
              <span className="block truncate text-label text-foreground">
                {result.session.title || t('chat.untitled')}
              </span>
              {result.snippet && result.snippet !== result.session.title && (
                <span className="mt-0.5 block truncate text-caption text-muted">
                  {result.snippet}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1">
          {sessions.length === 0 ? (
            <p className="px-2 py-2 text-caption text-subtle">{t('chat.noSessions')}</p>
          ) : (
            sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                active={session.id === selectedSessionId}
                onError={setError}
              />
            ))
          )}
        </div>
      )}
      {exportOpen && (
        <ExportDialog
          initialScope="all"
          sessionId={selectedSessionId}
          onClose={() => setExportOpen(false)}
          onExported={handleExported}
        />
      )}
    </aside>
  )
}

export default SessionPanel
