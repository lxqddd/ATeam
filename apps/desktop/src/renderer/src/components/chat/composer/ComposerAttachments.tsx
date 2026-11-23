import { useTranslation } from 'react-i18next'
import type { MessageAttachment } from '@ateam/shared'
import { formatFileSize } from './constants'

interface ComposerAttachmentsProps {
  attachments: MessageAttachment[]
  onRemove: (attachment: MessageAttachment) => void
}

function ComposerAttachments({
  attachments,
  onRemove
}: ComposerAttachmentsProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (attachments.length === 0) return null

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment) => (
        <span
          key={attachment.id}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-subtle bg-background-subtle px-2 py-1 text-caption text-muted"
        >
          <span className="max-w-[200px] truncate text-foreground">{attachment.name}</span>
          <span className="flex-none">{formatFileSize(attachment.size)}</span>
          <button
            type="button"
            aria-label={`${t('chat.removeAttachment')}: ${attachment.name}`}
            onClick={() => onRemove(attachment)}
            className="flex-none rounded px-1 text-subtle transition-colors hover:text-danger"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )
}

export default ComposerAttachments
