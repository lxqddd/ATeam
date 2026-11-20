import { useEffect, useMemo, useState } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import i18n from '../i18n'
import { useTheme } from '../theme'
import { createAntdTheme } from './theme'

export function AntdProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const [language, setLanguage] = useState(i18n.language)

  useEffect(() => {
    const handleLanguageChanged = (): void => {
      setLanguage(i18n.language)
    }
    i18n.on('languageChanged', handleLanguageChanged)
    return () => {
      i18n.off('languageChanged', handleLanguageChanged)
    }
  }, [])

  const themeConfig = useMemo(() => createAntdTheme(resolvedTheme), [resolvedTheme])
  const locale = language.toLowerCase().startsWith('zh') ? zhCN : enUS

  return (
    <ConfigProvider theme={themeConfig} locale={locale}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  )
}

export default AntdProvider
