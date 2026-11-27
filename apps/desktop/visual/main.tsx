import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ModelsConfigPublic } from '@ateam/shared'
import AntdProvider from '@renderer/antd/AntdProvider'
import i18n from '@renderer/i18n'
import { routes } from '@renderer/router'
import { createApiMock } from '@renderer/test/api-mock'
import { initTheme } from '@renderer/theme'
import './visual.css'

// Fixed data for screenshot regression: one provider, one model, no sessions.
const MODELS: ModelsConfigPublic = {
  providers: [
    {
      id: 'visual-provider',
      name: 'Acme',
      type: 'anthropic',
      hasApiKey: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ],
  models: [
    {
      id: 'visual-model',
      providerId: 'visual-provider',
      modelId: 'claude-sonnet-5',
      name: 'Sonnet',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ],
  defaultModel: { providerId: 'visual-provider', modelId: 'claude-sonnet-5' }
}

const mock = createApiMock({ models: MODELS })
Object.defineProperty(window, 'api', { value: mock.api, configurable: true })

localStorage.setItem('ateam.theme', 'light')
localStorage.setItem('ateam.language', 'en-US')
document.documentElement.dataset.platform = mock.api.platform
await i18n.changeLanguage('en-US')
initTheme()

const PATHS: Record<string, string> = {
  chat: '/',
  models: '/models',
  usage: '/usage',
  settings: '/settings'
}
const requested = new URLSearchParams(window.location.search).get('page') ?? 'chat'
const router = createMemoryRouter(routes, { initialEntries: [PATHS[requested] ?? '/'] })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AntdProvider>
      <RouterProvider router={router} />
    </AntdProvider>
  </StrictMode>
)
