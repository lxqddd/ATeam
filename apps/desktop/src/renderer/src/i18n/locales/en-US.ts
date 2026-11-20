import { APP_NAME } from '@ateam/shared'

type Translation = (typeof import('./zh-CN'))['default']

const enUS = {
  app: {
    name: APP_NAME,
    description: 'The Electron + React + TypeScript foundation is ready'
  },
  nav: {
    home: 'Home',
    settings: 'Settings'
  },
  settings: {
    title: 'Settings',
    appearance: 'Appearance',
    appearanceDescription: 'Choose a theme. Changes apply instantly.',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    language: 'Language',
    languageDescription: 'Choose the interface language. Changes apply instantly.',
    interfaceLanguage: 'Interface language',
    interfaceLanguageDescription:
      'System follows your operating system. Your choice is remembered.',
    languageSystem: 'System'
  }
} satisfies Translation

export default enUS
