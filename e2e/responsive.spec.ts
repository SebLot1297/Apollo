import { test, expect } from '@playwright/test'
import {
  command,
  configuration,
  createRun,
  resetWorkspace,
  saveConfiguration,
  screenshot,
} from './helpers'
test.beforeEach(async ({ request }) => resetWorkspace(request))
for (const width of [1440, 390]) {
  test(`real data pages at ${width}px fit, support keyboard map selection, and have no runtime console errors`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const errors: string[] = [],
      consoleErrors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    const mission = await saveConfiguration(
        request,
        await configuration(request, `Responsive ${width}`),
      ),
      run = await createRun(request, mission)
    await command(request, run.run_id, 'start')
    await page.goto(`/mission-control/${run.run_id}`)
    await expect(page.getByTestId('communication_health')).toHaveText('100%')
    const marker = page
      .getByRole('group', { name: 'Fictional facility and support team map' })
      .getByRole('button')
      .first()
    await marker.focus()
    await page.keyboard.press('Enter')
    await expect(marker).toHaveAttribute('aria-pressed', 'true')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await screenshot(page, `frontend/screenshots/control-${width}.png`)
    for (const [link, title] of [
      ['Dashboard', 'Command dashboard'],
      ['Mission Builder', 'Mission builder'],
      ['Objectives', 'Objective designer'],
      ['Reports', 'After-action reports'],
      ['Settings', 'Workspace settings'],
    ]) {
      if (width === 390)
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
      if (link === 'Dashboard')
        await screenshot(page, `frontend/screenshots/dashboard-${width}.png`)
      if (link === 'Mission Builder')
        await screenshot(page, `frontend/screenshots/builder-${width}.png`)
    }
    await command(request, run.run_id, 'finish')
    await page.goto(`/reports/${run.run_id}`)
    await expect(page.getByTestId('numerical-summary')).toBeVisible()
    await page.getByText('Complete telemetry table', { exact: true }).click()
    await expect(
      page.getByRole('table').filter({ hasText: 'All confirmed samples' }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await screenshot(page, `frontend/screenshots/report-${width}.png`)
    expect(errors).toEqual([])
    expect(consoleErrors).toEqual([])
  })
}
test('confirmation dialog traps focus, Escape cancels, and restores focus to its trigger', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Focus dialog'),
  )
  await page.goto('/')
  const trigger = page
    .getByRole('article', { name: `Mission ${mission.name}`, exact: true })
    .getByRole('button', { name: 'Delete', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Delete mission?' })
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true)
  await page.keyboard.press('Tab')
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
})
test('server preferences persist and the default updates the unfinished run', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
      request,
      await configuration(request, 'Future speed'),
    ),
    old = await createRun(request, mission)
  await page.goto('/settings')
  const speed = page.getByLabel('Default simulation speed', { exact: false })
  await speed.fill('0')
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(speed).toHaveAttribute('aria-invalid', 'true')
  await speed.fill('2')
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByText('Preferences saved to the server.')).toBeVisible()
  await page.reload()
  await expect(speed).toHaveValue('2')
  expect(
    (await (await request.get(`/api/v1/simulations/${old.run_id}`)).json())
      .time_multiplier,
  ).toBe(2)
  expect(
    (await (await request.get('/api/v1/settings')).json()).simulation_speed,
  ).toBe(2)
  await expect(
    page.getByText('SQLite local-demo; no Timescale verification implied.'),
  ).toBeVisible()
})
