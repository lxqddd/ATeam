import { createHashRouter, Navigate } from 'react-router'
import App from './App'
import ChatPage from './pages/ChatPage'
import ModelsPage from './pages/ModelsPage'
import SettingsPage from './pages/SettingsPage'
import UsagePage from './pages/UsagePage'

export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: 'models', element: <ModelsPage /> },
      { path: 'usage', element: <UsagePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
])
