import type { QuestionAnswer } from '@ateam/shared'
import { normalizeError } from '../errors'

export function formatQuestionAnswer(answer: QuestionAnswer): string {
  if (answer.timedOut) return 'User did not answer the question in time.'
  if (answer.cancelled) return 'User cancelled the question.'
  const parts: string[] = []
  if (answer.selected.length > 0) parts.push(answer.selected.join(', '))
  if (answer.custom?.trim()) parts.push(`custom: ${answer.custom.trim()}`)
  if (parts.length === 0) return 'User did not answer the question.'
  return `User answered: ${parts.join('; ')}`
}

export function isContextLengthError(error: unknown): boolean {
  const message = normalizeError(error).toLowerCase()
  return [
    'context length',
    'context_length',
    'maximum context',
    'context window',
    'too many tokens',
    'token limit',
    'prompt is too long',
    'input is too long',
    'exceeds the maximum',
    'request too large',
    '413'
  ].some((fragment) => message.includes(fragment))
}
