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
  eslintConfigPrettier
)
