import { lazy } from 'react'

// Pages other than the chat surface are opened on demand, so their component
// code (settings forms, tables, modals) is fetched the first time a route is
// visited. Keeping the lazy declarations in their own module lets the router
// file stay a pure route table.
export const LazyModelsPage = lazy(() => import('./ModelsPage'))
export const LazyUsagePage = lazy(() => import('./UsagePage'))
export const LazySettingsPage = lazy(() => import('./SettingsPage'))
