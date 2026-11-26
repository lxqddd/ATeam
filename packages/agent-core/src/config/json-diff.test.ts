import { describe, expect, it } from 'vitest'
import { diffJsonEdits } from '@ateam/shared'

describe('diffJsonEdits', () => {
  it('reports changed leaves and keeps untouched siblings out of the diff', () => {
    expect(
      diffJsonEdits(
        { providers: { a: { name: 'A', baseURL: 'https://a' } }, skills: ['one'] },
        { providers: { a: { name: 'B', baseURL: 'https://a' } }, skills: ['one'] }
      )
    ).toEqual([{ path: ['providers', 'a', 'name'], value: 'B' }])
  })

  it('adds and removes keys', () => {
    expect(diffJsonEdits({ commands: { a: {} } }, { commands: { b: {} } })).toEqual([
      { path: ['commands', 'a'] },
      { path: ['commands', 'b'], value: {} }
    ])
  })

  it('replaces arrays and primitives whole', () => {
    expect(diffJsonEdits({ skills: ['a'] }, { skills: ['a', 'b'] })).toEqual([
      { path: ['skills'], value: ['a', 'b'] }
    ])
    expect(diffJsonEdits({ lsp: true }, { lsp: { servers: {} } })).toEqual([
      { path: ['lsp'], value: { servers: {} } }
    ])
  })

  it('returns no edits for equal values regardless of key order', () => {
    expect(diffJsonEdits({ a: { b: 1, c: [1, 2] } }, { a: { c: [1, 2], b: 1 } })).toEqual([])
    expect(diffJsonEdits(undefined, undefined)).toEqual([])
  })

  it('reports a whole replacement when the container type changes', () => {
    expect(diffJsonEdits({ a: { b: 1 } }, { a: [1] })).toEqual([{ path: ['a'], value: [1] }])
    expect(diffJsonEdits({ a: 1 }, { a: { b: 1 } })).toEqual([{ path: ['a'], value: { b: 1 } }])
  })

  it('diffs from an empty document so new projects only contain form values', () => {
    expect(diffJsonEdits({}, { providers: { local: { type: 'openai' } } })).toEqual([
      { path: ['providers'], value: { local: { type: 'openai' } } }
    ])
  })
})
