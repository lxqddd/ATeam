import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemeId = 'light' | 'dark' | 'sunset' | 'ink' | 'graphite' | 'cream' | 'mist'
export type ThemePref = ThemeId | 'system'

export interface ThemePalette {
  dark: boolean
  bg: string
  surface: string
  text: string
  textMuted: string
  accent: string
  accentStrong: string
  border: string
  success: string
  warning: string
  danger: string
}

export interface ThemeInfo {
  id: ThemePref
  nameKey: string
  descKey: string
  swatch: [string, string, string, string]
}

const PALETTES: Record<ThemeId, ThemePalette> = {
  light: {
    dark: false,
    bg: '#faf9f6',
    surface: '#ffffff',
    text: '#211d19',
    textMuted: '#625951',
    accent: '#9d3f29',
    accentStrong: '#9d3f29',
    border: '#e5e0d7',
    success: '#24684c',
    warning: '#7c4a00',
    danger: '#a33130',
  },
  dark: {
    dark: true,
    bg: '#141414',
    surface: '#1f1f1f',
    text: '#f2f2f2',
    textMuted: '#bdbdbd',
    accent: '#f08a5d',
    accentStrong: '#ffa47e',
    border: '#2e2e2e',
    success: '#6cc59a',
    warning: '#e5b567',
    danger: '#f29a8e',
  },
  sunset: {
    dark: false,
    bg: '#fff8f1',
    surface: '#ffffff',
    text: '#3f332d',
    textMuted: '#6a5b51',
    accent: '#c45425',
    accentStrong: '#963b20',
    border: '#ead9cb',
    success: '#21734b',
    warning: '#8f5a17',
    danger: '#b8382f',
  },
  ink: {
    dark: true,
    bg: '#201a17',
    surface: '#302722',
    text: '#f5ede6',
    textMuted: '#d7c8bd',
    accent: '#f08a5d',
    accentStrong: '#ffa47e',
    border: '#49382f',
    success: '#6cc59a',
    warning: '#e5b567',
    danger: '#f29a8e',
  },
  graphite: {
    dark: true,
    bg: '#13161b',
    surface: '#20252d',
    text: '#f0f2f6',
    textMuted: '#c9cfd9',
    accent: '#7887f5',
    accentStrong: '#96a1ff',
    border: '#343b46',
    success: '#6cc59a',
    warning: '#e5b567',
    danger: '#f29a8e',
  },
  cream: {
    dark: false,
    bg: '#fffcf6',
    surface: '#ffffff',
    text: '#403126',
    textMuted: '#756456',
    accent: '#ab653e',
    accentStrong: '#945333',
    border: '#ede0d1',
    success: '#21734b',
    warning: '#8f5a17',
    danger: '#b8382f',
  },
  mist: {
    dark: false,
    bg: '#f5f8f9',
    surface: '#ffffff',
    text: '#20343d',
    textMuted: '#526871',
    accent: '#4f7182',
    accentStrong: '#3e5b69',
    border: '#d6e1e5',
    success: '#21734b',
    warning: '#8f5a17',
    danger: '#b8382f',
  },
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'light',
    nameKey: 'themes.light.name',
    descKey: 'themes.light.desc',
    swatch: ['#faf9f6', '#ffffff', '#211d19', '#9d3f29'],
  },
  {
    id: 'dark',
    nameKey: 'themes.dark.name',
    descKey: 'themes.dark.desc',
    swatch: ['#141414', '#1f1f1f', '#f2f2f2', '#f08a5d'],
  },
  {
    id: 'sunset',
    nameKey: 'themes.sunset.name',
    descKey: 'themes.sunset.desc',
    swatch: ['#fff8f1', '#ffffff', '#3f332d', '#c45425'],
  },
  {
    id: 'ink',
    nameKey: 'themes.ink.name',
    descKey: 'themes.ink.desc',
    swatch: ['#201a17', '#302722', '#f5ede6', '#f08a5d'],
  },
  {
    id: 'graphite',
    nameKey: 'themes.graphite.name',
    descKey: 'themes.graphite.desc',
    swatch: ['#13161b', '#20252d', '#f0f2f6', '#7887f5'],
  },
  {
    id: 'cream',
    nameKey: 'themes.cream.name',
    descKey: 'themes.cream.desc',
    swatch: ['#fffcf6', '#ffffff', '#403126', '#ab653e'],
  },
  {
    id: 'mist',
    nameKey: 'themes.mist.name',
    descKey: 'themes.mist.desc',
    swatch: ['#f5f8f9', '#ffffff', '#20343d', '#4f7182'],
  },
  {
    id: 'system',
    nameKey: 'themes.system.name',
    descKey: 'themes.system.desc',
    swatch: ['#faf9f6', '#141414', '#9d3f29', '#f08a5d'],
  },
]

const THEME_IDS: ThemeId[] = ['light', 'dark', 'sunset', 'ink', 'graphite', 'cream', 'mist']
const STORAGE_KEY = 'ateam.theme'

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.includes(value as ThemeId)
}

function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'system' || isThemeId(stored)) {
      return stored
    }
  } catch {
    /* ignore */
  }
  return 'light'
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ThemeId {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref
}

export function paletteFor(theme: ThemeId): ThemePalette {
  return PALETTES[theme]
}

interface ThemeContextValue {
  pref: ThemePref
  resolved: ThemeId
  setPref: (pref: ThemePref) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => readPref())
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const resolved = resolveTheme(pref, systemDark)

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (typeof matchMedia !== 'function') {
      return
    }
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolved
    root.dataset.themePref = pref
    root.style.colorScheme = paletteFor(resolved).dark ? 'dark' : 'light'
  }, [pref, resolved])

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider')
  }
  return value
}
