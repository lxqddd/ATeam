import type { ChatMessage, SessionCompaction } from '@ateam/shared'

export const DEFAULT_CONTEXT_WINDOW = 128_000
export const COMPACTION_KEEP_TOKENS = 15_000
export const MIN_CONTEXT_BUFFER = 16_000
export const CONTEXT_BUFFER_RATIO = 0.15

const SUMMARY_INPUT_LIMIT = 60_000
const SUMMARY_TOOL_OUTPUT_LIMIT = 4_000
const SUMMARY_TEXT_LIMIT = 8_000

export interface CompactionPlan {
  older: ChatMessage[]
  keep: ChatMessage[]
  throughMessageId: string
  tokensBefore: number
  keepTokens: number
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0
  let tokens = 0
  for (const character of text) {
    tokens += (character.codePointAt(0) ?? 0) > 0x7f ? 1 : 0.25
  }
  return Math.ceil(tokens)
}

export function estimateMessageTokens(message: ChatMessage): number {
  let tokens = 4
  for (const part of message.parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      tokens += estimateTextTokens(part.text)
    } else if (part.type === 'tool') {
      tokens += estimateTextTokens(JSON.stringify(part.input ?? ''))
      tokens += estimateTextTokens(part.output ?? '')
      tokens += estimateTextTokens(part.error ?? '')
    }
  }
  return tokens
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
}

export function contextTokenLimit(contextWindow: number): number {
  const buffer = Math.max(MIN_CONTEXT_BUFFER, Math.round(contextWindow * CONTEXT_BUFFER_RATIO))
  return Math.max(1, contextWindow - buffer)
}

export function compactionKeepTokens(contextWindow: number): number {
  return Math.max(
    500,
    Math.min(COMPACTION_KEEP_TOKENS, Math.floor(contextTokenLimit(contextWindow) / 2))
  )
}

export function shouldCompact(messages: ChatMessage[], contextWindow: number): boolean {
  return estimateMessagesTokens(messages) > contextTokenLimit(contextWindow)
}

export function planCompaction(
  messages: ChatMessage[],
  contextWindow: number,
  keepTokens = COMPACTION_KEEP_TOKENS,
  force = false
): CompactionPlan | null {
  const tokensBefore = estimateMessagesTokens(messages)
  const limit = Math.min(keepTokens, compactionKeepTokens(contextWindow))
  if (!force && tokensBefore <= limit) return null

  let accumulated = 0
  let start = messages.length
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const tokens = estimateMessageTokens(messages[index])
    if (accumulated + tokens > (force ? 0 : limit)) break
    accumulated += tokens
    start = index
  }

  let keptFrom = start
  while (keptFrom < messages.length && messages[keptFrom].role !== 'user') keptFrom += 1
  if (keptFrom >= messages.length) {
    let fallback = Math.min(start, messages.length - 1)
    while (fallback > 0 && messages[fallback].role !== 'user') fallback -= 1
    if (fallback === 0) return null
    keptFrom = fallback
  }
  if (keptFrom === 0 || keptFrom >= messages.length) return null

  const older = messages.slice(0, keptFrom)
  const keep = messages.slice(keptFrom)
  return {
    older,
    keep,
    throughMessageId: older[older.length - 1].id,
    tokensBefore,
    keepTokens: estimateMessagesTokens(keep)
  }
}

export function messagesAfterCompaction(
  messages: ChatMessage[],
  compaction: SessionCompaction | null
): ChatMessage[] {
  if (!compaction) return messages
  const index = messages.findIndex((message) => message.id === compaction.throughMessageId)
  if (index < 0) return messages
  return messages.slice(index + 1)
}

export function summaryPrompt(older: ChatMessage[], previousSummary?: string | null): string {
  const lines: string[] = [
    'You are compacting an older part of a coding-agent conversation.',
    'Write a concise summary that preserves user goals and constraints, decisions, files inspected or changed, important tool results, and pending tasks.',
    'Do not invent facts. Do not call tools.',
    ''
  ]
  if (previousSummary?.trim()) {
    lines.push('Previous summary:', previousSummary.trim(), '')
  }
  lines.push('Conversation to compact:', formatMessages(older))
  return lines.join('\n').slice(0, SUMMARY_INPUT_LIMIT)
}

function formatMessages(messages: ChatMessage[]): string {
  const lines: string[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      const text = message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
      if (text.trim()) lines.push(`USER:\n${truncate(text, SUMMARY_TEXT_LIMIT)}`)
      continue
    }
    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim()) {
        lines.push(`ASSISTANT:\n${truncate(part.text, SUMMARY_TEXT_LIMIT)}`)
      } else if (part.type === 'reasoning' && part.text.trim()) {
        lines.push(`REASONING:\n${truncate(part.text, SUMMARY_TEXT_LIMIT)}`)
      } else if (part.type === 'tool') {
        const input = truncate(JSON.stringify(part.input ?? {}), SUMMARY_TOOL_OUTPUT_LIMIT)
        const output = part.output
          ? `\n${truncate(part.output, SUMMARY_TOOL_OUTPUT_LIMIT)}`
          : part.error
            ? `\n${truncate(part.error, SUMMARY_TOOL_OUTPUT_LIMIT)}`
            : ''
        lines.push(`TOOL ${part.toolName} (${input}):${output}`)
      }
    }
  }
  return lines.join('\n\n')
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value
}

export function systemWithSummary(system: string, summary?: string | null): string {
  const text = summary?.trim()
  if (!text) return system
  return `${system}\n\nEarlier conversation summary:\n${text}`
}
