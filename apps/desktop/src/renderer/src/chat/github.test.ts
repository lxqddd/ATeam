import { describe, expect, it } from 'vitest'
import { MAX_GITHUB_TEXT_CHARS, lastAssistantText } from './github'
import { makeMessage, makeReasoningPart, makeTextPart, makeToolPart } from '../test/factories'

describe('lastAssistantText', () => {
  it('returns the newest assistant message text, skipping reasoning and tool parts', () => {
    const messages = [
      makeMessage({ role: 'user', parts: [makeTextPart('question')] }),
      makeMessage({
        role: 'assistant',
        parts: [makeReasoningPart('thinking'), makeTextPart('first'), makeTextPart('second')]
      })
    ]

    expect(lastAssistantText(messages)).toBe('first\nsecond')
  })

  it('ignores user messages after the assistant turn', () => {
    const messages = [
      makeMessage({ role: 'assistant', parts: [makeTextPart('answer')] }),
      makeMessage({ role: 'user', parts: [makeTextPart('follow-up')] })
    ]

    expect(lastAssistantText(messages)).toBe('answer')
  })

  it('returns an empty string when the latest assistant turn has no text', () => {
    expect(lastAssistantText([])).toBe('')
    expect(lastAssistantText([makeMessage({ parts: [makeToolPart()] })])).toBe('')
    expect(lastAssistantText([makeMessage({ parts: [makeTextPart('   ')] })])).toBe('')
  })

  it('caps the text length', () => {
    const long = 'x'.repeat(MAX_GITHUB_TEXT_CHARS + 5)
    expect(lastAssistantText([makeMessage({ parts: [makeTextPart(long)] })])).toHaveLength(
      MAX_GITHUB_TEXT_CHARS
    )
  })
})
