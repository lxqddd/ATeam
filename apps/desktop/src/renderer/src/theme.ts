import { useSyncExternalStore } from 'react'

export type ThemeId = 'light' | 'dark' | 'sunset' | 'ink' | 'graphite' | 'cream' | 'mist'
export type ThemePreference = ThemeId | 'system'
export type ResolvedTheme = ThemeId
export type ThemeBase = 'light' | 'dark'

export interface ThemeMeta {
  id: ThemeId
  labelKey: string
  base: ThemeBase
  /** Preview colors: background, surface, text, accent. */
  swatch: [string, string, string, string]
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'light',
    labelKey: 'settings.themeLight',
    base: 'light',
    swatch: ['#faf9f6', '#ffffff', '#211d19', '#9d3f29']
  },
  {
    id: 'dark',
    labelKey: 'settings.themeDark',
    base: 'dark',
    swatch: ['#141414', '#1f1f1f', '#f2f2f2', '#f08a5d']
  },
  {
    id: 'sunset',
    labelKey: 'settings.themeSunset',
    base: 'light',
    swatch: ['#fff8f1', '#ffffff', '#3f332d', '#c45425']
  },
  {
    id: 'ink',
    labelKey: 'settings.themeInk',
    base: 'dark',
    swatch: ['#201a17', '#302722', '#f5ede6', '#f08a5d']
  },
  {
    id: 'graphite',
    labelKey: 'settings.themeGraphite',
    base: 'dark',
    swatch: ['#13161b', '#20252d', '#f0f2f6', '#7887f5']
  },
  {
    id: 'cream',
    labelKey: 'settings.themeCream',
    base: 'light',
    swatch: ['#fffcf6', '#ffffff', '#403126', '#ab653e']
  },
  {
    id: 'mist',
    labelKey: 'settings.themeMist',
    base: 'light',
    swatch: ['#f5f8f9', '#ffffff', '#20343d', '#4f7182']
  }
]

export const THEME_IDS: ThemeId[] = ['light', 'dark', 'sunset', 'ink', 'graphite', 'cream', 'mist']

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || THEME_IDS.includes(value as ThemeId)
}

export function themeBase(id: ThemeId): ThemeBase {
  return THEMES.find((theme) => theme.id === id)?.base ?? 'light'
}

export function isDarkTheme(id: ThemeId): boolean {
  return themeBase(id) === 'dark'
}

export function resolveThemePreference(preference: ThemePreference, systemDark: boolean): ThemeId {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export interface ThemeState {
  preference: ThemePreference
  resolvedTheme: ThemeId
}

export interface ThemeController extends ThemeState {
  setThemePreference: (preference: ThemePreference) => void
}

const THEME_STORAGE_KEY = 'ateam.theme'
const DEFAULT_THEME: ThemePreference = 'light'

let state: ThemeState = {
  preference: DEFAULT_THEME,
  resolvedTheme: DEFAULT_THEME
}
let initialized = false
const listeners = new Set<() => void>()

function getStoredThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function getSystemDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveTheme(preference: ThemePreference): ThemeId {
  return resolveThemePreference(preference, getSystemDark())
}

function syncWindowChrome(theme: ThemeBase): void {
  if (typeof window === 'undefined' || !('api' in window)) return
  window.api.theme.set(theme)
}

function applyTheme(next: ThemeState): void {
  const root = document.documentElement
  root.dataset.theme = next.resolvedTheme
  root.dataset.themePref = next.preference
  root.style.colorScheme = themeBase(next.resolvedTheme)
  syncWindowChrome(themeBase(next.resolvedTheme))
}

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getThemeSnapshot(): ThemeState {
  return state
}

function handleSystemThemeChange(): void {
  if (state.preference !== 'system') return
  const resolvedTheme = resolveThemePreference('system', getSystemDark())
  if (resolvedTheme === state.resolvedTheme) return
  state = { ...state, resolvedTheme }
  applyTheme(state)
  emit()
}

export function initTheme(): void {
  if (initialized) return
  initialized = true

  const preference = getStoredThemePreference()
  state = { preference, resolvedTheme: resolveTheme(preference) }
  applyTheme(state)

  if (typeof matchMedia !== 'function') return
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', handleSystemThemeChange)
}

export function setThemePreference(preference: ThemePreference): void {
  state = { preference, resolvedTheme: resolveTheme(preference) }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Ignore storage failures; the in-memory preference still applies.
  }
  applyTheme(state)
  emit()
}

export function useTheme(): ThemeController {
  const snapshot = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeSnapshot)
  return { ...snapshot, setThemePreference }
}
