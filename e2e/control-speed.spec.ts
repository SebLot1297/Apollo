import { test, expect } from '@playwright/test'
import {
  command,
  configuration,
  createRun,
  resetWorkspace,
  saveConfiguration,
} from './helpers'

test.beforeEach(async ({ request }) => resetWorkspace(request))

test('Mission Control changes and persists speed before start, while running, and while paused', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Control speed'),
  )
  const run = await createRun(request, mission)
  await page.goto(`/mission-control/${run.run_id}`)
  const speed = page.getByRole('spinbutton', {
    name: 'Run speed (×)',
    exact: true,
  })
  const apply = page.getByRole('button', { name: 'Apply speed', exact: true })
  await expect(apply).toBeEnabled()
  await speed.fill('2.5')
  await apply.click()
  await expect(
    page.getByText('Simulation speed updated to 2.5×.', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Run overview' }),
  ).toContainText('Speed 2.5×')
  await page.reload()
  await expect(speed).toHaveValue('2.5')
  await page
    .getByRole('button', { name: 'Start simulation', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Pause simulation', exact: true }),
  ).toBeEnabled()
  await speed.fill('3')
  await apply.click()
  await expect(
    page.getByText('Simulation speed updated to 3×.', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Resume simulation', exact: true }),
  ).toBeEnabled()
  const paused = await (
    await request.get(`/api/v1/simulations/${run.run_id}`)
  ).json()
  await speed.fill('0.5')
  await apply.click()
  await expect(
    page.getByText('Simulation speed updated to 0.5×.', { exact: true }),
  ).toBeVisible()
  const changed = await (
    await request.get(`/api/v1/simulations/${run.run_id}`)
  ).json()
  expect(changed.status).toBe('paused')
  expect(changed.time_multiplier).toBe(0.5)
  expect(changed.elapsed_time_seconds).toBe(paused.elapsed_time_seconds)
  expect(
    (await (await request.get('/api/v1/settings')).json()).simulation_speed,
  ).toBe(1)
  await command(request, run.run_id, 'terminate')
  await expect(apply).toBeDisabled()
})

test('saved default updates the unfinished run and is used for different missions and resets', async ({
  page,
  request,
}) => {
  const first = await saveConfiguration(
    request,
    await configuration(request, 'Default first'),
  )
  const second = await saveConfiguration(
    request,
    await configuration(request, 'Default second'),
  )
  const run = await createRun(request, first)
  await command(request, run.run_id, 'start')
  await command(request, run.run_id, 'pause')
  await page.goto('/settings')
  const defaultSpeed = page.getByRole('spinbutton', {
    name: /Default simulation speed/,
  })
  await defaultSpeed.fill('4')
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByText('Preferences saved to the server.')).toBeVisible()
  await page.reload()
  await expect(defaultSpeed).toHaveValue('4')
  await page.goto(`/mission-control/${run.run_id}`)
  await expect(
    page.getByRole('spinbutton', { name: 'Run speed (×)', exact: true }),
  ).toHaveValue('4')
  await expect(
    page.getByRole('button', { name: 'Resume simulation', exact: true }),
  ).toBeEnabled()
  const before = await (
    await request.get(`/api/v1/simulations/${run.run_id}`)
  ).json()
  await page
    .getByRole('spinbutton', { name: 'Run speed (×)', exact: true })
    .fill('2')
  await page.getByRole('button', { name: 'Apply speed', exact: true }).click()
  await expect(
    page.getByText('Simulation speed updated to 2×.', { exact: true }),
  ).toBeVisible()
  expect(
    (await (await request.get('/api/v1/simulations/' + run.run_id)).json())
      .elapsed_time_seconds,
  ).toBe(before.elapsed_time_seconds)
  expect(
    (await (await request.get('/api/v1/settings')).json()).simulation_speed,
  ).toBe(4)
  await command(request, run.run_id, 'terminate')
  const reset = await request.post(`/api/v1/simulations/${run.run_id}/reset`, {
    data: { idempotency_key: crypto.randomUUID() },
  })
  expect(reset.status()).toBe(201)
  const resetRun = await reset.json()
  expect(resetRun.time_multiplier).toBe(4)
  await command(request, resetRun.run_id, 'terminate')
  await page.goto('/')
  const card = page.getByRole('article', {
    name: `Mission ${second.name}`,
    exact: true,
  })
  await expect(
    card.getByRole('spinbutton', { name: 'Simulation speed (×)', exact: true }),
  ).toHaveValue('4')
  await card.getByRole('button', { name: 'Launch', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  const id = page.url().split('/').at(-1)!
  expect(
    (await (await request.get(`/api/v1/simulations/${id}`)).json())
      .time_multiplier,
  ).toBe(4)
})

test('invalid control speeds do not send commands and valid fractional speeds work on mobile', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Validate control speed'),
  )
  const run = await createRun(request, mission)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto(`/mission-control/${run.run_id}`)
  const speed = page.getByRole('spinbutton', {
    name: 'Run speed (×)',
    exact: true,
  })
  const apply = page.getByRole('button', { name: 'Apply speed', exact: true })
  await expect(apply).toBeEnabled()
  let writes = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/commands')) writes++
  })
  for (const invalid of ['', '0', '-1', '3601']) {
    await speed.fill(invalid)
    await apply.click()
    await expect(page.getByRole('alert')).toContainText(
      'Enter a simulation speed greater than 0 and at most 3600.',
    )
    await expect(speed).toHaveAttribute('aria-invalid', 'true')
    expect(writes).toBe(0)
  }
  await speed.fill('0.25')
  await apply.click()
  await expect(
    page.getByText('Simulation speed updated to 0.25×.', { exact: true }),
  ).toBeVisible()
  expect(writes).toBe(1)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({ path: 'test-results/control-speed-mobile.png' })
})

test('run speed failures retain the input and never display an optimistic speed', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Failed control speed'),
  )
  const run = await createRun(request, mission)
  await page.goto(`/mission-control/${run.run_id}`)
  const apply = page.getByRole('button', { name: 'Apply speed', exact: true })
  await expect(apply).toBeEnabled()
  await page.route(
    `**/api/v1/simulations/${run.run_id}/commands`,
    async (route) => {
      await route.fulfill({
        status: 503,
        json: { detail: 'Speed change unavailable' },
      })
    },
  )
  await page
    .getByRole('spinbutton', { name: 'Run speed (×)', exact: true })
    .fill('7')
  await apply.click()
  await expect(page.getByRole('alert')).toContainText(
    'Speed change unavailable',
  )
  await expect(
    page.getByRole('region', { name: 'Run overview' }),
  ).toContainText('Speed 1×')
  await expect(
    page.getByRole('spinbutton', { name: 'Run speed (×)', exact: true }),
  ).toHaveValue('7')
  expect(
    (await (await request.get(`/api/v1/simulations/${run.run_id}`)).json())
      .time_multiplier,
  ).toBe(1)
})
