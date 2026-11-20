import { describe, expect, it } from 'vitest'
import { buildModelMessages } from './message-history'
import { makeMessage, makeReasoningPart, makeTextPart, makeToolPart } from './test/factories'

describe('buildModelMessages', () => {
  it('returns nothing for an empty transcript', () => {
    expect(buildModelMessages([])).toEqual([])
  })

  it('maps a user text message', () => {
    const message = makeMessage({ role: 'user', parts: [makeTextPart('hello')] })
    expect(buildModelMessages([message])).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('merges consecutive user messages', () => {
    const first = makeMessage({ role: 'user', parts: [makeTextPart('one')] })
    const second = makeMessage({ role: 'user', parts: [makeTextPart('two')] })
    expect(buildModelMessages([first, second])).toEqual([{ role: 'user', content: 'one\n\ntwo' }])
  })

  it('skips user messages without text', () => {
    const message = makeMessage({ role: 'user', parts: [makeReasoningPart('thinking')] })
    expect(buildModelMessages([message])).toEqual([])
  })

  it('maps assistant text and a completed tool call', () => {
    const message = makeMessage({
      parts: [
        makeTextPart('answer'),
        makeToolPart({
          toolCallId: 'call-1',
          toolName: 'read',
          input: { path: 'a.txt' },
          state: 'completed',
          output: 'file'
        })
      ]
    })

    expect(buildModelMessages([message])).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'answer' },
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: { path: 'a.txt' } }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read',
            output: { type: 'text', value: 'file' }
          }
        ]
      }
    ])
  })

  it('maps failed tool results to error-text', () => {
    const message = makeMessage({
      parts: [makeToolPart({ toolCallId: 'call-1', state: 'failed', error: 'boom' })]
    })

    expect(buildModelMessages([message])).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: {} }]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'read',
            output: { type: 'error-text', value: 'boom' }
          }
        ]
      }
    ])
  })

  it('falls back to a generic message for failed tools without an error', () => {
    const message = makeMessage({
      parts: [makeToolPart({ state: 'failed', toolCallId: 'call-1' })]
    })
    const result = buildModelMessages([message])
    expect(result[1]).toMatchObject({
      role: 'tool',
      content: [{ output: { type: 'error-text', value: 'Tool failed' } }]
    })
  })

  it('maps denied tool results to execution-denied', () => {
    const message = makeMessage({
      parts: [makeToolPart({ state: 'denied', toolCallId: 'call-1', error: 'not allowed' })]
    })

    const result = buildModelMessages([message])
    expect(result[1]).toMatchObject({
      role: 'tool',
      content: [{ output: { type: 'execution-denied', reason: 'not allowed' } }]
    })
  })

  it('skips unsettled tool calls', () => {
    for (const state of ['pending', 'running', 'awaiting-approval'] as const) {
      const message = makeMessage({ parts: [makeToolPart({ state })] })
      expect(buildModelMessages([message])).toEqual([])
    }
  })

  it('skips error and streaming assistant messages', () => {
    for (const status of ['error', 'streaming'] as const) {
      const message = makeMessage({ status, parts: [makeTextPart('partial')] })
      expect(buildModelMessages([message])).toEqual([])
    }
  })

  it('includes interrupted assistant messages', () => {
    const message = makeMessage({ status: 'interrupted', parts: [makeTextPart('stopped')] })
    expect(buildModelMessages([message])).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'stopped' }] }
    ])
  })

  it('skips reasoning parts', () => {
    const message = makeMessage({
      parts: [makeReasoningPart('thinking'), makeTextPart('answer')]
    })
    expect(buildModelMessages([message])).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }] }
    ])
  })

  it('produces no message for an assistant without content', () => {
    const message = makeMessage({ parts: [makeReasoningPart('thinking'), makeTextPart('   ')] })
    expect(buildModelMessages([message])).toEqual([])
  })

  it('defaults missing tool input and output', () => {
    const message = makeMessage({
      parts: [
        makeToolPart({
          toolCallId: 'call-1',
          toolName: 'read',
          input: undefined,
          state: 'completed',
          output: undefined
        })
      ]
    })

    const result = buildModelMessages([message])

    expect(result[0]).toMatchObject({
      content: [{ type: 'tool-call', toolCallId: 'call-1', input: {} }]
    })
    expect(result[1]).toMatchObject({
      content: [{ output: { type: 'text', value: '' } }]
    })
  })
})
