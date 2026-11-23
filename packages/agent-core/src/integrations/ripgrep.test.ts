import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
  it('uses the bundled ripgrep binary', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-rg-'))
    try {
      await fs.writeFile(path.join(directory, 'a.txt'), 'alpha\nneedle here\n')
      const matches = await ripgrepSearch({
        cwd: directory,
        pattern: 'needle',
        maxResults: 10
      })
      expect(matches).toEqual([{ path: './a.txt', line: 2, text: 'needle here' }])
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

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
