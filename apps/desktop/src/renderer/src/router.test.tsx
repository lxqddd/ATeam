import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import AntdProvider from './antd/AntdProvider'
import { routes } from './router'
import { createApiMock, type ApiMock } from './test/api-mock'

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock()
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

function renderRoute(path: string): void {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AntdProvider>
      <RouterProvider router={router} />
    </AntdProvider>
  )
}

describe('router', () => {
  it('keeps the chat page in the initial route', async () => {
    renderRoute('/')
    expect(await screen.findByTestId('chat-view')).toBeInTheDocument()
  })

  it.each([
    ['/models', 'models-page'],
    ['/usage', 'usage-page'],
    ['/settings', 'settings-page']
  ])('renders %s after its lazy chunk resolves', async (path, testId) => {
    renderRoute(path)
    expect(await screen.findByTestId(testId, undefined, { timeout: 10000 })).toBeInTheDocument()
  })

  it('redirects unknown routes to the chat page', async () => {
    renderRoute('/does-not-exist')
    expect(await screen.findByTestId('chat-view')).toBeInTheDocument()
  })
})
