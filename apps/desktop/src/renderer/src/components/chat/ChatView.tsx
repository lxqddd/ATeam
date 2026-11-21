import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../chat/store'
import BackgroundNotices from './BackgroundNotices'
import Composer from './Composer'
import MessageList from './MessageList'
import TodoPanel from './TodoPanel'

function ChatView(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    status,
    sessions,
    selectedSessionId,
    messagesBySession,
    loadedBySession,
    permissions,
    runOutcomes,
    backgroundResults
  } = useChatStore()

  const session = sessions.find((candidate) => candidate.id === selectedSessionId)
  const messages = selectedSessionId ? (messagesBySession[selectedSessionId] ?? []) : []
  const loaded = selectedSessionId ? Boolean(loadedBySession[selectedSessionId]) : true
  const sessionPermissions = permissions.filter(
    (permission) => permission.sessionId === selectedSessionId
  )
  const sessionRunning = session?.status === 'running' || session?.status === 'waiting-permission'
  const sessionBackground = backgroundResults.filter(
    (result) => result.sessionId === selectedSessionId
  )

  const emptyState = (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6">
      <div className="flex max-w-[520px] flex-col items-center pb-6 text-center">
        {status.status === 'starting' && (
          <div className="mb-4 flex items-center gap-2 text-caption text-muted">
            <span
              aria-hidden
              className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
            />
            {t('chat.agentStarting')}
          </div>
        )}
        <h2 className="text-display font-semibold tracking-[-0.01em] text-foreground">
          {t('chat.emptyTitle')}
        </h2>
        <p className="mt-2 text-label leading-[1.65] text-muted">{t('chat.emptyDescription')}</p>
        {session && messages.length === 0 && (
          <p className="mt-1.5 text-caption text-subtle">{t('chat.emptySessionHint')}</p>
        )}
        {status.status === 'error' && (
          <p className="mt-3 text-caption text-danger">{t('chat.agentStoppedHint')}</p>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-view">
      <TodoPanel todos={session?.todos ?? []} />
      {!loaded ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-caption text-muted">
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          {t('chat.loadingMessages')}
        </div>
      ) : messages.length === 0 ? (
        emptyState
      ) : (
        <MessageList
          key={selectedSessionId ?? 'empty'}
          messages={messages}
          permissions={sessionPermissions}
          sessionRunning={sessionRunning}
          runOutcomes={runOutcomes}
          compaction={session?.compaction ?? null}
        />
      )}

      <BackgroundNotices results={sessionBackground} />

      <Composer />
    </div>
  )
}

export default ChatView
