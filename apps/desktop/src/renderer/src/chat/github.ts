import type { ChatMessage, MessagePart } from '@ateam/shared'

/** Upper bound for text seeded into the composer or posted back to GitHub. */
export const MAX_GITHUB_TEXT_CHARS = 60_000

type TextPart = Extract<MessagePart, { type: 'text' }>

function textOf(message: ChatMessage): string {
  return message.parts
    .filter((part): part is TextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

/**
 * Text of the newest assistant message, used as the default comment and pull
 * request body. Returns an empty string when the latest turn produced no text
 * (for example a tool-only turn).
 */
export function lastAssistantText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    return textOf(message).slice(0, MAX_GITHUB_TEXT_CHARS)
  }
  return ''
}
