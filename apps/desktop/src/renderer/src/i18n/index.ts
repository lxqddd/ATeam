import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'

const LANGUAGE_STORAGE_KEY = 'ateam.language'

export const supportedLanguages = [
  { code: 'zh-CN', label: '中文' },
  { code: 'en-US', label: 'English' }
] as const

export type SupportedLanguage = (typeof supportedLanguages)[number]['code']
export type LanguagePreference = 'system' | SupportedLanguage

const FALLBACK_LANGUAGE: SupportedLanguage = 'en-US'

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return supportedLanguages.some((language) => language.code === value)
}

function getSystemLanguage(): SupportedLanguage {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : FALLBACK_LANGUAGE
}

function resolveLanguage(preference: LanguagePreference): SupportedLanguage {
  return preference === 'system' ? getSystemLanguage() : preference
}

export function getLanguagePreference(): LanguagePreference {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (stored === 'system' || (stored !== null && isSupportedLanguage(stored))) {
      return stored
    }
  } catch {
    // Ignore storage failures and fall back to the system language.
  }

  return 'system'
}

function syncDocumentLanguage(language: string): void {
  document.documentElement.lang = language
}

export function setLanguagePreference(preference: LanguagePreference): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, preference)
  } catch {
    // Ignore storage failures; the language still changes for this session.
  }

  const language = resolveLanguage(preference)
  if (i18n.language === language) {
    syncDocumentLanguage(language)
  } else {
    void i18n.changeLanguage(language)
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS }
  },
  lng: resolveLanguage(getLanguagePreference()),
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    escapeValue: false
  },
  initAsync: false,
  react: {
    useSuspense: false
  }
})

i18n.on('languageChanged', syncDocumentLanguage)
syncDocumentLanguage(i18n.language)

export default i18n
