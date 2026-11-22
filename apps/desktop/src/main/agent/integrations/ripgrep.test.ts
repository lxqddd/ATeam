import { describe, expect, it } from 'vitest'
import { parseRipgrepJson, ripgrepSearch } from './ripgrep'

describe('parseRipgrepJson', () => {
  it('extracts match events and ignores other records', () => {
    const lines = [
      JSON.stringify({ type: 'begin', data: { path: { text: 'a.ts' } } }),
      JSON.stringify({
        type: 'match',
        data: {
          path: { text: 'a.ts' },
          line_number: 3,
          lines: { text: 'const value = 1\n' }
        }
      }),
      JSON.stringify({ type: 'end', data: { path: { text: 'a.ts' } } })
    ]

    expect(parseRipgrepJson(lines)).toEqual([{ path: 'a.ts', line: 3, text: 'const value = 1' }])
  })

  it('ignores malformed records', () => {
    expect(parseRipgrepJson(['not json', '{}'])).toEqual([])
  })
})

describe('ripgrepSearch', () => {
  it('returns null when ripgrep is unavailable', async () => {
    await expect(
      ripgrepSearch({
        cwd: process.cwd(),
        pattern: 'x',
        maxResults: 10,
        binary: 'rg-definitely-missing-binary'
      })
    ).resolves.toBeNull()
  })
})
