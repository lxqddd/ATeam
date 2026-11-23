import type { ChatMessage, SessionCompaction } from '@ateam/shared'

export const DEFAULT_CONTEXT_WINDOW = 128_000
export const COMPACTION_KEEP_TOKENS = 15_000
export const MIN_CONTEXT_BUFFER = 16_000
export const CONTEXT_BUFFER_RATIO = 0.15

const IMAGE_TOKEN_ESTIMATE = 1_500
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

export type TokenEncoder = (text: string) => number

export function estimateTextTokens(text: string, encode?: TokenEncoder): number {
  if (!text) return 0
  if (encode) return encode(text)
  let tokens = 0
  for (const character of text) {
    tokens += (character.codePointAt(0) ?? 0) > 0x7f ? 1 : 0.25
  }
  return Math.ceil(tokens)
}

export function estimateMessageTokens(message: ChatMessage, encode?: TokenEncoder): number {
  let tokens = 4
  for (const part of message.parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      tokens += estimateTextTokens(part.text, encode)
    } else if (part.type === 'tool') {
      tokens += estimateTextTokens(JSON.stringify(part.input ?? ''), encode)
      tokens += estimateTextTokens(part.output ?? '', encode)
      tokens += estimateTextTokens(part.error ?? '', encode)
      tokens += (part.images?.length ?? 0) * IMAGE_TOKEN_ESTIMATE
    } else if (part.type === 'attachment') {
      tokens +=
        part.attachment.kind === 'image'
          ? IMAGE_TOKEN_ESTIMATE
          : Math.ceil(part.attachment.size / 4)
    }
  }
  return tokens
}

export function estimateMessagesTokens(messages: ChatMessage[], encode?: TokenEncoder): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message, encode), 0)
}

function lastUsageTokens(
  messages: ChatMessage[],
  options: ContextEstimateOptions = {}
): { index: number; tokens: number } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant' || message.status !== 'complete') continue
    if (options.usageCreatedAfter && message.createdAt <= options.usageCreatedAfter) continue
    const usage = message.contextUsage ?? message.usage
    const input = usage?.inputTokens ?? 0
    if (input <= 0) continue
    return { index, tokens: input + (usage?.outputTokens ?? 0) }
  }
  return null
}

export interface ContextEstimateOptions {
  /** Ignore usage reported before this ISO timestamp (for example a compaction boundary). */
  usageCreatedAfter?: string
  encode?: TokenEncoder
}

/**
 * Estimate the next request's context size. When the provider reported usage,
 * anchor on the last assistant message and estimate only what came after it;
 * otherwise fall back to the heuristic.
 */
export function estimateContextTokens(
  messages: ChatMessage[],
  options: ContextEstimateOptions = {}
): number {
  const usage = lastUsageTokens(messages, options)
  if (!usage) return estimateMessagesTokens(messages, options.encode)
  return usage.tokens + estimateMessagesTokens(messages.slice(usage.index + 1), options.encode)
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

export function shouldCompact(
  messages: ChatMessage[],
  contextWindow: number,
  options: ContextEstimateOptions = {}
): boolean {
  return estimateContextTokens(messages, options) > contextTokenLimit(contextWindow)
}

export function planCompaction(
  messages: ChatMessage[],
  contextWindow: number,
  keepTokens = COMPACTION_KEEP_TOKENS,
  force = false,
  encode?: TokenEncoder
): CompactionPlan | null {
  const tokensBefore = estimateContextTokens(messages, { encode })
  const limit = Math.min(keepTokens, compactionKeepTokens(contextWindow))
  if (!force && tokensBefore <= limit) return null

  let accumulated = 0
  let start = messages.length
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const tokens = estimateMessageTokens(messages[index], encode)
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
    keepTokens: estimateMessagesTokens(keep, encode)
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
