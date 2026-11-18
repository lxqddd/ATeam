import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const THEME_IDS = ['light', 'dark', 'sunset', 'cream', 'mist', 'ink', 'graphite'] as const
export type ThemeId = (typeof THEME_IDS)[number]
export type ThemePref = ThemeId | 'system'

export interface ThemeInfo {
  id: ThemePref
  nameKey: string
  descKey: string
  swatch: [string, string, string, string]
}

export const THEMES: ThemeInfo[] = [
  { id: 'system', nameKey: 'settings.theme.system', descKey: 'settings.theme.systemDesc', swatch: ['#f7f7f7', '#141414', '#f08a5d', '#ffffff'] },
  { id: 'light', nameKey: 'settings.theme.light', descKey: 'settings.theme.lightDesc', swatch: ['#f7f7f7', '#ffffff', '#141414', '#c45425'] },
  { id: 'dark', nameKey: 'settings.theme.dark', descKey: 'settings.theme.darkDesc', swatch: ['#141414', '#1f1f1f', '#f2f2f2', '#f08a5d'] },
  { id: 'sunset', nameKey: 'settings.theme.sunset', descKey: 'settings.theme.sunsetDesc', swatch: ['#fff8f1', '#ffffff', '#3f332d', '#c45425'] },
  { id: 'cream', nameKey: 'settings.theme.cream', descKey: 'settings.theme.creamDesc', swatch: ['#fffcf6', '#ffffff', '#403126', '#ab653e'] },
  { id: 'mist', nameKey: 'settings.theme.mist', descKey: 'settings.theme.mistDesc', swatch: ['#f5f8f9', '#ffffff', '#20343d', '#4f7182'] },
  { id: 'ink', nameKey: 'settings.theme.ink', descKey: 'settings.theme.inkDesc', swatch: ['#201a17', '#302722', '#f5ede6', '#f08a5d'] },
  { id: 'graphite', nameKey: 'settings.theme.graphite', descKey: 'settings.theme.graphiteDesc', swatch: ['#13161b', '#20252d', '#f0f2f6', '#7887f5'] },
]

const STORAGE_KEY = 'ateam.theme'
const DARK_THEMES: ThemeId[] = ['dark', 'ink', 'graphite']

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'system' || THEME_IDS.includes(value as ThemeId)
}

function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isThemePref(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(pref: ThemePref, dark: boolean): ThemeId {
  return pref === 'system' ? (dark ? 'dark' : 'light') : pref
}

function applyTheme(pref: ThemePref): ThemeId {
  const resolved = resolveTheme(pref, prefersDark())
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.themePref = pref
  root.classList.toggle('dark', DARK_THEMES.includes(resolved))
  const meta = document.querySelector('meta[name="color-scheme"]')
  if (meta) {
    meta.setAttribute('content', DARK_THEMES.includes(resolved) ? 'dark' : 'light')
  }
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    /* ignore */
  }
  return resolved
}

export function initTheme(): void {
  applyTheme(readPref())
}

export const useThemeStore = defineStore('theme', () => {
  const pref = ref<ThemePref>(readPref())
  const resolved = ref<ThemeId>(applyTheme(pref.value))
  const themes = THEMES
  const dark = computed(() => DARK_THEMES.includes(resolved.value))

  if (typeof matchMedia === 'function') {
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', () => {
      if (pref.value === 'system') {
        resolved.value = applyTheme('system')
      }
    })
  }

  function setTheme(next: ThemePref): void {
    pref.value = next
    resolved.value = applyTheme(next)
  }

  return { pref, resolved, dark, themes, setTheme }
})
