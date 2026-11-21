import { useTranslation } from 'react-i18next'
import type { ChatMessage, PermissionRequest, RunOutcome, SessionCompaction } from '@ateam/shared'
import { useStickToBottom } from '../../hooks/useStickToBottom'
import AssistantMessage from './AssistantMessage'
import PermissionCard from './PermissionCard'
import UserMessage from './UserMessage'

interface MessageListProps {
  messages: ChatMessage[]
  permissions: PermissionRequest[]
  sessionRunning: boolean
  runOutcomes: Record<string, RunOutcome>
  compaction: SessionCompaction | null
}

function groupTurns(messages: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = []
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) {
      turns.push([message])
    } else {
      turns[turns.length - 1].push(message)
    }
  }
  return turns
}

function MessageList({
  messages,
  permissions,
  sessionRunning,
  runOutcomes,
  compaction
}: MessageListProps): React.JSX.Element {
  const { t } = useTranslation()
  const lastMessage = messages[messages.length - 1]
  const scrollKey = `${messages.length}:${lastMessage?.updatedAt ?? ''}:${permissions.length}`
  const { ref, atBottom, onScroll, scrollToBottom } = useStickToBottom(scrollKey)
  const turns = groupTurns(messages)
  const lastMessageId = lastMessage?.id
  const boundaryIndex = compaction
    ? messages.findIndex((message) => message.id === compaction.throughMessageId)
    : -1
  const firstKeptId = boundaryIndex >= 0 ? messages[boundaryIndex + 1]?.id : undefined
  const matchedMessageIds = new Set(messages.map((message) => message.id))
  const orphanPermissions = permissions.filter(
    (permission) => !matchedMessageIds.has(permission.messageId)
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="message-list"
      >
        <div className="mx-auto flex w-full max-w-[768px] flex-col gap-8 px-4 py-6">
          {turns.map((turn) => {
            const first = turn[0]
            return (
              <div key={first.id} className="flex min-w-0 flex-col gap-3">
                {compaction && firstKeptId === first.id && (
                  <details className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2 text-caption text-subtle">
                    <summary className="cursor-pointer select-none">
                      {t('chat.compactedHistory')}
                    </summary>
                    <p className="mb-0 mt-2 whitespace-pre-wrap text-caption leading-relaxed text-muted">
                      {compaction.summary}
                    </p>
                  </details>
                )}
                {turn.map((message) => {
                  if (message.role === 'user') {
                    return <UserMessage key={message.id} message={message} />
                  }
                  return (
                    <AssistantMessage
                      key={message.id}
                      message={message}
                      permissions={permissions.filter(
                        (permission) => permission.messageId === message.id
                      )}
                      outcome={runOutcomes[message.id]}
                      isLast={message.id === lastMessageId}
                      sessionRunning={sessionRunning}
                    />
                  )
                })}
              </div>
            )
          })}

          {orphanPermissions.length > 0 && (
            <div className="flex flex-col gap-2">
              {orphanPermissions.map((request) => (
                <PermissionCard key={request.id} request={request} />
              ))}
            </div>
          )}
        </div>
      </div>

      {!atBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 text-caption font-medium text-foreground shadow-sm transition-colors hover:bg-hover"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="m6 9 6 6 6-6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('chat.scrollToBottom')}
        </button>
      )}
    </div>
  )
}

export default MessageList
