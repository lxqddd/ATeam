import { createI18n } from 'vue-i18n'
import enUS from './locales/en-US'
import zhCN from './locales/zh-CN'

export type AppLocale = 'en-US' | 'zh-CN'

const STORAGE_KEY = 'ateam.locale'

// 语言解析顺序（NFR-I18N-003）：用户显式选择 > 系统语言（zh* → zh-CN）> en-US
function resolveInitialLocale(): AppLocale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en-US' || stored === 'zh-CN') {
    return stored
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: resolveInitialLocale(),
  fallbackLocale: 'en-US',
  missingWarn: true,
  fallbackWarn: true,
  messages: {
    'en-US': enUS,
    'zh-CN': zhCN,
  },
  datetimeFormats: {
    'en-US': {
      long: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
    },
    'zh-CN': {
      long: {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      },
    },
  },
})

// 应用语言切换：更新 vue-i18n、持久化、同步 <html lang>（NFR-I18N-002）。
// Element Plus 的 locale 由 App.vue 的 el-config-provider 响应式跟随，无需在此处理。
export function setAppLocale(locale: AppLocale) {
  i18n.global.locale.value = locale
  localStorage.setItem(STORAGE_KEY, locale)
  document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en'
}

// 启动时按解析结果同步 <html lang>（index.html 静态默认为 en）
document.documentElement.lang = i18n.global.locale.value === 'zh-CN' ? 'zh-CN' : 'en'

export default i18n
