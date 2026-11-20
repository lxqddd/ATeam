import { theme as antdTheme } from 'antd'
import type { ThemeConfig } from 'antd'
import type { ResolvedTheme } from '../theme'

interface Palette {
  background: string
  backgroundSubtle: string
  surface: string
  surfaceRaised: string
  foreground: string
  muted: string
  subtle: string
  border: string
  borderSubtle: string
  borderStrong: string
  accent: string
  accentHover: string
  accentPressed: string
  accentStrong: string
  accentSoft: string
  accentForeground: string
  accent2: string
  accent3: string
  hover: string
  active: string
  selected: string
  selectedForeground: string
  navBg: string
  navPressed: string
  inputBg: string
  btnSecondaryBg: string
  btnSecondaryBorder: string
  btnSecondaryText: string
  disabledBg: string
  disabledText: string
  success: string
  successSoft: string
  successBorder: string
  warning: string
  warningSoft: string
  warningBorder: string
  danger: string
  dangerSoft: string
  dangerBorder: string
  dangerFill: string
  textOnDanger: string
  info: string
  infoSoft: string
  infoBorder: string
  neutral: string
  neutralSoft: string
  neutralBorder: string
  shadowSm: string
  fontSans: string
}

const FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', system-ui, 'Noto Sans SC', 'Noto Sans CJK SC', 'Source Han Sans SC', Roboto, Ubuntu, 'Helvetica Neue', Arial, sans-serif"

const FALLBACK: Record<ResolvedTheme, Palette> = {
  light: {
    background: '#faf9f6',
    backgroundSubtle: '#f2f0eb',
    surface: '#ffffff',
    surfaceRaised: '#ffffff',
    foreground: '#211d19',
    muted: '#625951',
    subtle: '#685e55',
    border: '#e5e0d7',
    borderSubtle: '#efebe4',
    borderStrong: '#93867a',
    accent: '#9d3f29',
    accentHover: '#85331f',
    accentPressed: '#6e2a19',
    accentStrong: '#9d3f29',
    accentSoft: 'rgb(157 63 41 / 0.1)',
    accentForeground: '#ffffff',
    accent2: '#c97d62',
    accent3: '#e0b9a6',
    hover: '#f2eee6',
    active: '#e8e2d6',
    selected: '#f2dcd1',
    selectedForeground: '#9d3f29',
    navBg: 'color-mix(in srgb, #f2eee6, #f2dcd1)',
    navPressed: 'color-mix(in srgb, #f2dcd1 70%, #f2eee6)',
    inputBg: '#ffffff',
    btnSecondaryBg: '#ffffff',
    btnSecondaryBorder: '#e5e0d7',
    btnSecondaryText: '#211d19',
    disabledBg: '#edeae3',
    disabledText: '#93867a',
    success: '#24684c',
    successSoft: '#e6f1ea',
    successBorder: '#bcdcca',
    warning: '#7c4a00',
    warningSoft: '#f8edd5',
    warningBorder: '#ecd49f',
    danger: '#a33130',
    dangerSoft: '#fae9e7',
    dangerBorder: '#eec0bb',
    dangerFill: '#a33130',
    textOnDanger: '#ffffff',
    info: '#2d5893',
    infoSoft: '#e7eef9',
    infoBorder: '#c2d4ec',
    neutral: '#625951',
    neutralSoft: '#f2f0eb',
    neutralBorder: '#e5e0d7',
    shadowSm: '0 1px 2px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.02)',
    fontSans: FONT_SANS
  },
  dark: {
    background: '#141414',
    backgroundSubtle: '#1a1a1a',
    surface: '#1f1f1f',
    surfaceRaised: '#262626',
    foreground: '#f2f2f2',
    muted: '#bdbdbd',
    subtle: '#9e9e9e',
    border: '#2e2e2e',
    borderSubtle: '#262626',
    borderStrong: '#404040',
    accent: '#f08a5d',
    accentHover: '#ffa47e',
    accentPressed: '#d96f45',
    accentStrong: '#ffa47e',
    accentSoft: 'rgb(240 138 93 / 0.14)',
    accentForeground: '#241711',
    accent2: '#ffa47e',
    accent3: '#ffc0a3',
    hover: '#262626',
    active: '#303030',
    selected: '#2e2e2e',
    selectedForeground: '#ffffff',
    navBg: 'color-mix(in srgb, #262626, #2e2e2e)',
    navPressed: 'color-mix(in srgb, #2e2e2e 70%, #262626)',
    inputBg: '#1a1a1a',
    btnSecondaryBg: '#1f1f1f',
    btnSecondaryBorder: '#333333',
    btnSecondaryText: '#e6e6e6',
    disabledBg: '#262626',
    disabledText: '#6b6b6b',
    success: '#6cc59a',
    successSoft: 'rgba(108, 197, 154, 0.14)',
    successBorder: 'rgba(108, 197, 154, 0.36)',
    warning: '#e5b567',
    warningSoft: 'rgba(229, 181, 103, 0.14)',
    warningBorder: 'rgba(229, 181, 103, 0.36)',
    danger: '#f29a8e',
    dangerSoft: 'rgba(242, 154, 142, 0.14)',
    dangerBorder: 'rgba(242, 154, 142, 0.36)',
    dangerFill: '#b9382f',
    textOnDanger: '#ffffff',
    info: '#94bfd3',
    infoSoft: 'rgba(148, 191, 211, 0.14)',
    infoBorder: 'rgba(148, 191, 211, 0.36)',
    neutral: '#a6a6a6',
    neutralSoft: '#262626',
    neutralBorder: '#3a3a3a',
    shadowSm: '0 1px 2px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(242, 242, 242, 0.03)',
    fontSans: FONT_SANS
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

  const controlTokens = {
    controlHeight: 32,
    colorBgContainer: pick('--input-bg', palette.inputBg),
    hoverBorderColor: pick('--border-strong', palette.borderStrong),
    activeBorderColor: pick('--accent-strong', palette.accentStrong),
    activeShadow: '0 0 0 2px var(--accent-soft)',
    borderRadius: 10,
    fontSize: 13
  }

  return {
    cssVar: {},
    algorithm: resolved === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: pick('--accent', palette.accent),
      colorPrimaryHover: pick('--accent-hover', palette.accentHover),
      colorPrimaryActive: pick('--accent-pressed', palette.accentPressed),
      colorPrimaryBg: pick('--accent-soft', palette.accentSoft),
      colorLink: pick('--accent-strong', palette.accentStrong),
      colorError: pick('--danger', palette.danger),
      colorWarning: pick('--warning', palette.warning),
      colorSuccess: pick('--success', palette.success),
      colorInfo: pick('--info', palette.info),
      colorBgBase: pick('--background', palette.background),
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
      controlHeight: 32,
      controlHeightSM: 28,
      controlHeightLG: 40,
      borderRadius: 10,
      borderRadiusSM: 8,
      borderRadiusLG: 14,
      fontSize: 14,
      fontSizeSM: 13,
      fontSizeLG: 16,
      fontSizeHeading5: 14,
      fontFamily: pick('--font-sans', palette.fontSans),
      boxShadow: pick('--shadow-sm', palette.shadowSm)
    },
    components: {
      Menu: {
        itemHeight: 32,
        itemBorderRadius: 10,
        itemMarginInline: 0,
        itemMarginBlock: 0,
        itemPaddingInline: 8,
        itemBg: 'transparent',
        itemColor: pick('--muted', palette.muted),
        itemHoverBg: pick('--nav-bg', palette.navBg),
        itemHoverColor: pick('--foreground', palette.foreground),
        itemSelectedBg: pick('--nav-bg', palette.navBg),
        itemSelectedColor: pick('--foreground', palette.foreground),
        itemActiveBg: pick('--nav-pressed', palette.navPressed),
        activeBarBorderWidth: 0,
        fontSize: 13,
        iconSize: 16
      },
      Card: {
        headerBg: 'transparent'
      },
      Button: {
        controlHeight: 32,
        controlHeightSM: 26,
        controlHeightLG: 40,
        paddingInline: 12,
        paddingInlineSM: 8,
        contentFontSize: 13,
        contentFontSizeSM: 12,
        fontWeight: 500,
        defaultBg: pick('--btn-secondary-bg', palette.btnSecondaryBg),
        defaultBorderColor: pick('--btn-secondary-border', palette.btnSecondaryBorder),
        defaultColor: pick('--btn-secondary-text', palette.btnSecondaryText),
        defaultHoverBg: pick('--hover', palette.hover),
        defaultHoverBorderColor: pick('--border-strong', palette.borderStrong),
        defaultHoverColor: pick('--foreground', palette.foreground),
        defaultActiveBg: pick('--active', palette.active),
        primaryColor: pick('--accent-foreground', palette.accentForeground),
        defaultShadow: 'none',
        primaryShadow: 'none',
        defaultGhostColor: pick('--muted', palette.muted),
        ghostBg: 'transparent',
        defaultGhostBorderColor: 'transparent',
        textTextColor: pick('--muted', palette.muted),
        textTextHoverColor: pick('--foreground', palette.foreground),
        textTextActiveColor: pick('--foreground', palette.foreground),
        textHoverBg: pick('--hover', palette.hover)
      },
      Input: {
        ...controlTokens,
        paddingInline: 12
      },
      InputNumber: {
        ...controlTokens,
        paddingInline: 12
      },
      Select: {
        ...controlTokens,
        optionFontSize: 13,
        selectorBg: pick('--input-bg', palette.inputBg)
      },
      Form: {
        labelFontSize: 13,
        labelColor: pick('--foreground', palette.foreground),
        itemMarginBottom: 12,
        verticalLabelPadding: '0 0 4px'
      },
      Segmented: {
        trackBg: pick('--background-subtle', palette.backgroundSubtle),
        trackPadding: 2,
        controlHeight: 32,
        itemColor: pick('--muted', palette.muted),
        itemHoverBg: pick('--hover', palette.hover),
        itemHoverColor: pick('--foreground', palette.foreground),
        itemSelectedBg: pick('--surface', palette.surface),
        itemSelectedColor: pick('--foreground', palette.foreground),
        borderRadius: 10,
        borderRadiusSM: 8
      },
      Alert: {
        defaultPadding: '6px 12px',
        fontSize: 13,
        borderRadiusLG: 10,
        colorSuccessBg: pick('--success-soft', palette.successSoft),
        colorSuccessBorder: pick('--success-border', palette.successBorder),
        colorWarningBg: pick('--warning-soft', palette.warningSoft),
        colorWarningBorder: pick('--warning-border', palette.warningBorder),
        colorErrorBg: pick('--danger-soft', palette.dangerSoft),
        colorErrorBorder: pick('--danger-border', palette.dangerBorder),
        colorInfoBg: pick('--info-soft', palette.infoSoft),
        colorInfoBorder: pick('--info-border', palette.infoBorder)
      },
      List: {
        itemPadding: '8px 0',
        headerBg: 'transparent',
        colorTextDisabled: pick('--subtle', palette.subtle)
      },
      Tag: {
        defaultBg: pick('--neutral-soft', palette.neutralSoft),
        defaultColor: pick('--muted', palette.muted),
        borderRadiusSM: 9999,
        fontSizeSM: 12,
        colorSuccessBg: pick('--success-soft', palette.successSoft),
        colorSuccessBorder: pick('--success-border', palette.successBorder),
        colorWarningBg: pick('--warning-soft', palette.warningSoft),
        colorWarningBorder: pick('--warning-border', palette.warningBorder),
        colorErrorBg: pick('--danger-soft', palette.dangerSoft),
        colorErrorBorder: pick('--danger-border', palette.dangerBorder),
        colorInfoBg: pick('--info-soft', palette.infoSoft),
        colorInfoBorder: pick('--info-border', palette.infoBorder)
      }
    }
  }
}
