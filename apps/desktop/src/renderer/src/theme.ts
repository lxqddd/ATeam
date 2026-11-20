import { useSyncExternalStore } from 'react'
import { THEME_CHANNEL } from '@ateam/shared'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeState {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
}

export interface ThemeController extends ThemeState {
  setThemePreference: (preference: ThemePreference) => void
}

const THEME_STORAGE_KEY = 'ateam.theme'
const THEME_PREFERENCES: ThemePreference[] = ['light', 'dark', 'system']
const DEFAULT_THEME: ThemePreference = 'light'

let state: ThemeState = {
  preference: DEFAULT_THEME,
  resolvedTheme: DEFAULT_THEME
}
let initialized = false
const listeners = new Set<() => void>()

function isThemePreference(value: string | null): value is ThemePreference {
  return value !== null && THEME_PREFERENCES.includes(value as ThemePreference)
}

function getStoredThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

function getSystemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? getSystemTheme() : preference
}

function syncWindowChrome(theme: ResolvedTheme): void {
  if (typeof window === 'undefined' || !('electron' in window)) return
  window.electron.ipcRenderer.send(THEME_CHANNEL, theme)
}

function applyTheme(next: ThemeState): void {
  const root = document.documentElement
  root.dataset.theme = next.resolvedTheme
  root.dataset.themePref = next.preference
  root.style.colorScheme = next.resolvedTheme
  syncWindowChrome(next.resolvedTheme)
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
  const resolvedTheme = getSystemTheme()
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
