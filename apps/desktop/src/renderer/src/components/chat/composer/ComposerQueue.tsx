import { useTranslation } from 'react-i18next'
import type { QueuedMessage } from '@ateam/shared'

interface ComposerQueueProps {
  items: QueuedMessage[]
  onEdit: (item: QueuedMessage) => void
  onRemove: (item: QueuedMessage) => void
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3 w-3" fill="none" stroke="currentColor">
      <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ComposerQueue({ items, onEdit, onRemove }: ComposerQueueProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (items.length === 0) return null

  return (
    <div className="mb-1.5 flex flex-col gap-1" data-testid="composer-queue">
      <div className="px-1 text-[11px] font-medium text-subtle">{t('chat.queueTitle')}</div>
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-caption"
        >
          <span className="flex-none rounded bg-active px-1.5 py-0.5 text-[10px] font-medium text-subtle">
            {item.strategy === 'interrupt' ? t('chat.queueInterrupt') : t('chat.queueAfterStep')}
          </span>
          <button
            type="button"
            onClick={() => onEdit(item)}
            title={t('chat.queueEdit')}
            className="min-w-0 flex-1 truncate text-left text-foreground hover:underline"
          >
            {item.text || t('chat.queueAttachmentOnly')}
          </button>
          <button
            type="button"
            onClick={() => onRemove(item)}
            title={t('chat.queueRemove')}
            aria-label={t('chat.queueRemove')}
            className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-subtle transition-colors hover:bg-active hover:text-foreground"
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  )
}

export default ComposerQueue
