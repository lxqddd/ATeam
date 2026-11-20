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

  it.each(['dark', 'ink', 'graphite'] as const)(
    'uses the dark algorithm for the %s theme',
    (themeId) => {
      const config = createAntdTheme(themeId, reader({}))

      expect(config.algorithm).toBe(antdTheme.darkAlgorithm)
    }
  )

  it.each(['light', 'sunset', 'cream', 'mist'] as const)(
    'uses the default algorithm for the %s theme',
    (themeId) => {
      const config = createAntdTheme(themeId, reader({}))

      expect(config.algorithm).toBe(antdTheme.defaultAlgorithm)
    }
  )

  it('selects the fallback palette from the theme base family', () => {
    const sunset = createAntdTheme('sunset', reader({}))
    const mist = createAntdTheme('mist', reader({}))
    const ink = createAntdTheme('ink', reader({}))
    const graphite = createAntdTheme('graphite', reader({}))

    expect(sunset.token?.colorPrimary).toBe('#9d3f29')
    expect(sunset.token?.colorBgContainer).toBe('#ffffff')
    expect(mist.token?.colorPrimary).toBe('#9d3f29')
    expect(ink.token?.colorPrimary).toBe('#f08a5d')
    expect(ink.token?.colorBgContainer).toBe('#1f1f1f')
    expect(graphite.token?.colorPrimary).toBe('#f08a5d')
    expect(graphite.token?.colorBgContainer).toBe('#1f1f1f')
  })

  it('maps switch tokens from the theme variables', () => {
    const config = createAntdTheme(
      'mist',
      reader({
        '--accent': '#4f7182',
        '--switch-off': '#c9d5da',
        '--switch-thumb': '#ffffff'
      })
    )

    expect(config.components?.Switch).toMatchObject({
      trackHeight: 20,
      trackMinWidth: 36,
      handleSize: 16,
      colorPrimary: '#4f7182',
      colorTextQuaternary: '#c9d5da',
      colorTextLightSolid: '#ffffff'
    })
  })

  it('falls back to the base switch palette when variables are missing', () => {
    expect(createAntdTheme('sunset', reader({})).components?.Switch).toMatchObject({
      colorTextQuaternary: '#ded8cc',
      colorTextLightSolid: '#ffffff'
    })
    expect(createAntdTheme('ink', reader({})).components?.Switch).toMatchObject({
      colorTextQuaternary: '#3a3a3a',
      colorTextLightSolid: '#ffffff'
    })
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
