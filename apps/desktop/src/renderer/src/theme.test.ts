import { beforeEach, describe, expect, it, vi } from 'vitest'

let systemDark = false
const mediaListeners: Array<() => void> = []

function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: systemDark,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (event: string, listener: () => void) => {
      if (event === 'change') mediaListeners.push(listener)
    },
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia
}

async function loadTheme(): Promise<typeof import('./theme')> {
  vi.resetModules()
  return import('./theme')
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  systemDark = false
  mediaListeners.length = 0
  installMatchMedia()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themePref
  document.documentElement.style.colorScheme = ''
})

describe('theme metadata', () => {
  it('lists the seven built-in themes in nomi order', async () => {
    const { THEMES, THEME_IDS } = await loadTheme()

    expect(THEMES.map((theme) => theme.id)).toEqual([
      'light',
      'dark',
      'sunset',
      'ink',
      'graphite',
      'cream',
      'mist'
    ])
    expect(THEME_IDS).toEqual(['light', 'dark', 'sunset', 'ink', 'graphite', 'cream', 'mist'])
    expect(THEMES.find((theme) => theme.id === 'sunset')?.swatch).toEqual([
      '#fff8f1',
      '#ffffff',
      '#3f332d',
      '#c45425'
    ])
  })

  it('classifies themes into light and dark base families', async () => {
    const { isDarkTheme, themeBase } = await loadTheme()

    for (const id of ['light', 'sunset', 'cream', 'mist'] as const) {
      expect(themeBase(id)).toBe('light')
      expect(isDarkTheme(id)).toBe(false)
    }
    for (const id of ['dark', 'ink', 'graphite'] as const) {
      expect(themeBase(id)).toBe('dark')
      expect(isDarkTheme(id)).toBe(true)
    }
  })

  it('resolves the system preference to light or dark', async () => {
    const { resolveThemePreference } = await loadTheme()

    expect(resolveThemePreference('system', true)).toBe('dark')
    expect(resolveThemePreference('system', false)).toBe('light')
    expect(resolveThemePreference('ink', false)).toBe('ink')
    expect(resolveThemePreference('mist', true)).toBe('mist')
  })

  it('accepts built-in theme ids and system, but rejects unknown values', async () => {
    const { isThemePreference } = await loadTheme()

    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('graphite')).toBe(true)
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('purple')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
  })
})

describe('theme initialization and switching', () => {
  it('defaults to the light theme', async () => {
    const { initTheme } = await loadTheme()

    initTheme()

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.themePref).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('falls back to light when localStorage holds an unknown preference', async () => {
    localStorage.setItem('ateam.theme', 'purple')
    const { initTheme } = await loadTheme()

    initTheme()

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.themePref).toBe('light')
  })

  it('restores a stored dark-family theme', async () => {
    localStorage.setItem('ateam.theme', 'graphite')
    const { initTheme } = await loadTheme()

    initTheme()

    expect(document.documentElement.dataset.theme).toBe('graphite')
    expect(document.documentElement.dataset.themePref).toBe('graphite')
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('stores the preference and applies the theme dataset and color scheme', async () => {
    const { initTheme, setThemePreference } = await loadTheme()
    initTheme()

    setThemePreference('ink')

    expect(localStorage.getItem('ateam.theme')).toBe('ink')
    expect(document.documentElement.dataset.theme).toBe('ink')
    expect(document.documentElement.dataset.themePref).toBe('ink')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    setThemePreference('sunset')

    expect(localStorage.getItem('ateam.theme')).toBe('sunset')
    expect(document.documentElement.dataset.theme).toBe('sunset')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('follows the system color scheme when the preference is system', async () => {
    systemDark = true
    localStorage.setItem('ateam.theme', 'system')
    const { initTheme } = await loadTheme()

    initTheme()

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(mediaListeners).toHaveLength(1)

    systemDark = false
    mediaListeners[0]!()

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })

  it('ignores system color scheme changes for explicit themes', async () => {
    const { initTheme } = await loadTheme()
    initTheme()

    systemDark = true
    mediaListeners[0]!()

    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
