import { useState } from 'react'
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

function ChatHeader(): React.JSX.Element {
  const { t } = useTranslation()
  const { sessions, selectedSessionId, messagesBySession } = useChatStore()
  const session = sessions.find((candidate) => candidate.id === selectedSessionId)
  const label = statusLabel(session?.status)
  const messages = selectedSessionId ? (messagesBySession[selectedSessionId] ?? []) : []
  const running = session?.status === 'running' || session?.status === 'waiting-permission'
  const [compacting, setCompacting] = useState(false)
  const [compactError, setCompactError] = useState<string | null>(null)

  async function compactSession(): Promise<void> {
    setCompacting(true)
    setCompactError(null)
    try {
      await chatStore.compactSession()
    } catch (caught) {
      setCompactError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setCompacting(false)
    }
  }

  return (
    <header data-testid="chat-header" className="flex h-11 flex-none items-center gap-3 px-4">
      <h1 className="min-w-0 flex-1 truncate text-body font-semibold tracking-[-0.01em] text-foreground">
        {session?.title || t('chat.untitled')}
      </h1>

      {compactError && (
        <span className="max-w-[200px] truncate text-caption text-danger" title={compactError}>
          {compactError}
        </span>
      )}

      <button
        type="button"
        title={t('chat.compactContext')}
        aria-label={t('chat.compactContext')}
        disabled={compacting || running || messages.length === 0}
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
