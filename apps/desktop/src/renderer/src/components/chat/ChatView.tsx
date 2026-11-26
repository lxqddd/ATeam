import { useTranslation } from 'react-i18next'
import { chatStore, useChatStore } from '../../chat/store'
import BackgroundNotices from './BackgroundNotices'
import ChangesPanel from './ChangesPanel'
import Composer from './Composer'
import MessageList from './MessageList'
import QuestionCard from './QuestionCard'
import SubagentNotices from './SubagentNotices'
import TodoPanel from './TodoPanel'

function ChatView(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    status,
    sessions,
    selectedSessionId,
    messagesBySession,
    loadedBySession,
    loadErrorsBySession,
    permissions,
    questions,
    subagentResults,
    runOutcomes,
    backgroundTasksBySession,
    changesPanel
  } = useChatStore()

  const session = sessions.find((candidate) => candidate.id === selectedSessionId)
  const messages = selectedSessionId ? (messagesBySession[selectedSessionId] ?? []) : []
  const loaded = selectedSessionId ? Boolean(loadedBySession[selectedSessionId]) : true
  const loadError = selectedSessionId ? loadErrorsBySession?.[selectedSessionId] : undefined
  const sessionPermissions = permissions.filter(
    (permission) => permission.sessionId === selectedSessionId
  )
  const sessionQuestions = questions.filter((question) => question.sessionId === selectedSessionId)
  const sessionRunning = session?.status === 'running' || session?.status === 'waiting-permission'
  const sessionSubagents = subagentResults.filter(
    (result) => result.parentSessionId === selectedSessionId
  )
  const sessionBackground = selectedSessionId
    ? (backgroundTasksBySession[selectedSessionId] ?? [])
    : []

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
      {loadError && selectedSessionId && (
        <div className="mx-4 mt-2 flex flex-none items-center gap-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-caption text-danger">
          <span className="min-w-0 flex-1 truncate" title={loadError}>
            {loadError}
          </span>
          <button
            type="button"
            onClick={() => {
              void chatStore.loadMessages(selectedSessionId)
            }}
            className="flex-none rounded bg-danger/10 px-2 py-0.5 font-medium transition-colors hover:bg-danger/15"
          >
            {t('chat.retry')}
          </button>
        </div>
      )}
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
          key={`messages-${selectedSessionId ?? 'empty'}`}
          sessionId={selectedSessionId ?? undefined}
          messages={messages}
          permissions={sessionPermissions}
          sessionRunning={sessionRunning}
          runOutcomes={runOutcomes}
          compaction={session?.compaction ?? null}
        />
      )}

      <BackgroundNotices tasks={sessionBackground} />
      <SubagentNotices
        results={sessionSubagents}
        onDismiss={(toolCallId) => chatStore.dismissSubagentResult(toolCallId)}
      />
      {sessionQuestions.map((question) => (
        <QuestionCard key={question.id} question={question} />
      ))}

      <Composer key={`composer-${selectedSessionId ?? 'none'}`} />
      {changesPanel && (
        <ChangesPanel
          key={`${changesPanel.sessionId}:${changesPanel.messageId ?? 'summary'}:${changesPanel.tab}`}
          sessionId={changesPanel.sessionId}
          messageId={changesPanel.messageId}
          tab={changesPanel.tab}
          onTabChange={(tab) => chatStore.setChangesTab(tab)}
          onClose={() => chatStore.closeChanges()}
        />
      )}
    </div>
  )
}

export default ChatView
