import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage, MessageAttachment, SyntheticMessageInfo } from '@ateam/shared'

interface UserMessageProps {
  message: ChatMessage
  sessionId?: string
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentChip({
  attachment,
  sessionId
}: {
  attachment: MessageAttachment
  sessionId?: string
}): React.JSX.Element {
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId || attachment.kind !== 'image') return
    let cancelled = false
    void window.api.agent.attachments
      .preview(sessionId, attachment.path)
      .then((url) => {
        if (!cancelled) setPreview(url)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [sessionId, attachment.kind, attachment.path])

  return (
    <span
      title={attachment.name}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-subtle bg-background-subtle px-2 py-1 text-caption text-muted"
    >
      {preview && (
        <img
          src={preview}
          alt={attachment.name}
          className="h-10 w-10 flex-none rounded object-cover"
        />
      )}
      <span className="max-w-[200px] truncate text-foreground">{attachment.name}</span>
      <span className="flex-none">{formatFileSize(attachment.size)}</span>
    </span>
  )
}

function SyntheticMessage({ synthetic }: { synthetic: SyntheticMessageInfo }): React.JSX.Element {
  const { t } = useTranslation()
  const failed = synthetic.state === 'failed'

  return (
    <div className="flex justify-center px-2" data-testid="background-result-message">
      <div
        className={`w-full max-w-[min(640px,92%)] rounded-lg border px-3 py-2 text-caption ${
          failed
            ? 'border-danger/30 bg-danger/5 text-danger'
            : 'border-border-subtle bg-background-subtle text-muted'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">
            {t(
              synthetic.kind === 'shell'
                ? 'chat.backgroundKindShell'
                : 'chat.backgroundKindSubagent'
            )}
          </span>
          <span className="min-w-0 truncate" title={synthetic.title}>
            {synthetic.title}
          </span>
          <span className="ml-auto flex-none text-subtle">
            {t(
              synthetic.state === 'failed'
                ? 'chat.backgroundStateFailed'
                : 'chat.backgroundStateCompleted'
            )}
          </span>
        </div>
        {synthetic.body && (
          <pre className="mt-1.5 mb-0 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.55] text-muted">
            {synthetic.body}
          </pre>
        )}
      </div>
    </div>
  )
}

function UserMessage({ message, sessionId }: UserMessageProps): React.JSX.Element {
  if (message.synthetic) return <SyntheticMessage synthetic={message.synthetic} />
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
  const attachments = message.parts.filter((part) => part.type === 'attachment')

  return (
    <div className="flex flex-col items-end gap-1.5">
      {text && (
        <div className="max-w-[min(640px,82%)] whitespace-pre-wrap break-words rounded-[14px_14px_6px_14px] bg-chat-user px-3.5 py-2 text-body text-foreground">
          {text}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex max-w-[min(640px,82%)] flex-wrap justify-end gap-1.5">
          {attachments.map((part) =>
            part.type === 'attachment' ? (
              <AttachmentChip
                key={part.attachment.id}
                attachment={part.attachment}
                sessionId={sessionId}
              />
            ) : null
          )}
        </div>
      )}
    </div>
  )
}

export default UserMessage
