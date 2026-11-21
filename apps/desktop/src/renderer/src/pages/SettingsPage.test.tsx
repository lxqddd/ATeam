import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import AntdProvider from '../antd/AntdProvider'
import SettingsPage from './SettingsPage'

vi.mock('../components/settings/ThemeSettings', () => ({
  default: () => <div>appearance-panel</div>
}))
vi.mock('../components/settings/LanguageSettings', () => ({
  default: () => <div>language-panel</div>
}))

function renderPage(initialEntry = '/settings'): void {
  render(
    <AntdProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    </AntdProvider>
  )
}

describe('SettingsPage', () => {
  it('renders antd menu items and defaults to appearance', () => {
    renderPage()

    expect(screen.getByRole('menuitem', { name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Language' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Models' })).not.toBeInTheDocument()
    expect(screen.getByText('appearance-panel')).toBeInTheDocument()
  })

  it('switches sections from the menu', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('menuitem', { name: 'Language' }))

    expect(await screen.findByText('language-panel')).toBeInTheDocument()
  })

  it('honours the section query parameter', () => {
    renderPage('/settings?section=language')

    expect(screen.getByText('language-panel')).toBeInTheDocument()
  })

  it('falls back to appearance for the retired models section', () => {
    renderPage('/settings?section=models')

    expect(screen.getByText('appearance-panel')).toBeInTheDocument()
  })

  it('falls back to appearance for an unknown section', () => {
    renderPage('/settings?section=unknown')

    expect(screen.getByText('appearance-panel')).toBeInTheDocument()
  })
})
