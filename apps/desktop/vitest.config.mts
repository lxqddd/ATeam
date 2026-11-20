import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts']
        }
      },
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/src/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/src/test/setup.ts']
        }
      }
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/main/agent/errors.ts',
        'src/main/agent/message-history.ts',
        'src/main/agent/atomic-json.ts',
        'src/main/agent/sessions-store.ts',
        'src/main/agent/tools.ts',
        'src/main/agent/runtime.ts',
        'src/main/models/store.ts',
        'src/renderer/src/chat/store.ts',
        'src/renderer/src/hooks/useElapsed.ts',
        'src/renderer/src/components/chat/PermissionCard.tsx',
        'src/renderer/src/components/chat/Composer.tsx',
        'src/renderer/src/components/chat/SessionPanel.tsx',
        'src/renderer/src/components/chat/MessageList.tsx',
        'src/renderer/src/components/settings/ModelSettings.tsx',
        'src/renderer/src/antd/theme.ts',
        'src/renderer/src/antd/AntdProvider.tsx',
        'src/renderer/src/pages/SettingsPage.tsx',
        'src/renderer/src/components/settings/SettingsGroup.tsx',
        'src/renderer/src/components/settings/ThemeSettings.tsx',
        'src/renderer/src/components/settings/LanguageSettings.tsx',
        'src/renderer/src/components/settings/ProviderForm.tsx',
        'src/renderer/src/components/settings/ModelForm.tsx'
      ],
      exclude: ['**/*.test.{ts,tsx}', 'src/**/test/**']
    }
  }
})
