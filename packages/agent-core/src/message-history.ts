import type {
  AssistantModelMessage,
  FilePart,
  ImagePart,
  ModelMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart
} from 'ai'
import type { AttachmentKind, ChatMessage, ModelRef } from '@ateam/shared'

interface ReasoningContentPart {
  type: 'reasoning'
  text: string
  providerOptions?: Record<string, unknown>
}

export interface AttachmentPayload {
  kind: AttachmentKind
  name: string
  mimeType: string
  data?: Uint8Array
  text?: string
}

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
export function buildModelMessages(
  messages: ChatMessage[],
  attachments?: Map<string, AttachmentPayload>,
  options: { currentModel?: ModelRef | null } = {}
): ModelMessage[] {
  const result: ModelMessage[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      const text = userText(message)
      const attached = message.parts.filter((part) => part.type === 'attachment')
      if (attached.length > 0) {
        const content: Array<TextPart | ImagePart | FilePart> = []
        if (text.trim()) content.push({ type: 'text', text })
        for (const part of attached) {
          if (part.type !== 'attachment') continue
          const payload = attachments?.get(part.attachment.id)
          if (!payload) continue
          if (payload.kind === 'text') {
            content.push({
              type: 'text',
              text: `File: ${payload.name}\n\`\`\`\n${payload.text ?? ''}\n\`\`\``
            })
          } else if (payload.kind === 'image' && payload.data) {
            content.push({ type: 'file', data: payload.data, mediaType: payload.mimeType })
          } else if (payload.kind === 'pdf' && payload.text) {
            content.push({
              type: 'text',
              text: `File: ${payload.name}\n\`\`\`\n${payload.text}\n\`\`\``
            })
          } else if (payload.kind === 'pdf' && payload.data) {
            content.push({
              type: 'file',
              data: payload.data,
              mediaType: payload.mimeType,
              filename: payload.name
            })
          }
        }
        if (content.length > 0) result.push({ role: 'user', content })
        continue
      }

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

    const assistantContent: Array<TextPart | ToolCallPart | ReasoningContentPart> = []
    const toolResults: ToolResultPart[] = []
    const sameModel =
      Boolean(message.model && options.currentModel) &&
      message.model?.providerId === options.currentModel?.providerId &&
      message.model?.modelId === options.currentModel?.modelId

    for (const part of message.parts) {
      if (part.type === 'reasoning') {
        if (!sameModel || !part.providerMetadata || !part.text.trim()) continue
        assistantContent.push({
          type: 'reasoning',
          text: part.text,
          providerOptions: part.providerMetadata
        })
        continue
      }
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
        const images = part.images ?? []
        toolResults.push({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output:
            images.length > 0
              ? {
                  type: 'content',
                  value: [
                    { type: 'text', text: part.output ?? '' },
                    ...images.map((image) => ({
                      type: 'image-data' as const,
                      data: image.data,
                      mediaType: image.mimeType
                    }))
                  ]
                }
              : { type: 'text', value: part.output ?? '' }
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
      result.push({
        role: 'assistant',
        content: assistantContent as AssistantModelMessage['content']
      })
    }
    if (toolResults.length > 0) {
      result.push({ role: 'tool', content: toolResults })
    }
  }

  return result
}

/** Add an Anthropic cache breakpoint to the last user or tool message. */
export function applyAnthropicCache(messages: ModelMessage[]): ModelMessage[] {
  let index = messages.length - 1
  while (index >= 0 && messages[index].role === 'system') index -= 1
  if (index < 0) return messages
  const target = messages[index]
  const cacheOptions = {
    anthropic: { cacheControl: { type: 'ephemeral' } }
  } as TextPart['providerOptions']

  if (target.role === 'user') {
    if (typeof target.content === 'string') {
      const next = {
        ...target,
        content: [{ type: 'text' as const, text: target.content, providerOptions: cacheOptions }]
      }
      return [...messages.slice(0, index), next, ...messages.slice(index + 1)]
    }

    const content = [...target.content]
    for (let cursor = content.length - 1; cursor >= 0; cursor -= 1) {
      const part = content[cursor]
      if (part.type !== 'text') continue
      content[cursor] = {
        ...part,
        providerOptions: { ...part.providerOptions, ...cacheOptions }
      }
      const next = { ...target, content }
      return [...messages.slice(0, index), next, ...messages.slice(index + 1)]
    }
    return messages
  }

  if (target.role === 'tool') {
    const content = [...target.content]
    for (let cursor = content.length - 1; cursor >= 0; cursor -= 1) {
      const part = content[cursor]
      if (part.type !== 'tool-result') continue
      content[cursor] = {
        ...part,
        providerOptions: { ...part.providerOptions, ...cacheOptions }
      } as ToolResultPart
      const next = { ...target, content }
      return [...messages.slice(0, index), next, ...messages.slice(index + 1)]
    }
  }

  return messages
}
