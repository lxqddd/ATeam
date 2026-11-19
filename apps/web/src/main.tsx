import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntApp, ConfigProvider, theme as antdTheme } from 'antd'
import antdEnUS from 'antd/locale/en_US'
import antdZhCN from 'antd/locale/zh_CN'
import { useTranslation } from 'react-i18next'
import 'antd/dist/reset.css'
import './index.css'
import './i18n'
import { App } from './App'
import { ThemeProvider, paletteFor, useTheme } from './theme'

const root = document.getElementById('root')
if (!root) {
  throw new Error('root element not found')
}

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", system-ui, "Noto Sans SC", sans-serif'

function Root() {
  const { resolved } = useTheme()
  const { i18n } = useTranslation()
  const palette = paletteFor(resolved)
  const antdLocale = i18n.language === 'zh-CN' ? antdZhCN : antdEnUS

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        algorithm: palette.dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: palette.accent,
          colorInfo: palette.accent,
          colorLink: palette.accentStrong,
          colorBgBase: palette.bg,
          colorBgContainer: palette.surface,
          colorBgElevated: palette.surface,
          colorTextBase: palette.text,
          colorTextSecondary: palette.textMuted,
          colorBorder: palette.border,
          colorBorderSecondary: palette.border,
          colorSuccess: palette.success,
          colorWarning: palette.warning,
          colorError: palette.danger,
          borderRadius: 10,
          controlHeight: 32,
          fontFamily,
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  )
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </StrictMode>,
)
