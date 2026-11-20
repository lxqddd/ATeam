import { theme as antdTheme } from 'antd'
import { describe, expect, it } from 'vitest'
import { createAntdTheme } from './theme'

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
})
