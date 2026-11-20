import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ThemeSettings from './ThemeSettings'

const setThemePreference = vi.hoisted(() => vi.fn())

vi.mock('../../theme', () => ({
  useTheme: () => ({ preference: 'light', resolvedTheme: 'light', setThemePreference })
}))

describe('ThemeSettings', () => {
  it('renders the three options with the current selection', () => {
    render(<ThemeSettings />)

    expect(screen.getByText('Light')).toBeInTheDocument()
    expect(screen.getByText('Dark')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Light/ })).toBeChecked()
  })

  it('switches the theme preference', async () => {
    const user = userEvent.setup()
    render(<ThemeSettings />)

    await user.click(screen.getByText('Dark'))

    expect(setThemePreference).toHaveBeenCalledWith('dark')
  })
})
