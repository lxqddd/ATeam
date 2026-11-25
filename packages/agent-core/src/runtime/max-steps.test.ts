import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { createStepLimitHandler, MAX_STEPS_PROMPT } from './max-steps'

const history: ModelMessage[] = [
  { role: 'user', content: 'start' },
  { role: 'assistant', content: 'working' }
]

describe('createStepLimitHandler', () => {
  it('leaves steps before the limit untouched', () => {
    const prepareStep = createStepLimitHandler(25)

    expect(prepareStep({ stepNumber: 0, messages: history })).toBeUndefined()
    expect(prepareStep({ stepNumber: 23, messages: history })).toBeUndefined()
  })

  it('forces a text-only summary on the last allowed step', () => {
    const prepareStep = createStepLimitHandler(25)

    expect(prepareStep({ stepNumber: 24, messages: history })).toEqual({
      toolChoice: 'none',
      messages: [...history, { role: 'user', content: MAX_STEPS_PROMPT }]
    })
    // The caller's array is not mutated.
    expect(history).toHaveLength(2)
  })

  it('honours a custom step limit', () => {
    const prepareStep = createStepLimitHandler(3)

    expect(prepareStep({ stepNumber: 1, messages: history })).toBeUndefined()
    expect(prepareStep({ stepNumber: 2, messages: history })).toMatchObject({
      toolChoice: 'none'
    })
  })

  it('forces the summary for single-step agents', () => {
    const prepareStep = createStepLimitHandler(1)

    expect(prepareStep({ stepNumber: 0, messages: history })).toMatchObject({
      toolChoice: 'none'
    })
  })

  it('asks for the completed work, remaining tasks and next steps', () => {
    expect(MAX_STEPS_PROMPT).toContain('summary of what has been accomplished')
    expect(MAX_STEPS_PROMPT).toContain('remaining tasks that were not completed')
    expect(MAX_STEPS_PROMPT).toContain('Recommendations for what should be done next')
  })
})
