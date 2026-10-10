import { test, expect } from '@playwright/test'
import {
  configuration,
  resetWorkspace,
  saveConfiguration,
  saveMissionFromUI,
} from './helpers'

test.beforeEach(async ({ request }) => resetWorkspace(request))

test('a new mission redirects and notifies only after the server confirms the save', async ({
  page,
  request,
}) => {
  await page.goto('/mission-builder')
  await page
    .getByLabel('Mission name', { exact: true })
    .fill('Confirmed notification mission')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  let release!: () => void, arrived!: () => void
  let id = ''
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const persisted = new Promise<void>((resolve) => {
    arrived = resolve
  })
  await page.route('**/api/v1/missions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    id = route.request().postDataJSON().id
    const response = await route.fetch()
    arrived()
    await held
    await route.fulfill({ response })
  })
  try {
    await page
      .getByRole('button', { name: 'Save mission', exact: true })
      .click()
    await persisted
    expect((await request.get(`/api/v1/missions/${id}`)).ok()).toBeTruthy()
    await expect(page).toHaveURL(new URL('/mission-builder', page.url()).href)
    await expect(page.locator('.cg-toast')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Saving…', exact: true }),
    ).toBeDisabled()
  } finally {
    release()
  }
  await expect(page).toHaveURL(new URL('/', page.url()).href)
  const toast = page.locator('.cg-toast')
  await expect(toast).toHaveText('mission saved successfully')
  await expect(toast).toHaveAttribute('role', 'status')
  await expect(
    page.getByRole('article', {
      name: 'Mission Confirmed notification mission',
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const bounds = await toast.boundingBox()
  expect(bounds?.y).toBe(16)
  await toast.getByRole('button', { name: 'Dismiss notification' }).click()
  await expect(toast).toHaveCount(0)
  await page.reload()
  await expect(toast).toHaveCount(0)
  expect(
    (await (await request.get(`/api/v1/missions/${id}`)).json()).name,
  ).toBe('Confirmed notification mission')
})

test('editing a saved mission shows the same notification on a narrow dashboard and it expires', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Edited notification'),
  )
  await page.setViewportSize({ width: 390, height: 900 })
  await page.clock.install()
  await page.goto(`/mission-builder/${mission.id}`)
  await page
    .getByLabel('Mission name', { exact: true })
    .fill('Updated notification mission')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const saved = await saveMissionFromUI(page)
  await expect(
    page.getByRole('heading', { name: 'Command dashboard', exact: true }),
  ).toBeInViewport()
  expect(saved.id).toBe(mission.id)
  expect(
    (await (await request.get(`/api/v1/missions/${mission.id}`)).json()).name,
  ).toBe('Updated notification mission')
  const bounds = await page.locator('.cg-toast').boundingBox()
  expect(bounds?.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({ path: 'test-results/save-notification-mobile.png' })
  await page.clock.fastForward(8100)
  await expect(page.locator('.cg-toast')).toHaveCount(0)
})

test('failed mission saves retain the draft without redirecting or showing a success notification', async ({
  page,
}) => {
  await page.goto('/mission-builder')
  await page
    .getByLabel('Mission name', { exact: true })
    .fill('Unsaved draft after failure')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  await page.route('**/api/v1/missions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({ status: 503, json: { detail: 'Save unavailable' } })
  })
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Save unavailable')
  await expect(page).toHaveURL(new URL('/mission-builder', page.url()).href)
  await expect(page.locator('.cg-toast')).toHaveCount(0)
  await expect(page.getByLabel('Mission name', { exact: true })).toHaveValue(
    'Unsaved draft after failure',
  )
})

test('validation failures never send a save or show success', async ({
  page,
}) => {
  await page.goto('/mission-builder')
  await page.getByLabel('Mission name', { exact: true }).fill('')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  let writes = 0
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith('/api/v1/missions')
    )
      writes++
  })
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Mission was not saved' }),
  ).toBeVisible()
  await expect(page).toHaveURL(new URL('/mission-builder', page.url()).href)
  await expect(page.locator('.cg-toast')).toHaveCount(0)
  expect(writes).toBe(0)
})
