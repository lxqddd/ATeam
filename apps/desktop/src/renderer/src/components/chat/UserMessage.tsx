import type { ChatMessage } from '@ateam/shared'

interface UserMessageProps {
  message: ChatMessage
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function UserMessage({ message }: UserMessageProps): React.JSX.Element {
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
              <span
                key={part.attachment.id}
                title={part.attachment.name}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-subtle bg-background-subtle px-2 py-1 text-caption text-muted"
              >
                <span className="max-w-[200px] truncate text-foreground">
                  {part.attachment.name}
                </span>
                <span className="flex-none">{formatFileSize(part.attachment.size)}</span>
              </span>
            ) : null
          )}
        </div>
      )}
    </div>
  )
}

export default UserMessage
