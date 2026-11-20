import { createRequire } from 'node:module'

// Electron 44+ no longer downloads its binary on install. The template's
// install-electron step does, so give it a China-friendly mirror by default.
// Override with ELECTRON_MIRROR when needed.
process.env.ELECTRON_MIRROR ??= 'https://npmmirror.com/mirrors/electron/'

createRequire(import.meta.url)('electron/install.js')
