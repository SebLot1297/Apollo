import { test, expect } from '@playwright/test'
import {
  command,
  configuration,
  resetWorkspace,
  saveConfiguration,
} from './helpers'

test.beforeEach(async ({ request }) => resetWorkspace(request))

test('a chosen fractional launch speed persists in this run without changing settings or the mission', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Chosen speed'),
  )
  await page.goto('/')
  const card = page.getByRole('article', {
    name: `Mission ${mission.name}`,
    exact: true,
  })
  const speed = card.getByRole('spinbutton', {
    name: 'Simulation speed (×)',
    exact: true,
  })
  await expect(speed).toHaveValue('1')
  await speed.fill('2.5')
  await card.getByRole('button', { name: 'Launch', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  const id = page.url().split('/').at(-1)!
  const state = await (await request.get(`/api/v1/simulations/${id}`)).json()
  expect(state.time_multiplier).toBe(2.5)
  expect(state.mission_id).toBe(mission.id)
  expect(
    (await (await request.get('/api/v1/settings')).json()).simulation_speed,
  ).toBe(1)
  expect(
    await (await request.get(`/api/v1/missions/${mission.id}`)).json(),
  ).toEqual(mission)
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'Run overview' }),
  ).toContainText('Speed 2.5×')
  await page
    .getByRole('button', { name: 'Start simulation', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Pause simulation', exact: true }),
  ).toBeEnabled()
  expect(
    (await (await request.get(`/api/v1/simulations/${id}`)).json())
      .time_multiplier,
  ).toBe(2.5)
})

test('invalid launch speeds never submit a simulation and oversized speeds launch at the maximum', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Validate launch speed'),
  )
  await page.goto('/')
  const card = page.getByRole('article', {
    name: `Mission ${mission.name}`,
    exact: true,
  })
  const speed = card.getByRole('spinbutton', {
    name: 'Simulation speed (×)',
    exact: true,
  })
  let writes = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/simulations')) writes++
  })
  for (const invalid of ['', '0', '-1']) {
    await speed.fill(invalid)
    await card.getByRole('button', { name: 'Launch', exact: true }).click()
    await expect(speed).toHaveAttribute('aria-invalid', 'true')
    await expect(card.getByRole('alert')).toHaveText(
      'Enter a finite speed greater than 0.',
    )
    expect(writes).toBe(0)
    await expect(page).toHaveURL(new URL('/', page.url()).href)
  }
  await speed.fill('10000')
  await expect(speed).toHaveAttribute('aria-invalid', 'false')
  await card.getByRole('button', { name: 'Launch', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  expect(writes).toBe(1)
  const id = page.url().split('/').at(-1)!
  expect(
    (await (await request.get(`/api/v1/simulations/${id}`)).json())
      .time_multiplier,
  ).toBe(3600)
})

test('mission speed choices are independent and can return to the current saved default', async ({
  page,
  request,
}) => {
  const first = await saveConfiguration(
    request,
    await configuration(request, 'First speed choice'),
  )
  const second = await saveConfiguration(
    request,
    await configuration(request, 'Second speed choice'),
  )
  await request.put('/api/v1/settings', { data: { simulation_speed: 3 } })
  await page.goto('/')
  const firstCard = page.getByRole('article', {
    name: `Mission ${first.name}`,
    exact: true,
  })
  const secondCard = page.getByRole('article', {
    name: `Mission ${second.name}`,
    exact: true,
  })
  await firstCard
    .getByRole('spinbutton', { name: 'Simulation speed (×)', exact: true })
    .fill('10')
  await expect(
    secondCard.getByRole('spinbutton', {
      name: 'Simulation speed (×)',
      exact: true,
    }),
  ).toHaveValue('3')
  await secondCard
    .getByRole('spinbutton', { name: 'Simulation speed (×)', exact: true })
    .fill('0.5')
  await secondCard.getByRole('button', { name: 'Launch', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  const id = page.url().split('/').at(-1)!
  expect(
    (await (await request.get(`/api/v1/simulations/${id}`)).json())
      .time_multiplier,
  ).toBe(0.5)
  await command(request, id, 'terminate')
  await page.goto('/')
  const speed = firstCard.getByRole('spinbutton', {
    name: 'Simulation speed (×)',
    exact: true,
  })
  await speed.fill('8')
  await firstCard
    .getByRole('button', { name: 'Use saved default', exact: true })
    .click()
  await expect(speed).toHaveValue('3')
  await request.put('/api/v1/settings', { data: { simulation_speed: 4 } })
  await firstCard.getByRole('button', { name: 'Launch', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  const nextId = page.url().split('/').at(-1)!
  expect(
    (await (await request.get(`/api/v1/simulations/${nextId}`)).json())
      .time_multiplier,
  ).toBe(4)
})

test('launch speed can be chosen on a narrow screen', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Mobile speed'),
  )
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/')
  const card = page.getByRole('article', {
    name: `Mission ${mission.name}`,
    exact: true,
  })
  await card
    .getByRole('spinbutton', { name: 'Simulation speed (×)', exact: true })
    .fill('5')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await card.getByRole('button', { name: 'Launch', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  const id = page.url().split('/').at(-1)!
  expect(
    (await (await request.get(`/api/v1/simulations/${id}`)).json())
      .time_multiplier,
  ).toBe(5)
})
