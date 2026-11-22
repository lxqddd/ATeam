import { describe, expect, it } from 'vitest'
import { formatReferenceLines, parseReferenceLines } from './reference-lines'

describe('reference lines', () => {
  it('parses local and repository references with descriptions', () => {
    expect(
      parseReferenceLines(
        [
          'docs=../product-docs | Product behavior and conventions',
          'sdk=owner/repo#main',
          'shared=~/shared-code',
          '',
          'invalid line'
        ].join('\n')
      )
    ).toEqual([
      {
        alias: 'docs',
        path: '../product-docs',
        description: 'Product behavior and conventions'
      },
      { alias: 'sdk', repository: 'owner/repo', branch: 'main' },
      { alias: 'shared', path: '~/shared-code' }
    ])
  })

  it('formats references back into editable lines', () => {
    expect(
      formatReferenceLines([
        { alias: 'docs', path: '../docs', description: 'Docs' },
        { alias: 'sdk', repository: 'owner/repo', branch: 'main' }
      ])
    ).toBe('docs=../docs | Docs\nsdk=owner/repo#main')
  })

  it('round-trips', () => {
    const text = 'docs=../docs | Docs\nsdk=owner/repo#main'
    expect(formatReferenceLines(parseReferenceLines(text))).toBe(text)
  })
})
