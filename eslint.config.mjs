import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

const rendererFiles = ['apps/desktop/src/renderer/**/*.{ts,tsx}']

export default defineConfig(
  {
    ignores: ['**/node_modules', '**/dist', '**/out', '**/release', '**/coverage', '**/.pnpm-store']
  },
  tseslint.configs.recommended,
  {
    files: rendererFiles,
    plugins: {
      react: eslintPluginReact,
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      ...eslintPluginReact.configs.flat.recommended.rules,
      ...eslintPluginReact.configs.flat['jsx-runtime'].rules,
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    files: ['packages/agent-core/**/*.ts', 'apps/headless/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'electron/*', '@electron-toolkit/*'],
              message: 'Agent core and headless modes must not depend on Electron.'
            },
            {
              group: ['@ateam/desktop', '**/apps/desktop/**'],
              message: 'Agent core and headless modes must not import the desktop app.'
            }
          ]
        }
      ]
    }
  },
  {
    files: rendererFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ateam/agent-core', '@ateam/agent-core/*'],
              message: 'Renderer code must use window.api instead of the agent core.'
            },
            {
              group: ['**/src/main/**', '**/main/**'],
              message: 'Renderer code must not import main-process modules.'
            },
            {
              group: ['electron', 'electron/*'],
              message: 'Renderer code must not import Electron directly.'
            }
          ]
        }
      ]
    }
  },
  eslintConfigPrettier
)
