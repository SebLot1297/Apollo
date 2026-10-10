import { test, expect } from '@playwright/test'
import { resetWorkspace } from './helpers'
test.beforeEach(async ({ request }) => resetWorkspace(request))
test('connected navigation has real data and no runtime errors', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Command dashboard' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('heading', {
        name: 'Operation Signal Restore',
        exact: true,
      })
      .first(),
  ).toBeVisible()
  await expect(page.getByText('Operation Aurora')).toHaveCount(0)
  for (const [link, title] of [
    ['Mission Builder', 'Mission builder'],
    ['Objectives', 'Objective designer'],
    ['Mission Control', 'Mission control'],
    ['Reports', 'After-action reports'],
    ['Settings', 'Workspace settings'],
    ['Dashboard', 'Command dashboard'],
  ]) {
    await page
      .getByRole('navigation')
      .getByRole('link', { name: link, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible()
  }
  await page.goto('/unknown')
  await expect(
    page.getByRole('heading', { name: 'Page not found' }),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Return to dashboard' }).click()
  expect(errors).toEqual([])
})
