import { theme as antdTheme } from 'antd'
import type { ThemeConfig } from 'antd'
import type { ResolvedTheme } from '../theme'

interface Palette {
  accent: string
  accentHover: string
  accentStrong: string
  accentSoft: string
  backgroundSubtle: string
  surface: string
  surfaceRaised: string
  foreground: string
  muted: string
  subtle: string
  border: string
  borderSubtle: string
  hover: string
  active: string
  selected: string
  selectedForeground: string
  success: string
  warning: string
  danger: string
  fontSans: string
}

const FALLBACK: Record<ResolvedTheme, Palette> = {
  light: {
    accent: '#9d3f29',
    accentHover: '#85331f',
    accentStrong: '#9d3f29',
    accentSoft: 'rgb(157 63 41 / 0.1)',
    backgroundSubtle: '#f2f0eb',
    surface: '#ffffff',
    surfaceRaised: '#ffffff',
    foreground: '#211d19',
    muted: '#625951',
    subtle: '#685e55',
    border: '#e5e0d7',
    borderSubtle: '#efebe4',
    hover: '#f2eee6',
    active: '#e8e2d6',
    selected: '#f2dcd1',
    selectedForeground: '#9d3f29',
    success: '#24684c',
    warning: '#7c4a00',
    danger: '#a33130',
    fontSans:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, 'Noto Sans SC', 'Noto Sans CJK SC', 'Source Han Sans SC', Roboto, Ubuntu, 'Helvetica Neue', Arial, sans-serif"
  },
  dark: {
    accent: '#f08a5d',
    accentHover: '#ffa47e',
    accentStrong: '#ffa47e',
    accentSoft: 'rgb(240 138 93 / 0.14)',
    backgroundSubtle: '#1a1a1a',
    surface: '#1f1f1f',
    surfaceRaised: '#262626',
    foreground: '#f2f2f2',
    muted: '#bdbdbd',
    subtle: '#9e9e9e',
    border: '#2e2e2e',
    borderSubtle: '#262626',
    hover: '#262626',
    active: '#303030',
    selected: '#2e2e2e',
    selectedForeground: '#ffffff',
    success: '#6cc59a',
    warning: '#e5b567',
    danger: '#f29a8e',
    fontSans: "'JetBrains Mono', 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace"
  }
}

export function readCssVar(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function createAntdTheme(
  resolved: ResolvedTheme,
  read: (name: string) => string = readCssVar
): ThemeConfig {
  const palette = FALLBACK[resolved]
  const pick = (variable: string, fallback: string): string => read(variable) || fallback

  return {
    cssVar: {},
    algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: pick('--accent', palette.accent),
      colorPrimaryHover: pick('--accent-hover', palette.accentHover),
      colorPrimaryActive: pick('--accent-strong', palette.accentStrong),
      colorPrimaryBg: pick('--accent-soft', palette.accentSoft),
      colorBgBase: pick('--background', palette.backgroundSubtle),
      colorBgLayout: pick('--background-subtle', palette.backgroundSubtle),
      colorBgContainer: pick('--surface', palette.surface),
      colorBgElevated: pick('--surface-raised', palette.surfaceRaised),
      colorText: pick('--foreground', palette.foreground),
      colorTextSecondary: pick('--muted', palette.muted),
      colorTextTertiary: pick('--subtle', palette.subtle),
      colorBorder: pick('--border', palette.border),
      colorBorderSecondary: pick('--border-subtle', palette.borderSubtle),
      colorFillSecondary: pick('--hover', palette.hover),
      colorFillTertiary: pick('--active', palette.active),
      colorSuccess: pick('--success', palette.success),
      colorWarning: pick('--warning', palette.warning),
      colorError: pick('--danger', palette.danger),
      borderRadius: 10,
      borderRadiusSM: 8,
      borderRadiusLG: 14,
      fontFamily: pick('--font-sans', palette.fontSans),
      fontSize: 14,
      controlHeight: 32,
      controlHeightSM: 28
    },
    components: {
      Menu: {
        itemSelectedBg: pick('--selected', palette.selected),
        itemSelectedColor: pick('--selected-foreground', palette.selectedForeground),
        itemHoverBg: pick('--hover', palette.hover)
      },
      Card: {
        headerBg: 'transparent'
      },
      Button: {
        defaultBg: pick('--surface', palette.surface),
        defaultBorderColor: pick('--border', palette.border)
      }
    }
  }
}
