import { Suspense } from 'react'
import { createHashRouter, Navigate, type RouteObject } from 'react-router'
import App from './App'
import RouteFallback from './components/app/RouteFallback'
import { LazyModelsPage, LazySettingsPage, LazyUsagePage } from './pages/lazy-pages'
import ChatPage from './pages/ChatPage'

function lazyRoute(element: React.ReactNode): React.JSX.Element {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>
}

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: 'models', element: lazyRoute(<LazyModelsPage />) },
      { path: 'usage', element: lazyRoute(<LazyUsagePage />) },
      { path: 'settings', element: lazyRoute(<LazySettingsPage />) },
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
]

export const router = createHashRouter(routes)
