import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'

export type AppLanguage = 'zh-CN' | 'en-US'

export const LANGUAGES: { id: AppLanguage; labelKey: string }[] = [
  { id: 'zh-CN', labelKey: 'settings.language.zh' },
  { id: 'en-US', labelKey: 'settings.language.en' },
]

const STORAGE_KEY = 'ateam.language'

function detectLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'zh-CN' || stored === 'en-US') {
      return stored
    }
  } catch {
    /* ignore */
  }
  const preferred =
    typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language : 'en-US'
  return preferred.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
    },
    lng: detectLanguage(),
    fallbackLng: 'en-US',
    supportedLngs: ['zh-CN', 'en-US'],
    load: 'currentOnly',
    interpolation: { escapeValue: false },
    initAsync: false,
    react: { useSuspense: false },
  })
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US'
}

export function currentLanguage(): AppLanguage {
  return i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US'
}

export function setLanguage(language: AppLanguage): void {
  void i18n.changeLanguage(language)
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language
  }
}

export default i18n
