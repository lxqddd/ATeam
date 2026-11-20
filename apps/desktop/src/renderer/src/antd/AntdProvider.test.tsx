import { act, render, screen } from '@testing-library/react'
import { Popconfirm } from 'antd'
import i18n from '../i18n'
import { describe, expect, it } from 'vitest'
import AntdProvider from './AntdProvider'

describe('AntdProvider', () => {
  it('renders children and follows the interface language', async () => {
    render(
      <AntdProvider>
        <Popconfirm open title="Delete?" onConfirm={() => undefined}>
          <button type="button">trigger</button>
        </Popconfirm>
      </AntdProvider>
    )

    expect(await screen.findByRole('button', { name: 'OK' })).toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage('zh-CN')
    })

    expect(await screen.findByRole('button', { name: /确\s*定/ })).toBeInTheDocument()
  })
})
