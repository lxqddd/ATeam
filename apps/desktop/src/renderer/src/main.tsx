import './i18n'
import './assets/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import AntdProvider from './antd/AntdProvider'
import { router } from './router'
import { initTheme } from './theme'

if ('api' in window) {
  document.documentElement.dataset.platform = window.api.platform
}

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AntdProvider>
      <RouterProvider router={router} />
    </AntdProvider>
  </StrictMode>
)
