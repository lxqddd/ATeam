import type { AteamApi } from '@ateam/shared'

declare global {
  interface Window {
    api: AteamApi
  }
}

export {}
