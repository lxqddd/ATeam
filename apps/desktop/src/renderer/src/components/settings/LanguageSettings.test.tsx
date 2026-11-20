import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import LanguageSettings from './LanguageSettings'

describe('LanguageSettings', () => {
  beforeEach(async () => {
    localStorage.clear()
    await act(async () => {
      await i18n.changeLanguage('en-US')
    })
  })

  it('renders system and supported languages', () => {
    render(<LanguageSettings />)

    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('中文')).toBeInTheDocument()
  })

  it('persists the selected language', async () => {
    const user = userEvent.setup()
    render(<LanguageSettings />)

    await user.click(screen.getByText('中文'))

    expect(localStorage.getItem('ateam.language')).toBe('zh-CN')
    expect(i18n.language).toBe('zh-CN')
  })
})
