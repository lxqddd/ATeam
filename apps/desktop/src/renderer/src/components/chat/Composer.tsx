import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ModelRef, PermissionMode, ReasoningEffort, SessionSettings } from '@ateam/shared'
import { PERMISSION_MODES, REASONING_EFFORTS } from '@ateam/shared'
import { chatStore, useChatStore } from '../../chat/store'
import ComposerChoiceChip from './ComposerChoiceChip'
import ModelPicker from './ModelPicker'

const REASONING_LABEL_KEYS: Record<ReasoningEffort, string> = {
  minimal: 'chat.reasoningMinimal',
  low: 'chat.reasoningLow',
  medium: 'chat.reasoningMedium',
  high: 'chat.reasoningHigh'
}

const PERMISSION_LABEL_KEYS: Record<PermissionMode, string> = {
  plan: 'chat.permissionPlan',
  ask: 'chat.permissionAsk',
  acceptEdits: 'chat.permissionAcceptEdits',
  auto: 'chat.permissionAuto'
}

const PERMISSION_HINT_KEYS: Record<PermissionMode, string> = {
  plan: 'chat.permissionPlanHint',
  ask: 'chat.permissionAskHint',
  acceptEdits: 'chat.permissionAcceptEditsHint',
  auto: 'chat.permissionAutoHint'
}

function ReasoningIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5 13.6 9l5.4 1.7-5.4 1.7L12 18l-1.6-5.6L5 10.7 10.4 9 12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 16.5 19.2 19l2.3.8-2.3.7-.7 2.5-.7-2.5-2.3-.7 2.3-.8.7-2.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

function ShieldIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5 19 6v5.3c0 4.4-2.8 7.8-7 9.2-4.2-1.4-7-4.8-7-9.2V6l7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m8.8 12 2.2 2.2 4.2-4.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function Composer(): React.JSX.Element {
  const { t } = useTranslation()
  const { sessions, selectedSessionId, models, status, revertPrompt } = useChatStore()
  const session = sessions.find((candidate) => candidate.id === selectedSessionId)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const hasModels = (models?.models.length ?? 0) > 0
  const effectiveModel = session?.model ?? models?.defaultModel ?? null
  const running = session?.status === 'running' || session?.status === 'waiting-permission'
  const ready = status.status === 'ready'
  const reasoningEffort = session?.reasoningEffort ?? null
  const permissionMode = session?.permissionMode ?? 'ask'
  const reasoningLabel = reasoningEffort
    ? t(REASONING_LABEL_KEYS[reasoningEffort])
    : t('chat.reasoningDefault')

  const reasoningOptions = [
    { value: 'default', label: t('chat.reasoningDefault') },
    ...REASONING_EFFORTS.map((effort) => ({
      value: effort,
      label: t(REASONING_LABEL_KEYS[effort])
    }))
  ]
  const permissionOptions = PERMISSION_MODES.map((mode) => ({
    value: mode,
    label: t(PERMISSION_LABEL_KEYS[mode]),
    description: t(PERMISSION_HINT_KEYS[mode])
  }))

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.min(200, Math.max(44, element.scrollHeight))}px`
  }, [text])

  useEffect(() => {
    if (revertPrompt === null) return
    // An undo result arrives from the store; seed the local draft once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(revertPrompt)
    chatStore.clearRevertPrompt()
    textareaRef.current?.focus()
  }, [revertPrompt])

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

  async function changeSettings(patch: Partial<SessionSettings>): Promise<void> {
    setError(null)
    try {
      const target = await chatStore.ensureSession()
      await chatStore.setSessionSettings(target.id, {
        reasoningEffort: target.reasoningEffort ?? null,
        permissionMode: target.permissionMode ?? 'ask',
        ...patch
      })
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
          <Link to="/models" className="font-medium text-warning underline underline-offset-2">
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
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <ModelPicker
              models={models}
              value={effectiveModel}
              onChange={(model) => {
                void changeModel(model)
              }}
              disabled={!ready || running || sending}
            />
            <ComposerChoiceChip
              ariaLabel={t('chat.reasoning')}
              accessibleLabel={`${t('chat.reasoning')}: ${reasoningLabel}`}
              label={`${t('chat.reasoningShort')} · ${reasoningLabel}`}
              value={reasoningEffort ?? 'default'}
              options={reasoningOptions}
              onChange={(value) => {
                void changeSettings({
                  reasoningEffort: value === 'default' ? null : (value as ReasoningEffort)
                })
              }}
              disabled={!ready || sending}
              icon={<ReasoningIcon />}
            />
            <ComposerChoiceChip
              ariaLabel={t('chat.permissionMode')}
              label={t(PERMISSION_LABEL_KEYS[permissionMode])}
              value={permissionMode}
              options={permissionOptions}
              onChange={(value) => {
                void changeSettings({ permissionMode: value as PermissionMode })
              }}
              disabled={!ready || sending}
              icon={<ShieldIcon />}
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
