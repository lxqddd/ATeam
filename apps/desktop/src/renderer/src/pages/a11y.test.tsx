import type { ModelsConfigPublic } from '@ateam/shared'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import AntdProvider from '../antd/AntdProvider'
import { routes } from '../router'
import { createApiMock, type ApiMock } from '../test/api-mock'
import { findBlockingA11yViolations, formatA11yViolations } from '../test/a11y'

const MODELS: ModelsConfigPublic = {
  providers: [
    {
      id: 'a11y-provider',
      name: 'Acme',
      type: 'anthropic',
      hasApiKey: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ],
  models: [
    {
      id: 'a11y-model',
      providerId: 'a11y-provider',
      modelId: 'claude-sonnet-5',
      name: 'Sonnet',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  ],
  defaultModel: { providerId: 'a11y-provider', modelId: 'claude-sonnet-5' }
}

interface PageCase {
  name: string
  path: string
  waitReady: () => Promise<unknown>
}

const PAGES: PageCase[] = [
  { name: 'chat', path: '/', waitReady: () => screen.findByText('Start a conversation') },
  {
    name: 'models',
    path: '/models',
    waitReady: () => screen.findByRole('region', { name: 'Acme' }, { timeout: 10_000 })
  },
  {
    name: 'usage',
    path: '/usage',
    waitReady: () => screen.findByRole('heading', { name: 'Usage', level: 1 }, { timeout: 10_000 })
  },
  {
    name: 'settings',
    path: '/settings',
    waitReady: () =>
      screen.findByRole('heading', { name: 'Appearance', level: 1 }, { timeout: 10_000 })
  }
]

let mock: ApiMock

beforeEach(() => {
  mock = createApiMock({ models: MODELS })
  Object.defineProperty(window, 'api', { value: mock.api, configurable: true })
})

describe.each(PAGES)('accessibility: $name page', ({ path, waitReady }) => {
  it('has no blocking axe violations', async () => {
    const router = createMemoryRouter(routes, { initialEntries: [path] })
    render(
      <AntdProvider>
        <RouterProvider router={router} />
      </AntdProvider>
    )
    await waitReady()

    const violations = await findBlockingA11yViolations()
    expect(violations, formatA11yViolations(violations)).toEqual([])
  })
})

describe('accessibility: harness self-check', () => {
  it('reports serious violations so the page checks cannot pass vacuously', async () => {
    const image = document.createElement('img')
    image.src = '/missing-alt.png'
    document.body.append(image)

    const violations = await findBlockingA11yViolations()
    expect(violations.map((violation) => violation.id)).toContain('image-alt')
    image.remove()
  })
})
