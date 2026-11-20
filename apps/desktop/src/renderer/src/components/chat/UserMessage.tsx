import type { ChatMessage } from '@ateam/shared'

interface UserMessageProps {
  message: ChatMessage
}

function UserMessage({ message }: UserMessageProps): React.JSX.Element {
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')

  return (
    <div className="flex flex-col items-end">
      <div className="max-w-[min(640px,82%)] whitespace-pre-wrap break-words rounded-[14px_14px_6px_14px] bg-chat-user px-3.5 py-2 text-body text-foreground">
        {text}
      </div>
    </div>
  )
}

export default UserMessage
