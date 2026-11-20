import { createHashRouter, Navigate } from 'react-router'
import App from './App'
import HomePage from './pages/HomePage'
import SettingsPage from './pages/SettingsPage'

export const router = createHashRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
])
