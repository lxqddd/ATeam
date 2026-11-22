import { describe, expect, it } from 'vitest'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('unwraps Electron IPC errors', () => {
    expect(
      errorMessage(
        new Error(
          "Error invoking remote method 'ateam:agent:sessions:set-model': Error: MODEL_EXISTS"
        )
      )
    ).toBe('MODEL_EXISTS')
    expect(errorMessage(new Error("Error invoking remote method 'x': SESSION_BUSY"))).toBe(
      'SESSION_BUSY'
    )
  })

  it('keeps ordinary error messages', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('plain')).toBe('plain')
  })
})
