import { expect, test, type Locator, type Page } from '@playwright/test'

interface PageCase {
  name: string
  path: string
  testId: string
  ready: (page: Page) => Locator
}

const PAGES: PageCase[] = [
  {
    name: 'chat',
    path: '/',
    testId: 'chat-view',
    ready: (page) => page.getByText('Start a conversation')
  },
  {
    name: 'models',
    path: '/models',
    testId: 'models-page',
    ready: (page) => page.getByRole('region', { name: 'Acme' })
  },
  {
    name: 'usage',
    path: '/usage',
    testId: 'usage-page',
    ready: (page) => page.getByRole('heading', { name: 'Usage', level: 1 })
  },
  {
    name: 'settings',
    path: '/settings',
    testId: 'settings-page',
    ready: (page) => page.getByRole('heading', { name: 'Appearance', level: 1 })
  }
]

for (const pageCase of PAGES) {
  test(`${pageCase.name} page matches its screenshot`, async ({ page }) => {
    await page.goto(`/visual/index.html?page=${pageCase.name}`)
    await expect(page.getByTestId(pageCase.testId)).toBeVisible()
    await expect(pageCase.ready(page)).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    await expect(page).toHaveScreenshot(`${pageCase.name}.png`)
  })
}
