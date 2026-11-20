import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ThemeSettings from './ThemeSettings'

const setThemePreference = vi.hoisted(() => vi.fn())
const themeState = vi.hoisted(() => ({
  preference: 'light' as string,
  resolvedTheme: 'light' as string
}))

vi.mock('../../theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../theme')>()
  return {
    ...actual,
    useTheme: () => ({ ...themeState, setThemePreference })
  }
})

beforeEach(() => {
  setThemePreference.mockClear()
  themeState.preference = 'light'
  themeState.resolvedTheme = 'light'
})

describe('ThemeSettings', () => {
  it('renders the seven theme cards with the current selection', () => {
    render(<ThemeSettings />)

    expect(screen.getAllByRole('radio')).toHaveLength(7)
    for (const name of ['Light', 'Dark', 'Sunset', 'Warm ink', 'Graphite', 'Cream', 'Cool mist']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByRole('radio', { name: /Light/ })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /System/ })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'System' })).not.toBeChecked()
  })

  it('switches the theme preference from the cards', async () => {
    const user = userEvent.setup()
    render(<ThemeSettings />)

    await user.click(screen.getByText('Sunset'))
    expect(setThemePreference).toHaveBeenCalledWith('sunset')

    await user.click(screen.getByText('Warm ink'))
    expect(setThemePreference).toHaveBeenCalledWith('ink')

    await user.click(screen.getByText('Dark'))
    expect(setThemePreference).toHaveBeenCalledWith('dark')
  })

  it('turns the system preference on', async () => {
    const user = userEvent.setup()
    render(<ThemeSettings />)

    await user.click(screen.getByRole('switch', { name: 'System' }))

    expect(setThemePreference).toHaveBeenCalledWith('system')
  })

  it('turns the system preference off by selecting the resolved theme', async () => {
    themeState.preference = 'system'
    themeState.resolvedTheme = 'graphite'
    const user = userEvent.setup()
    render(<ThemeSettings />)

    const toggle = screen.getByRole('switch', { name: 'System' })
    expect(toggle).toBeChecked()

    await user.click(toggle)

    expect(setThemePreference).toHaveBeenCalledWith('graphite')
  })
})
