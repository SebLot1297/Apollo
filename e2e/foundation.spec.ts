import { test, expect } from '@playwright/test'
test('foundation navigation and placeholders have no runtime errors', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Command dashboard' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Operation Aurora' }).first(),
  ).toBeVisible()
  await page.screenshot({
    path: 'artifacts/foundation-desktop.png',
    fullPage: true,
  })
  for (const [link, title] of [
    ['Mission Builder', 'Mission builder'],
    ['Mission Control', 'Mission control'],
    ['After-Action Reports', 'After-action reports'],
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
test('mobile navigation and screens fit within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.screenshot({
    path: 'artifacts/foundation-mobile.png',
    fullPage: true,
  })
  for (const [link, title] of [
    ['Mission Builder', 'Mission builder'],
    ['Mission Control', 'Mission control'],
    ['After-Action Reports', 'After-action reports'],
    ['Settings', 'Workspace settings'],
    ['Dashboard', 'Command dashboard'],
  ]) {
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page
      .getByRole('navigation')
      .getByRole('link', { name: link, exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
  }
})
