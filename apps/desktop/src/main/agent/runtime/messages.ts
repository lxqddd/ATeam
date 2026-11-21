import { randomUUID } from 'node:crypto'
import type { ChatMessage, MessageAttachment, MessagePart, TokenUsage } from '@ateam/shared'

export function nowIso(): string {
  return new Date().toISOString()
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function makeUserMessage(
  sessionId: string,
  text: string,
  attachments: MessageAttachment[] = []
): ChatMessage {
  const timestamp = nowIso()
  const parts: MessagePart[] = []
  if (text) parts.push({ type: 'text', text })
  for (const attachment of attachments) parts.push({ type: 'attachment', attachment })
  return {
    id: randomUUID(),
    sessionId,
    role: 'user',
    parts,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'complete'
  }
}

export function makeAssistantMessage(sessionId: string): ChatMessage {
  const timestamp = nowIso()
  return {
    id: randomUUID(),
    sessionId,
    role: 'assistant',
    parts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'streaming'
  }
}

export function usageFrom(total: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}): TokenUsage {
  return {
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    totalTokens: total.totalTokens
  }
}
