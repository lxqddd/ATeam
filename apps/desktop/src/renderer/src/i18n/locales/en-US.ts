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
    description: 'Settings placeholder for models, tools, and permissions.'
  },
  common: {
    language: 'Language'
  }
} satisfies Translation

export default enUS
