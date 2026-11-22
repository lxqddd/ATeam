import { describe, expect, it } from 'vitest'
import {
  clickScript,
  evalResult,
  formatSnapshot,
  snapshotScript,
  typeScript,
  validateBrowserUrl
} from './scripts'

describe('browser scripts', () => {
  it('accepts only http and https URLs', () => {
    expect(validateBrowserUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(validateBrowserUrl(' http://localhost:3000 ')).toBe('http://localhost:3000')
    expect(() => validateBrowserUrl('file:///etc/passwd')).toThrow('INVALID_URL')
    expect(() => validateBrowserUrl('javascript:alert(1)')).toThrow('INVALID_URL')
    expect(() => validateBrowserUrl('data:text/html,hi')).toThrow('INVALID_URL')
    expect(() => validateBrowserUrl('not a url')).toThrow('INVALID_URL')
  })

  it('builds a snapshot script that marks interactive elements', () => {
    const script = snapshotScript()
    expect(script).toContain('data-ateam-ref')
    expect(script).toContain('querySelectorAll')
    expect(script).toContain('innerText')
  })

  it('builds click and type scripts and rejects malformed refs', () => {
    expect(clickScript('12')).toContain('[data-ateam-ref="12"]')
    expect(() => clickScript('1"];alert(1)')).toThrow('INVALID_REF')

    const script = typeScript('3', 'hello "world"\nnext', true)
    expect(script).toContain('[data-ateam-ref="3"]')
    expect(script).toContain(JSON.stringify('hello "world"\nnext'))
    expect(script).toContain('requestSubmit')
    expect(() => typeScript('abc', 'x', false)).toThrow('INVALID_REF')
  })

  it('formats snapshots with elements, text and console output', () => {
    const formatted = formatSnapshot(
      {
        title: 'Demo',
        url: 'https://example.com/',
        text: 'Hello page',
        elements: [
          { ref: '1', role: 'button', name: 'Submit' },
          { ref: '2', role: 'input', name: 'Email', value: 'a@b.c' }
        ]
      },
      ['[log] ready']
    )
    expect(formatted).toContain('Page: Demo')
    expect(formatted).toContain('URL: https://example.com/')
    expect(formatted).toContain('[1] button "Submit"')
    expect(formatted).toContain('[2] input "Email" value="a@b.c"')
    expect(formatted).toContain('Page text:\nHello page')
    expect(formatted).toContain('Console:\n[log] ready')
  })

  it('formats evaluation results and truncates long output', () => {
    expect(evalResult(undefined)).toBe('undefined')
    expect(evalResult('text')).toBe('text')
    expect(evalResult({ a: 1 })).toBe('{"a":1}')
    expect(evalResult('x'.repeat(30_000))).toHaveLength(20_000 + '\n[output truncated]'.length)
  })
})
