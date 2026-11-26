import { describe, expect, it } from 'vitest'
import { sessionForkSchema, sessionUndoSchema } from './agent/schemas'

describe('agent session IPC schemas', () => {
  it('keeps the step index when undoing a step', () => {
    expect(sessionUndoSchema.parse({ id: 's1', messageId: 'm1', stepIndex: 2 })).toEqual({
      id: 's1',
      messageId: 'm1',
      stepIndex: 2
    })
  })

  it('does not carry a step index into forks', () => {
    expect(sessionForkSchema.parse({ id: 's1', messageId: 'm1', stepIndex: 2 })).toEqual({
      id: 's1',
      messageId: 'm1'
    })
  })
})
