import type { ModelMessage, TextPart, ToolCallPart, ToolResultPart } from 'ai'
import type { ChatMessage } from '@ateam/shared'

function userText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

/**
 * Rebuild the provider conversation from the persisted chat transcript.
 * Error messages are skipped; only settled tool calls are replayed.
 */
export function buildModelMessages(messages: ChatMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      const text = userText(message)
      if (!text.trim()) continue
      const previous = result[result.length - 1]
      if (previous?.role === 'user' && typeof previous.content === 'string') {
        previous.content = `${previous.content}\n\n${text}`
      } else {
        result.push({ role: 'user', content: text })
      }
      continue
    }

    if (message.status === 'error' || message.status === 'streaming') continue

    const assistantContent: Array<TextPart | ToolCallPart> = []
    const toolResults: ToolResultPart[] = []

    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim()) {
        assistantContent.push({ type: 'text', text: part.text })
        continue
      }
      if (part.type !== 'tool') continue
      if (part.state !== 'completed' && part.state !== 'failed' && part.state !== 'denied') {
        continue
      }

      assistantContent.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input ?? {}
      })

      if (part.state === 'completed') {
        toolResults.push({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: { type: 'text', value: part.output ?? '' }
        })
      } else if (part.state === 'denied') {
        toolResults.push({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: { type: 'execution-denied', reason: part.error }
        })
      } else {
        toolResults.push({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: { type: 'error-text', value: part.error ?? 'Tool failed' }
        })
      }
    }

    if (assistantContent.length > 0) {
      result.push({ role: 'assistant', content: assistantContent })
    }
    if (toolResults.length > 0) {
      result.push({ role: 'tool', content: toolResults })
    }
  }

  return result
}
