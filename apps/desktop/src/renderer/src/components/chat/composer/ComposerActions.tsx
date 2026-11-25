import { useTranslation } from 'react-i18next'
import { SendIcon, StopIcon } from './icons'

interface ComposerActionsProps {
  running: boolean
  sending: boolean
  sendDisabled: boolean
  onStop: () => void
  onSubmit: () => void
  onQueue: () => void
}

function ComposerActions({
  running,
  sending,
  sendDisabled,
  onStop,
  onSubmit,
  onQueue
}: ComposerActionsProps): React.JSX.Element {
  const { t } = useTranslation()

  if (running) {
    return (
      <div className="flex flex-none items-center gap-1.5">
        <button
          type="button"
          onClick={onQueue}
          disabled={sendDisabled}
          title={t('chat.queueSendHint')}
          aria-label={t('chat.queueSend')}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-active text-foreground transition-colors hover:bg-active/80 disabled:cursor-default disabled:bg-transparent disabled:text-subtle"
        >
          {sending ? (
            <span
              aria-hidden
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          ) : (
            <SendIcon />
          )}
        </button>
        <button
          type="button"
          onClick={onStop}
          title={t('chat.stop')}
          aria-label={t('chat.stop')}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent-hover"
        >
          <StopIcon />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onSubmit}
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
        <SendIcon />
      )}
    </button>
  )
}

export default ComposerActions
