import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: 'pages.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.001
    }
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'pnpm exec vite --config visual/vite.config.mts --port 4173 --strictPort',
    cwd: resolve(import.meta.dirname, '..'),
    url: 'http://127.0.0.1:4173/visual/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
})
