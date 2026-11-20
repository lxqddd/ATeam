import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ModelRef } from '@ateam/shared'
import { chatStore, useChatStore } from '../../chat/store'
import ModelPicker from './ModelPicker'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function Composer(): React.JSX.Element {
  const { t } = useTranslation()
  const { sessions, selectedSessionId, models, status } = useChatStore()
  const session = sessions.find((candidate) => candidate.id === selectedSessionId)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const hasModels = (models?.models.length ?? 0) > 0
  const effectiveModel = session?.model ?? models?.defaultModel ?? null
  const running = session?.status === 'running' || session?.status === 'waiting-permission'
  const ready = status.status === 'ready'

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.min(200, Math.max(44, element.scrollHeight))}px`
  }, [text])

  async function submit(): Promise<void> {
    const content = text.trim()
    if (!content || sending || running) return
    if (!ready) {
      setError(t('chat.agentStoppedHint'))
      return
    }
    if (!hasModels) {
      setError(t('chat.noModel'))
      return
    }
    if (!effectiveModel) {
      setError(t('chat.selectModelFirst'))
      return
    }

    setSending(true)
    setError(null)
    try {
      await chatStore.send(content)
      setText('')
    } catch (caught) {
      const message = errorMessage(caught)
      setError(
        message === 'AGENT_NOT_READY'
          ? t('chat.agentStoppedHint')
          : message === 'SESSION_BUSY'
            ? t('chat.sessionBusy')
            : message
      )
    } finally {
      setSending(false)
      textareaRef.current?.focus()
    }
  }

  async function stop(): Promise<void> {
    setError(null)
    try {
      await chatStore.stop()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function changeModel(model: ModelRef): Promise<void> {
    setError(null)
    try {
      const target = await chatStore.ensureSession()
      await chatStore.setSessionModel(target.id, model)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const placeholder = !ready
    ? status.status === 'starting'
      ? t('chat.agentStarting')
      : t('chat.agentStoppedHint')
    : t('chat.placeholder')

  const sendDisabled = !text.trim() || sending || running || !ready || !hasModels

  return (
    <div className="mx-auto w-full max-w-[768px] flex-none px-4 pb-4">
      {!hasModels && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning">
          <span>{t('chat.noModel')}</span>
          <Link
            to="/settings?section=models"
            className="font-medium text-warning underline underline-offset-2"
          >
            {t('chat.configureModel')}
          </Link>
        </div>
      )}

      {error && (
        <div className="mb-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-caption text-danger">
          {error}
        </div>
      )}

      <div
        data-testid="composer"
        className="rounded-[20px] border border-border bg-surface-raised p-3 shadow-sm transition-colors focus-within:border-border-strong"
      >
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
          rows={1}
          disabled={!ready}
          placeholder={placeholder}
          aria-label={t('chat.placeholder')}
          className="block max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-0.5 text-body leading-[1.6] text-foreground outline-none placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-55"
        />

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <ModelPicker
              models={models}
              value={effectiveModel}
              onChange={(model) => {
                void changeModel(model)
              }}
              disabled={!ready || running || sending}
            />
          </div>

          {running ? (
            <button
              type="button"
              onClick={() => {
                void stop()
              }}
              title={t('chat.stop')}
              aria-label={t('chat.stop')}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="6" width="12" height="12" rx="2.5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                void submit()
              }}
              disabled={sendDisabled}
              title={t('chat.send')}
              aria-label={t('chat.send')}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:bg-active disabled:text-subtle"
            >
              {sending ? (
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 19V5M6.5 10.5 12 5l5.5 5.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default Composer
