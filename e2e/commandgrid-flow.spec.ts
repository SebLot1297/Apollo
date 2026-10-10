import { test, expect } from '@playwright/test'
import {
  configuration,
  createRun,
  command,
  finish,
  launch,
  resetWorkspace,
  saveConfiguration,
  startAndResolvePower,
  screenshot,
} from './helpers'
import type {
  MissionConfiguration,
  Report,
} from '../frontend/src/types/mission'
test.beforeEach(async ({ request }) => resetWorkspace(request))

test('real UI create/edit/save, commands, pause/resume, and persisted successful report with optional failure', async ({
  page,
  request,
}) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/mission-builder')
  await page
    .getByLabel('Mission name', { exact: true })
    .fill('UI success mission')
  await page.getByLabel('Duration (seconds)', { exact: true }).fill('600')
  await page.getByRole('button', { name: 'Next step' }).click()
  await page.getByLabel('Weather severity (%)', { exact: true }).fill('0')
  await page
    .getByLabel('Environmental disruption (%)', { exact: true })
    .fill('0')
  await page
    .getByLabel('Communication reliability (%)', { exact: true })
    .fill('100')
  await page.getByRole('button', { name: 'Next step' }).click()
  const objectives = page.locator('fieldset.cg-objective')
  await objectives
    .nth(0)
    .getByLabel('Objective name', { exact: true })
    .fill('Required resolution')
  await objectives
    .nth(0)
    .getByLabel('Metric', { exact: true })
    .selectOption('incidents_resolved')
  await objectives
    .nth(0)
    .getByLabel('Threshold (count)', { exact: true })
    .fill('1')
  await objectives
    .nth(1)
    .getByRole('button', { name: 'Delete objective 2' })
    .click()
  await objectives
    .nth(1)
    .getByLabel('Objective name', { exact: true })
    .fill('Optional equipment goal')
  await objectives
    .nth(1)
    .getByLabel('Threshold (%)', { exact: true })
    .fill('100')
  await page.getByRole('button', { name: 'Next step' }).click()
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-builder\/[\da-f-]+$/)
  const missionId = page.url().split('/').at(-1)!
  await page.getByRole('button', { name: '2 · Operational conditions' }).click()
  await page.getByLabel('Resource level (%)', { exact: true }).fill('72')
  await page.getByRole('button', { name: '3 · Objectives' }).click()
  await objectives
    .nth(0)
    .getByLabel('Objective name', { exact: true })
    .fill('Required incident restoration')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/missions/${missionId}`) &&
      response.request().method() === 'PUT' &&
      response.ok(),
  )
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await saved
  await page.reload()
  await page.getByRole('button', { name: '2 · Operational conditions' }).click()
  await expect(
    page.getByLabel('Resource level (%)', { exact: true }),
  ).toHaveValue('72')
  const mission = (await (
    await request.get(`/api/v1/missions/${missionId}`)
  ).json()) as MissionConfiguration
  expect(mission.parameters.resource_level).toBe(72)
  expect(mission.objectives[0].name).toBe('Required incident restoration')
  const runId = await launch(page, mission)
  await expect(
    page.getByRole('button', { name: 'Trigger incident', exact: true }),
  ).toBeDisabled()
  await startAndResolvePower(page)
  await page.getByRole('button', { name: 'Pause simulation' }).click()
  await expect(
    page.getByRole('button', { name: 'Resume simulation' }),
  ).toBeEnabled()
  const paused = await page.getByTestId('elapsed-seconds').textContent()
  await page.waitForTimeout(1500) // Verify a real wall-clock interval while server time is paused.
  expect(await page.getByTestId('elapsed-seconds').textContent()).toBe(paused)
  await page.getByRole('button', { name: 'Resume simulation' }).click()
  await expect(
    page.getByRole('button', { name: 'Pause simulation' }),
  ).toBeEnabled()
  await screenshot(page, 'frontend/screenshots/mission-control-desktop.png')
  await finish(page)
  const report = (await (
    await request.get(`/api/v1/reports/${runId}`)
  ).json()) as Report
  expect(report.success).toBe(true)
  expect(report.elapsed_time_seconds).toBeLessThan(600)
  expect(report.objective_results[0].passed).toBe(true)
  expect(report.objective_results[1].passed).toBe(false)
  await expect(
    page
      .getByTestId('objective-result')
      .filter({ hasText: 'Required incident restoration' })
      .getByText('passed', { exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByTestId('objective-result')
      .filter({ hasText: 'Optional equipment goal' })
      .getByText('failed', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('numerical-summary')).toHaveText(report.summary)
  await screenshot(page, 'frontend/screenshots/report-desktop.png')
  expect(errors).toEqual([])
})

test('real required failure and two persisted report comparison', async ({
  page,
  request,
}) => {
  const config = await configuration(request, 'Required failure')
  config.objectives[0].target_value = 2
  const mission = await saveConfiguration(request, config),
    runId = await launch(page, mission)
  await startAndResolvePower(page)
  await finish(page)
  const report = (await (
    await request.get(`/api/v1/reports/${runId}`)
  ).json()) as Report
  expect(report.success).toBe(false)
  expect(report.objective_results[0].status).toBe('failed')
  await expect(page.getByText('Unsuccessful', { exact: true })).toBeVisible()
  const other = await configuration(request, 'Comparison reference')
  other.parameters.resource_level = 25
  const otherMission = await saveConfiguration(request, other),
    otherRun = await createRun(request, otherMission)
  await command(request, otherRun.run_id, 'terminate')
  await page.goto('/reports')
  const reports = (await (
    await request.get('/api/v1/reports')
  ).json()) as Report[]
  await page.getByLabel('First report', { exact: true }).selectOption(runId)
  await page
    .getByLabel('Second report', { exact: true })
    .selectOption(reports.find((item) => item.run_id !== runId)!.run_id)
  await expect(
    page.getByText(/These runs are not a controlled experiment/),
  ).toBeVisible()
})

test('real termination, reset, and old history/report retained', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Termination'),
  )
  const oldId = await launch(page, mission)
  await page.getByRole('button', { name: 'Terminate simulation' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Terminate run', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Reset to new run' }),
  ).toBeEnabled()
  const oldReport = await (await request.get(`/api/v1/reports/${oldId}`)).json()
  expect(oldReport.success).toBe(false)
  await page.getByRole('button', { name: 'Reset to new run' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create new run' })
    .click()
  await expect(page).not.toHaveURL(new RegExp(oldId))
  await expect(
    page.getByRole('button', { name: 'Start simulation' }),
  ).toBeEnabled()
  expect(await (await request.get(`/api/v1/reports/${oldId}`)).json()).toEqual(
    oldReport,
  )
})

test('real automatic duration completion uses future speed and generates persisted report', async ({
  page,
  request,
}) => {
  await request.put('/api/v1/settings', { data: { simulation_speed: 120 } })
  const config = await configuration(request, 'Automatic completion')
  config.duration_seconds = 60
  config.objectives = [
    {
      ...config.objectives[0],
      metric_key: 'elapsed_time_seconds',
      target_value: 60,
    },
  ]
  const mission = await saveConfiguration(request, config),
    runId = await launch(page, mission)
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await expect(
    page.getByRole('button', { name: 'View report', exact: true }),
  ).toBeVisible({ timeout: 15000 })
  await page.getByRole('button', { name: 'View report', exact: true }).click()
  const report = (await (
    await request.get(`/api/v1/reports/${runId}`)
  ).json()) as Report
  expect(report.elapsed_time_seconds).toBe(60)
  expect(report.success).toBe(true)
})

test('real one-active-run and deletion conflict preserve saved mission card', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Active conflict'),
  )
  const run = await createRun(request, mission)
  expect(
    (
      await request.post('/api/v1/simulations', {
        data: { mission_id: mission.id },
      })
    ).status(),
  ).toBe(409)
  await page.goto('/')
  const card = page.getByRole('article', {
    name: `Mission ${mission.name}`,
    exact: true,
  })
  await expect(
    card.getByRole('link', { name: 'Open active run' }),
  ).toBeVisible()
  await card.getByRole('button', { name: 'Delete', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete mission', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText(/active/i)
  await expect(card).toBeVisible()
  expect(
    (await request.get(`/api/v1/simulations/${run.run_id}`)).ok(),
  ).toBeTruthy()
})

test('real resource and capability constraints are visible without optimistic repair', async ({
  page,
  request,
}) => {
  const config = await configuration(request, 'Resource constraint')
  config.parameters.resource_level = 0
  config.parameters.backup_power_enabled = false
  const mission = await saveConfiguration(request, config),
    runId = await launch(page, mission)
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await expect(
    page.getByRole('button', { name: 'Activate backup power', exact: true }),
  ).toBeDisabled()
  await page
    .getByRole('button', { name: 'Trigger incident', exact: true })
    .click()
  await expect(page.getByTestId('power_availability')).toHaveText('30%')
  await page.getByRole('button', { name: 'Restore selected incident' }).click()
  await expect(page.getByRole('alert')).toContainText('insufficient resources')
  await expect(page.getByTestId('power_availability')).toHaveText('30%')
  const state = await (await request.get(`/api/v1/simulations/${runId}`)).json()
  expect(state.incidents.at(-1).status).toBe('active')
  expect(state.metrics.incidents_resolved).toBe(0)
})

test('a real launch race refreshes and offers the competing active run', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Launch race'),
  )
  await page.goto('/')
  const card = page.getByRole('article', {
    name: `Mission ${mission.name}`,
    exact: true,
  })
  await expect(
    card.getByRole('button', { name: 'Launch', exact: true }),
  ).toBeEnabled()
  const competing = await createRun(request, mission)
  await card.getByRole('button', { name: 'Launch', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(/active/i)
  await expect(
    card.getByRole('link', { name: 'Open active run' }),
  ).toHaveAttribute('href', `/mission-control/${competing.run_id}`)
  expect(
    (
      await (
        await request.get(`/api/v1/simulations/${competing.run_id}`)
      ).json()
    ).status,
  ).toBe('created')
})

test('historical report snapshot survives source configuration edit and deletion', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Historical snapshot'),
  )
  const run = await createRun(request, mission)
  await command(request, run.run_id, 'terminate')
  const before = (await (
    await request.get(`/api/v1/reports/${run.run_id}`)
  ).json()) as Report
  await page.goto(`/mission-builder/${mission.id}`)
  await page
    .getByLabel('Mission name', { exact: true })
    .fill('Edited source mission')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const updated = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/missions/${mission.id}`) &&
      response.request().method() === 'PUT' &&
      response.ok(),
  )
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await updated
  await page.goto('/')
  await page
    .getByRole('article', {
      name: 'Mission Edited source mission',
      exact: true,
    })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete mission', exact: true })
    .click()
  await expect(
    page.getByRole('article', {
      name: 'Mission Edited source mission',
      exact: true,
    }),
  ).toHaveCount(0)
  await page.goto(`/reports/${run.run_id}`)
  await expect(
    page.getByRole('heading', { name: mission.name, exact: true }),
  ).toBeVisible()
  expect(
    await (await request.get(`/api/v1/reports/${run.run_id}`)).json(),
  ).toEqual(before)
})
