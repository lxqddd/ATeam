import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage, PermissionRequest, RunOutcome } from '@ateam/shared'
import { chatStore } from '../../chat/store'
import MarkdownBlock from './MarkdownBlock'
import PermissionCard from './PermissionCard'
import StreamingStatus from './StreamingStatus'
import ToolRow from './ToolRow'

interface AssistantMessageProps {
  message: ChatMessage
  permissions: PermissionRequest[]
  outcome?: RunOutcome
  isLast: boolean
  sessionRunning: boolean
}

function AssistantMessage({
  message,
  permissions,
  outcome,
  isLast,
  sessionRunning
}: AssistantMessageProps): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [reverting, setReverting] = useState(false)
  const [revertError, setRevertError] = useState<string | null>(null)
  const [forking, setForking] = useState(false)
  const [forkError, setForkError] = useState<string | null>(null)

  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
  const hasParts = message.parts.length > 0
  const streaming = message.status === 'streaming'
  const canRetry =
    isLast && !sessionRunning && (message.status === 'error' || message.status === 'interrupted')
  const canRevert = !sessionRunning && message.status !== 'streaming'

  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    } catch {
      /* clipboard access can be unavailable */
    }
  }

  async function retry(): Promise<void> {
    setRetrying(true)
    setRetryError(null)
    try {
      await chatStore.retry()
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRetrying(false)
    }
  }

  async function revert(): Promise<void> {
    setReverting(true)
    setRevertError(null)
    try {
      await chatStore.undoSession(message.id)
    } catch (caught) {
      setRevertError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setReverting(false)
    }
  }

  async function fork(): Promise<void> {
    setForking(true)
    setForkError(null)
    try {
      await chatStore.forkSession(message.id)
    } catch (caught) {
      setForkError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setForking(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {hasParts && (
        <div className="flex min-w-0 flex-col gap-2.5">
          {message.parts.map((part, index) => {
            if (part.type === 'text') {
              return <MarkdownBlock key={`text-${index}`} text={part.text} />
            }
            if (part.type === 'reasoning') {
              return (
                <details
                  key={`reasoning-${index}`}
                  className="rounded-md border border-border-subtle bg-background-subtle px-3 py-2"
                >
                  <summary className="cursor-pointer select-none text-caption text-muted">
                    {t('chat.thinking')}
                  </summary>
                  <div className="mt-2">
                    <MarkdownBlock text={part.text} />
                  </div>
                </details>
              )
            }
            if (part.type === 'attachment') return null
            return <ToolRow key={part.toolCallId} part={part} />
          })}
        </div>
      )}

      {streaming && <StreamingStatus startedAt={message.createdAt} retry={message.retry} />}

      {message.status === 'complete' &&
        !text &&
        !message.parts.some((part) => part.type !== 'text') && (
          <p className="text-label text-subtle">{t('chat.emptyAssistant')}</p>
        )}

      {message.status === 'error' && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3.5 py-3">
          <div className="text-body font-semibold text-danger">{t('chat.error')}</div>
          <p className="mt-1 whitespace-pre-wrap break-words text-label text-danger/90">
            {message.error}
          </p>
          {message.retryFailure && (
            <p className="mt-1 whitespace-pre-wrap break-words text-caption text-danger/80">
              {t('chat.retryFailure', {
                count: message.retryFailure.retries,
                reason: message.retryFailure.reason
              })}
            </p>
          )}
          {canRetry && (
            <button
              type="button"
              disabled={retrying}
              onClick={() => {
                void retry()
              }}
              className="mt-2 h-8 rounded-md bg-danger/10 px-3 text-label font-medium text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
            >
              {retrying ? t('settings.loading') : t('chat.retry')}
            </button>
          )}
          {retryError && <p className="mt-2 text-caption text-danger">{retryError}</p>}
        </div>
      )}

      {message.status === 'interrupted' && (
        <div className="flex flex-wrap items-center gap-2 text-caption text-subtle">
          <span>{t('chat.stopped')}</span>
          {canRetry && (
            <button
              type="button"
              disabled={retrying}
              onClick={() => {
                void retry()
              }}
              className="font-medium text-accent-strong hover:underline disabled:opacity-50"
            >
              {retrying ? t('settings.loading') : t('chat.retry')}
            </button>
          )}
        </div>
      )}

      {outcome === 'max-steps' && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning">
          {t('chat.maxSteps')} · {t('chat.stepLimitHint')}
        </div>
      )}

      {permissions.map((request) => (
        <PermissionCard key={request.id} request={request} />
      ))}

      {!streaming && (
        <div className="flex min-h-5 flex-wrap items-center gap-2 text-caption text-subtle">
          {message.durationMs !== undefined && (
            <span>{t('chat.duration', { seconds: (message.durationMs / 1_000).toFixed(1) })}</span>
          )}
          {message.usage?.totalTokens !== undefined && (
            <span>{t('chat.tokens', { count: message.usage.totalTokens })}</span>
          )}
          {message.costUsd !== undefined && (
            <span title={t('chat.cost')}>${message.costUsd.toFixed(6)}</span>
          )}
          {text && (
            <button
              type="button"
              onClick={() => {
                void copyText()
              }}
              className="rounded px-1 text-caption text-subtle transition-colors hover:bg-hover hover:text-foreground"
            >
              {copied ? t('chat.copied') : t('chat.copy')}
            </button>
          )}
          {(message.changedFiles?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => chatStore.openChanges(message.sessionId, message.id)}
              className="rounded px-1 text-caption font-medium text-accent-strong transition-colors hover:bg-hover"
            >
              {t('chat.changesButton', { count: message.changedFiles?.length ?? 0 })}
            </button>
          )}
          {canRevert && (
            <button
              type="button"
              disabled={reverting}
              onClick={() => {
                void revert()
              }}
              className="rounded px-1 text-caption text-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
            >
              {t('chat.revertToHere')}
            </button>
          )}
          {!sessionRunning && (
            <button
              type="button"
              disabled={forking}
              onClick={() => {
                void fork()
              }}
              className="rounded px-1 text-caption text-subtle transition-colors hover:bg-hover hover:text-foreground disabled:opacity-50"
            >
              {t('chat.forkFromHere')}
            </button>
          )}
          {revertError && <span className="text-caption text-danger">{revertError}</span>}
          {forkError && <span className="text-caption text-danger">{forkError}</span>}
        </div>
      )}
    </div>
  )
}

export default AssistantMessage
