import { theme as antdTheme } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import { createAntdTheme, readCssVar } from './theme'

function reader(values: Record<string, string>): (name: string) => string {
  return (name) => values[name] ?? ''
}

describe('createAntdTheme', () => {
  it('maps css variables into antd tokens', () => {
    const config = createAntdTheme(
      'light',
      reader({
        '--accent': '#9d3f29',
        '--accent-hover': '#85331f',
        '--surface': '#ffffff',
        '--background-subtle': '#f2f0eb',
        '--foreground': '#211d19',
        '--border': '#e5e0d7',
        '--danger': '#a33130'
      })
    )

    expect(config.token?.colorPrimary).toBe('#9d3f29')
    expect(config.token?.colorPrimaryHover).toBe('#85331f')
    expect(config.token?.colorBgContainer).toBe('#ffffff')
    expect(config.token?.colorBgLayout).toBe('#f2f0eb')
    expect(config.token?.colorText).toBe('#211d19')
    expect(config.token?.colorBorder).toBe('#e5e0d7')
    expect(config.token?.colorError).toBe('#a33130')
    expect(config.token?.borderRadius).toBe(10)
    expect(config.algorithm).toBe(antdTheme.defaultAlgorithm)
  })

  it('falls back to built-in colors when variables are missing', () => {
    const config = createAntdTheme('light', reader({}))

    expect(config.token?.colorPrimary).toBe('#9d3f29')
    expect(config.token?.colorBgContainer).toBe('#ffffff')
  })

  it('uses the dark algorithm and dark fallbacks', () => {
    const config = createAntdTheme('dark', reader({}))

    expect(config.algorithm).toBe(antdTheme.darkAlgorithm)
    expect(config.token?.colorPrimary).toBe('#f08a5d')
    expect(config.token?.colorBgContainer).toBe('#1f1f1f')
  })

  it('reads css variables through getComputedStyle by default', () => {
    const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => (name === '--accent' ? ' #123456 ' : '')
    } as unknown as CSSStyleDeclaration)

    const config = createAntdTheme('light')

    expect(spy).toHaveBeenCalled()
    expect(config.token?.colorPrimary).toBe('#123456')
    spy.mockRestore()
  })

  it('returns an empty string when there is no document', () => {
    vi.stubGlobal('document', undefined)
    try {
      expect(readCssVar('--accent')).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
