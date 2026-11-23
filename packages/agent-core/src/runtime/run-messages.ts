import type { ChatMessage, MessagePart } from '@ateam/shared'
import { nowIso } from './messages'
import type { EventSink } from './runtime-events'
import type { Run } from './types'

export type ToolPart = Extract<MessagePart, { type: 'tool' }>

export interface FormattedToolOutput {
  text?: string
  images?: Array<{ mimeType: string; data: string }>
}

export function formatToolOutput(output: unknown): FormattedToolOutput {
  if (output && typeof output === 'object' && 'summary' in output && 'image' in output) {
    const media = output as {
      summary: string
      image: { mimeType: string; data: string }
    }
    return { text: media.summary, images: [media.image] }
  }
  if (typeof output === 'string') return { text: output }
  try {
    return { text: JSON.stringify(output) }
  } catch {
    return { text: String(output) }
  }
}

export function findToolPart(message: ChatMessage, toolCallId: string): MessagePart | undefined {
  return message.parts.find((part) => part.type === 'tool' && part.toolCallId === toolCallId)
}

export function ensureToolPart(
  message: ChatMessage,
  toolCallId: string,
  toolName: string
): ToolPart {
  const existing = findToolPart(message, toolCallId)
  if (existing && existing.type === 'tool') return existing
  const part: ToolPart = {
    type: 'tool',
    toolCallId,
    toolName,
    state: 'pending',
    startedAt: nowIso()
  }
  message.parts.push(part)
  return part
}

export function emitPart(events: EventSink, run: Run, part: MessagePart, index: number): void {
  events.emit({
    type: 'message.part.upsert',
    sessionId: run.sessionId,
    messageId: run.messageId,
    partIndex: index,
    part: structuredClone(part)
  })
}

export function appendToolOutput(
  events: EventSink,
  message: ChatMessage,
  run: Run,
  toolCallId: string,
  delta: string
): void {
  const part = findToolPart(message, toolCallId)
  if (!part || part.type !== 'tool') return
  part.output = (part.output ?? '') + delta
  events.emit({
    type: 'message.part.delta',
    sessionId: run.sessionId,
    messageId: run.messageId,
    partIndex: message.parts.indexOf(part),
    kind: 'tool-output',
    delta
  })
}

export function settleTools(message: ChatMessage, reason: string): void {
  for (const part of message.parts) {
    if (
      part.type === 'tool' &&
      (part.state === 'pending' || part.state === 'running' || part.state === 'awaiting-approval')
    ) {
      part.state = 'failed'
      part.error = reason
      part.finishedAt = nowIso()
    }
  }
}
