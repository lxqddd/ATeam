import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { chatStore, useChatStore } from '../chat/store'
import ChatHeader from '../components/chat/ChatHeader'
import ChatView from '../components/chat/ChatView'
import SessionPanel from '../components/chat/SessionPanel'

function ChatPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { status, actionError, restarting } = useChatStore()

  useEffect(() => {
    void chatStore.init()
    void chatStore.refreshModels()
  }, [])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden" data-testid="chat-page">
      <SessionPanel />

      <section className="flex min-h-0 min-w-0 flex-1 flex-col pt-2 pr-0.5 pb-0.5">
        <div className="chat-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-tl-[20px] rounded-br-[20px] border border-border-subtle bg-surface">
          {status.status === 'error' && (
            <div className="flex flex-none items-center gap-3 border-b border-danger/30 bg-danger/10 px-3 py-2 text-caption text-danger">
              <span className="min-w-0 flex-1 truncate" title={status.error}>
                {t('chat.agentError')}
                {status.error ? ` · ${status.error}` : ''}
              </span>
              <button
                type="button"
                disabled={restarting}
                onClick={() => {
                  void chatStore.restartAgent()
                }}
                className="flex h-7 flex-none items-center gap-1.5 rounded-md bg-danger/10 px-2.5 text-caption font-medium text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
              >
                {restarting && (
                  <span
                    aria-hidden
                    className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
                  />
                )}
                {t('chat.restartAgent')}
              </button>
            </div>
          )}

          {actionError && (
            <div className="flex flex-none items-center gap-3 border-b border-danger/30 bg-danger/10 px-3 py-2 text-caption text-danger">
              <span className="min-w-0 flex-1 truncate" title={actionError}>
                {actionError}
              </span>
              <button
                type="button"
                onClick={() => chatStore.clearActionError()}
                aria-label={t('chat.cancel')}
                className="flex h-6 w-6 flex-none items-center justify-center rounded-sm text-danger transition-colors hover:bg-danger/10"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M7 7l10 10M17 7 7 17"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          )}

          <ChatHeader />
          <ChatView />
        </div>
      </section>
    </div>
  )
}

export default ChatPage
