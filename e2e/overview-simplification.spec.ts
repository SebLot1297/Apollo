import { test, expect } from '@playwright/test'
import {
  command,
  configuration,
  createRun,
  resetWorkspace,
  saveConfiguration,
} from './helpers'

test.beforeEach(async ({ request }) => resetWorkspace(request))

test('configuration is manual and histories appear only in the saved report, including after reset', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Report-only histories'),
  )
  const errors: string[] = [],
    inference: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/ai/'))
      inference.push(req.url())
  })
  for (const url of [
    '/mission-builder',
    `/mission-builder/${mission.id}`,
    `/objectives/${mission.id}`,
  ]) {
    await page.goto(url)
    await expect(page.getByRole('form')).toBeVisible()
    await expect(page.getByLabel('Proposal prompt')).toHaveCount(0)
    await expect(
      page.getByRole('heading', { name: 'AI-assisted proposals' }),
    ).toHaveCount(0)
  }
  const run = await createRun(request, mission)
  await command(request, run.run_id, 'start')
  const power = await command(request, run.run_id, 'trigger_incident', {
    kind: 'power_failure',
  })
  const powerId = power.incidents.at(-1)!.id
  await command(request, run.run_id, 'trigger_incident', {
    kind: 'communications_outage',
  })
  await command(request, run.run_id, 'pause')
  await page.goto(`/mission-control/${run.run_id}`)
  for (const title of ['Incidents', 'Event timeline', 'Activity log'])
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toHaveCount(0)
  await expect(
    page.getByLabel('Active incident', { exact: true }),
  ).toBeVisible()
  await page
    .getByLabel('Active incident', { exact: true })
    .selectOption(powerId)
  await expect(
    page
      .getByTestId('incident-inspector')
      .getByRole('heading', { name: 'Power failure', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.map-marker.associated')).toHaveCount(1)
  await command(request, run.run_id, 'acknowledge_incident', {
    incident_id: powerId,
  })
  await command(request, run.run_id, 'restore_service', {
    incident_id: powerId,
  })
  await command(request, run.run_id, 'terminate')
  await page.goto(`/reports/${run.run_id}`)
  const history = page.getByRole('region', { name: 'Incident history' })
  await expect(
    page.getByRole('region', { name: 'Event timeline', exact: true }),
  ).toHaveCount(1)
  await expect(
    page
      .locator('details.report-disclosure > summary')
      .filter({ hasText: 'Event timeline' }),
  ).toHaveCount(1)
  for (const title of [
    'Incident history',
    'Event timeline',
    'Accepted command history',
  ])
    await expect(
      page.getByRole('region', { name: title, exact: true }).locator('details'),
    ).toHaveJSProperty('open', false)
  const toggle = history.locator('summary')
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(
    history.getByRole('heading', { name: 'Power failure', exact: true }),
  ).toBeVisible()
  const events = page.getByRole('region', {
    name: 'Event timeline',
    exact: true,
  })
  await events.locator('summary').focus()
  await page.keyboard.press('Space')
  await expect(events.locator('ol')).toBeVisible()
  const commands = page.getByRole('region', {
    name: 'Accepted command history',
    exact: true,
  })
  await commands.locator('summary').click()
  await expect(commands.locator('ul')).toBeVisible()
  await commands.locator('summary').click()
  await expect(commands.locator('ul')).toBeHidden()
  await expect(history.getByText('resolved', { exact: true })).toBeVisible()
  await expect(
    history.getByRole('heading', {
      name: 'Communication outage',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Event timeline' }),
  ).toBeVisible()
  await request.post(`/api/v1/simulations/${run.run_id}/reset`, {
    data: { idempotency_key: crypto.randomUUID() },
  })
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'Event timeline', exact: true }),
  ).toHaveCount(1)
  await expect(
    page
      .locator('details.report-disclosure > summary')
      .filter({ hasText: 'Event timeline' }),
  ).toHaveCount(1)
  await history.locator('summary').click()
  await expect(history.getByText('resolved', { exact: true })).toBeVisible()
  await expect(history.getByText('active', { exact: true })).toBeVisible()
  expect(inference).toEqual([])
  expect(errors).toEqual([])
})

test('oversized default speeds are saved at the maximum and incident history has an explicit empty state', async ({
  page,
  request,
}) => {
  await page.goto('/settings')
  const speed = page.getByRole('spinbutton', {
    name: /Default simulation speed/,
  })
  await speed.fill('10000')
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(speed).toHaveValue('3600')
  expect(
    (await (await request.get('/api/v1/settings')).json()).simulation_speed,
  ).toBe(3600)
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Empty report incidents'),
  )
  const run = await createRun(request, mission)
  await command(request, run.run_id, 'terminate')
  await page.goto(`/reports/${run.run_id}`)
  await page
    .getByRole('region', { name: 'Incident history' })
    .locator('summary')
    .click()
  await expect(
    page
      .getByRole('region', { name: 'Incident history' })
      .getByText('No incidents recorded.'),
  ).toBeVisible()
})
