import { createHashRouter, Navigate } from 'react-router'
import App from './App'
import ChatPage from './pages/ChatPage'
import SettingsPage from './pages/SettingsPage'

export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
])
