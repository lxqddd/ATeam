import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'

const LANGUAGE_STORAGE_KEY = 'ateam.language'
const FALLBACK_LANGUAGE = 'en-US'

export const supportedLanguages = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en-US', label: 'English' }
] as const

export type SupportedLanguage = (typeof supportedLanguages)[number]['code']

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return supportedLanguages.some((language) => language.code === value)
}

function resolveInitialLanguage(): SupportedLanguage {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)

  if (stored !== null && isSupportedLanguage(stored)) {
    return stored
  }

  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : FALLBACK_LANGUAGE
}

function syncLanguage(language: string): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  document.documentElement.lang = language
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS }
  },
  lng: resolveInitialLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    escapeValue: false
  },
  initAsync: false,
  react: {
    useSuspense: false
  }
})

i18n.on('languageChanged', syncLanguage)
syncLanguage(i18n.language)

export default i18n
