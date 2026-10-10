import { test, expect } from '@playwright/test'
import {
  command,
  configuration,
  createRun,
  resetWorkspace,
  saveConfiguration,
} from './helpers'

test.beforeEach(async ({ request }) => resetWorkspace(request))

test('preferences refresh cached values and persist a subsequent save', async ({
  page,
  request,
}) => {
  await page.goto('/settings')
  const speed = page.getByRole('spinbutton', {
    name: /Future-run simulation speed/,
  })
  await expect(speed).toHaveValue('1')
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Dashboard', exact: true })
    .click()
  await request.put('/api/v1/settings', { data: { simulation_speed: 12 } })
  const started = Date.now()
  await expect.poll(() => Date.now() - started).toBeGreaterThan(3100)
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Settings', exact: true })
    .click()
  await expect(speed).toHaveValue('12')
  await speed.fill('15')
  await expect(page.getByText('Preferences saved to the server.')).toHaveCount(
    0,
  )
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByText('Preferences saved to the server.')).toBeVisible()
  await page.reload()
  await expect(speed).toHaveValue('15')
})

test('a delayed preference refresh preserves edits made while it was loading', async ({
  page,
  request,
}) => {
  await page.goto('/settings')
  const speed = page.getByRole('spinbutton', {
    name: /Future-run simulation speed/,
  })
  await expect(speed).toHaveValue('1')
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Dashboard', exact: true })
    .click()
  await request.put('/api/v1/settings', { data: { simulation_speed: 12 } })
  const started = Date.now()
  await expect.poll(() => Date.now() - started).toBeGreaterThan(3100)
  let release!: () => void, arrived!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const reading = new Promise<void>((resolve) => {
    arrived = resolve
  })
  await page.route('**/api/v1/settings', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    arrived()
    await held
    await route.fulfill({ response })
  })
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Settings', exact: true })
    .click()
  await reading
  await speed.fill('15')
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/settings') &&
      response.request().method() === 'GET',
  )
  release()
  await refreshed
  await expect(speed).toHaveValue('15')
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByText('Preferences saved to the server.')).toBeVisible()
  expect(
    (await (await request.get('/api/v1/settings')).json()).simulation_speed,
  ).toBe(15)
})

test('launch uses the current server speed even if dashboard preferences were cached', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Current server speed'),
  )
  await page.goto('/')
  const launch = page
    .getByRole('article', { name: `Mission ${mission.name}`, exact: true })
    .getByRole('button', { name: 'Launch', exact: true })
  await expect(launch).toBeEnabled()
  await request.put('/api/v1/settings', { data: { simulation_speed: 7 } })
  await launch.click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  const runId = page.url().split('/').at(-1)
  expect(
    (await (await request.get(`/api/v1/simulations/${runId}`)).json())
      .time_multiplier,
  ).toBe(7)
})

test('speed one and a new UI-built mission save visibly and launch with all submitted parameters', async ({
  page,
  request,
}) => {
  await request.put('/api/v1/settings', { data: { simulation_speed: 1000 } })
  await page.goto('/settings')
  await page
    .getByRole('spinbutton', { name: /Future-run simulation speed/ })
    .fill('1')
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByText('Preferences saved to the server.')).toBeVisible()
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Mission Builder', exact: true })
    .click()
  await page
    .getByLabel('Mission name', { exact: true })
    .fill('UI save then launch')
  await page.getByLabel('Duration (seconds)', { exact: true }).fill('600')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  await page.getByLabel('Deadline (seconds)', { exact: true }).fill('600')
  const parameters: [string, string][] = [
    ['Weather severity (%)', '23'],
    ['Environmental disruption (%)', '17'],
    ['Support team count (count)', '6'],
    ['Equipment reliability (%)', '82'],
    ['Resource level (%)', '63'],
    ['Communication reliability (%)', '61'],
  ]
  for (const [label, value] of parameters)
    await page.getByLabel(label, { exact: true }).fill(value)
  await page
    .getByRole('checkbox', { name: 'Backup power enabled', exact: true })
    .uncheck()
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-builder\/[\da-f-]+$/)
  await expect(
    page.getByText('Configuration saved to the backend.'),
  ).toBeVisible()
  const id = page.url().split('/').at(-1)!
  const saved = await (await request.get(`/api/v1/missions/${id}`)).json()
  expect(saved.parameters).toMatchObject({
    weather_severity: 23,
    environmental_disruption: 17,
    team_count: 6,
    equipment_reliability: 82,
    resource_level: 63,
    communication_reliability: 61,
    backup_power_enabled: false,
  })
  await page.reload()
  await page.getByRole('button', { name: '2 · Operational conditions' }).click()
  for (const [label, value] of parameters)
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value)
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Dashboard', exact: true })
    .click()
  await page
    .getByRole('article', { name: 'Mission UI save then launch', exact: true })
    .getByRole('button', { name: 'Launch', exact: true })
    .click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  const runId = page.url().split('/').at(-1)!
  const run = await (await request.get(`/api/v1/simulations/${runId}`)).json()
  expect(run.mission_id).toBe(id)
  expect(run.time_multiplier).toBe(1)
  expect(run.mission.parameters).toEqual(saved.parameters)
  expect(run.mission.duration_seconds).toBe(600)
  expect(run.support_teams).toHaveLength(6)
})

test('mission editor refreshes cached configuration before editing and persists repeated saves', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Cached mission'),
  )
  await page.goto(`/mission-builder/${mission.id}`)
  const name = page.getByLabel('Mission name', { exact: true })
  await expect(name).toHaveValue(mission.name)
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Dashboard', exact: true })
    .click()
  const newer = { ...mission, name: `${mission.name} refreshed` }
  expect(
    (await request.put(`/api/v1/missions/${mission.id}`, { data: newer })).ok(),
  ).toBeTruthy()
  const started = Date.now()
  await expect.poll(() => Date.now() - started).toBeGreaterThan(3100)
  await page.locator(`a[href="/mission-builder/${mission.id}"]`).click()
  await expect(name).toHaveValue(newer.name)
  for (const suffix of ['first edit', 'second edit']) {
    await name.fill(`${mission.name} ${suffix}`)
    await page.getByRole('button', { name: '4 · Review and save' }).click()
    await page
      .getByRole('button', { name: 'Save mission', exact: true })
      .click()
    await expect(
      page.getByText('Configuration saved to the backend.'),
    ).toBeVisible()
    expect(
      (await (await request.get(`/api/v1/missions/${mission.id}`)).json()).name,
    ).toBe(`${mission.name} ${suffix}`)
  }
  await page.reload()
  await expect(name).toHaveValue(`${mission.name} second edit`)
})

test('preferences cannot change underneath a pending save and the next edit clears saved feedback', async ({
  page,
  request,
}) => {
  await page.goto('/settings')
  const speed = page.getByRole('spinbutton', {
    name: /Future-run simulation speed/,
  })
  await speed.fill('20')
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/v1/settings', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  try {
    await page.getByRole('button', { name: 'Save preferences' }).click()
    await expect(
      page.getByRole('button', { name: 'Saving…', exact: true }),
    ).toBeDisabled()
    await expect(speed).toBeDisabled()
    await expect(
      page.getByRole('combobox', { name: /Preferred AI provider/ }),
    ).toBeDisabled()
    await expect(
      page.getByRole('checkbox', { name: 'Demo mode', exact: true }),
    ).toBeDisabled()
  } finally {
    release()
  }
  await expect(page.getByText('Preferences saved to the server.')).toBeVisible()
  expect(
    (await (await request.get('/api/v1/settings')).json()).simulation_speed,
  ).toBe(20)
  await speed.fill('21')
  await expect(page.getByText('Preferences saved to the server.')).toHaveCount(
    0,
  )
})

test('mission draft controls stay locked during a save and new edits clear saved feedback', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Pending mission'),
  )
  await page.goto(`/mission-builder/${mission.id}`)
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**/api/v1/missions/${mission.id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  try {
    await page
      .getByRole('button', { name: 'Save mission', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Saving…', exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByRole('checkbox', { name: 'Backup power enabled', exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Use Signal Restore template' }),
    ).toBeDisabled()
  } finally {
    release()
  }
  await expect(
    page.getByText('Configuration saved to the backend.'),
  ).toBeVisible()
  await page
    .getByLabel('Mission name', { exact: true })
    .fill('Next unsaved edit')
  await expect(
    page.getByText('Configuration saved to the backend.'),
  ).toHaveCount(0)
})

test('a persisted new mission remains visible even if the follow-up read fails', async ({
  page,
  request,
}) => {
  await page.goto('/mission-builder')
  await page
    .getByLabel('Mission name', { exact: true })
    .fill('Confirmed saved mission')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  await page.route(/\/api\/v1\/missions\/[\da-f-]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await route.fulfill({
      status: 503,
      json: { detail: 'Follow-up read unavailable' },
    })
  })
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-builder\/[\da-f-]+$/)
  await expect(
    page.getByText('Configuration saved to the backend.'),
  ).toBeVisible()
  await expect(page.getByLabel('Mission name', { exact: true })).toHaveValue(
    'Confirmed saved mission',
  )
  const id = page.url().split('/').at(-1)
  expect(
    (await (await request.get(`/api/v1/missions/${id}`)).json()).name,
  ).toBe('Confirmed saved mission')
  await page.unroute(/\/api\/v1\/missions\/[\da-f-]+$/)
  await page.reload()
  await expect(page.getByLabel('Mission name', { exact: true })).toHaveValue(
    'Confirmed saved mission',
  )
})

test('invalid mission save explains that nothing was saved and focuses the correction', async ({
  page,
  request,
}) => {
  await page.goto('/mission-builder')
  await page.getByLabel('Duration (seconds)', { exact: true }).fill('600')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  let writes = 0
  page.on('request', (req) => {
    if (req.url().endsWith('/missions') && req.method() === 'POST') writes++
  })
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Mission was not saved' }),
  ).toBeVisible()
  await expect(
    page.getByText('Deadline cannot exceed mission duration.'),
  ).toBeVisible()
  const deadline = page.getByLabel('Deadline (seconds)', { exact: true })
  await expect(deadline).toBeFocused()
  expect(writes).toBe(0)
  await deadline.fill('600')
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-builder\/[\da-f-]+$/)
  const id = page.url().split('/').at(-1)
  expect(
    (await (await request.get(`/api/v1/missions/${id}`)).json())
      .duration_seconds,
  ).toBe(600)
})

test('another active mission cannot masquerade as launching the newly saved configuration', async ({
  page,
  request,
}) => {
  const older = await saveConfiguration(
    request,
    await configuration(request, 'Older active mission'),
  )
  const oldRun = await createRun(request, older)
  const draft = await configuration(request, 'New saved mission')
  draft.parameters.weather_severity = 23
  draft.parameters.environmental_disruption = 17
  draft.parameters.communication_reliability = 61
  const mission = await saveConfiguration(request, draft)
  await page.goto('/')
  const card = page.getByRole('article', {
    name: `Mission ${mission.name}`,
    exact: true,
  })
  await expect(
    card.getByRole('button', { name: 'Launch', exact: true }),
  ).toBeDisabled()
  await expect(
    card.getByRole('link', { name: 'Open active run', exact: true }),
  ).toHaveCount(0)
  await expect(card).toContainText('Finish or terminate')
  await expect(card).toContainText(older.name)
  await command(request, oldRun.run_id, 'terminate')
  await page.reload()
  await card.getByRole('button', { name: 'Launch', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  const runId = page.url().split('/').at(-1)
  const state = await (await request.get(`/api/v1/simulations/${runId}`)).json()
  expect(state.mission_id).toBe(mission.id)
  expect(state.mission.parameters).toEqual(mission.parameters)
  expect(state.time_multiplier).toBe(1)
})
