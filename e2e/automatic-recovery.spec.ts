import { test, expect, type APIRequestContext } from '@playwright/test'
import {
  command,
  configuration,
  createRun,
  resetWorkspace,
  saveConfiguration,
} from './helpers'
import type { MissionState, Report } from '../frontend/src/types/mission'

test.beforeEach(async ({ request }) => resetWorkspace(request))

async function state(
  request: APIRequestContext,
  runId: string,
): Promise<MissionState> {
  return (await (
    await request.get(`/api/v1/simulations/${runId}`)
  ).json()) as MissionState
}

test('automatic recovery runs test2-style objectives unattended and saves real command evidence', async ({
  page,
  request,
}) => {
  const draft = await configuration(request, 'Unattended recovery')
  draft.objectives[1].required = true
  const mission = await saveConfiguration(request, draft)
  const run = await createRun(request, mission)
  await page.goto(`/mission-control/${run.run_id}`)
  const toggle = page.getByRole('switch', { name: 'Automatic recovery' })
  await expect(toggle).toBeEnabled()
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(
    page.getByText('Recovery mode updated to automatic.', { exact: true }),
  ).toBeVisible()
  await expect(toggle).toBeChecked()
  await page.reload()
  await expect(toggle).toBeChecked()
  await page.getByRole('button', { name: '120×', exact: true }).click()
  await expect(
    page.getByText('Simulation speed updated to 120×.', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Start simulation', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Run equipment diagnostic', exact: true }),
  ).toBeDisabled()
  await expect
    .poll(async () => (await state(request, run.run_id)).status, {
      timeout: 15000,
    })
    .toBe('completed')
  const finished = await state(request, run.run_id)
  expect(finished.metrics.incidents_resolved).toBe(1)
  expect(finished.metrics.equipment_availability_percent).toBe(100)
  expect(
    finished.command_history!.filter((item) => item.source === 'automatic')
      .length,
  ).toBe(3)
  await expect(toggle).toBeDisabled()
  await page.goto(`/reports/${run.run_id}`)
  await expect(page.getByText('Success', { exact: true })).toBeVisible()
  await expect(
    page.getByText(/Automatic · run equipment diagnostic/),
  ).toBeVisible()
  await expect(page.getByText(/Automatic · restore service/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Automatic · restore service/)).toBeVisible()
  const report = (await (
    await request.get(`/api/v1/reports/${run.run_id}`)
  ).json()) as Report
  expect(report.success).toBe(true)
  expect(report.objective_results.every((item) => item.passed)).toBe(true)
})

test('mode switching pauses automation, cancels it in manual mode, and restores manual commands', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Switch recovery modes'),
  )
  const run = await createRun(request, mission)
  await command(request, run.run_id, 'start')
  await command(request, run.run_id, 'trigger_incident', {
    kind: 'power_failure',
  })
  await command(request, run.run_id, 'pause')
  await page.goto(`/mission-control/${run.run_id}`)
  const toggle = page.getByRole('switch', { name: 'Automatic recovery' })
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(
    page.getByText('Recovery mode updated to automatic.', { exact: true }),
  ).toBeVisible()
  const paused = await state(request, run.run_id)
  await page.waitForTimeout(1000)
  expect((await state(request, run.run_id)).elapsed_time_seconds).toBe(
    paused.elapsed_time_seconds,
  )
  expect((await state(request, run.run_id)).metrics.incidents_resolved).toBe(0)
  await page.reload()
  await expect(toggle).toBeChecked()
  await expect(
    page.getByRole('button', { name: 'Execute action', exact: true }).first(),
  ).toBeDisabled()
  await toggle.click()
  await expect(
    page.getByText('Recovery mode updated to manual.', { exact: true }),
  ).toBeVisible()
  expect((await state(request, run.run_id)).next_recovery_at_seconds).toBeNull()
  await page.getByRole('button', { name: '30×', exact: true }).click()
  await expect(
    page.getByText('Simulation speed updated to 30×.', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Resume simulation', exact: true })
    .click()
  // More than 10 simulated seconds pass: cancelled recovery cannot execute.
  await page.waitForTimeout(1000)
  expect((await state(request, run.run_id)).metrics.incidents_resolved).toBe(0)
  await page
    .getByRole('button', { name: 'Pause simulation', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Restore selected incident', exact: true })
    .click()
  await expect
    .poll(
      async () => (await state(request, run.run_id)).metrics.incidents_resolved,
    )
    .toBe(1)
  const manual = await state(request, run.run_id)
  expect(
    manual.command_history!.filter((item) => item.source === 'automatic'),
  ).toEqual([])
  await toggle.click()
  await expect(
    page.getByText('Recovery mode updated to automatic.', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Resume simulation', exact: true })
    .click()
  await expect(page.getByTestId('equipment_availability')).toHaveText('100%')
  expect(
    (await state(request, run.run_id)).command_history!.some(
      (item) => item.source === 'automatic',
    ),
  ).toBe(true)
})

test('automatic recovery cannot bypass exhausted resources or force a successful report', async ({
  page,
  request,
}) => {
  const draft = await configuration(request, 'Exhausted automatic recovery')
  draft.parameters.resource_level = 0
  draft.objectives[1].required = true
  const mission = await saveConfiguration(request, draft)
  const response = await request.post('/api/v1/simulations', {
    data: {
      mission_id: mission.id,
      time_multiplier: 120,
      recovery_mode: 'automatic',
    },
  })
  expect(response.status()).toBe(201)
  const run = (await response.json()) as MissionState
  await page.goto(`/mission-control/${run.run_id}`)
  await expect(
    page.getByRole('switch', { name: 'Automatic recovery' }),
  ).toBeChecked()
  await page
    .getByRole('button', { name: 'Start simulation', exact: true })
    .click()
  await expect
    .poll(async () => (await state(request, run.run_id)).status, {
      timeout: 15000,
    })
    .toBe('failed')
  await page.goto(`/reports/${run.run_id}`)
  await expect(page.getByText('Unsuccessful', { exact: true })).toBeVisible()
  await expect(
    page
      .getByText(/Automatic recovery blocked: insufficient resources/)
      .first(),
  ).toBeVisible()
  const finished = await state(request, run.run_id)
  expect(finished.metrics.incidents_resolved).toBe(0)
  expect(finished.metrics.equipment_availability_percent).toBe(75)
})

test('a rejected recovery toggle retains server mode and works on a narrow screen', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Recovery toggle failure'),
  )
  const run = await createRun(request, mission)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto(`/mission-control/${run.run_id}`)
  const toggle = page.getByRole('switch', { name: 'Automatic recovery' })
  await expect(toggle).toBeEnabled()
  await page.route(`**/api/v1/simulations/${run.run_id}/commands`, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: 'Recovery mode could not be saved.' },
    }),
  )
  await toggle.click()
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Recovery mode could not be saved.' }),
  ).toBeVisible()
  await expect(toggle).not.toBeChecked()
  expect((await state(request, run.run_id)).recovery_mode).toBe('manual')
  await page.unroute(`**/api/v1/simulations/${run.run_id}/commands`)
  await toggle.click()
  await expect(toggle).toBeChecked()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await toggle.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/automatic-recovery-mobile.png' })
})

test('reset preserves automatic mode and guided demos can recover without operator clicks', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/v1/simulations/demo')
  expect(response.status()).toBe(201)
  const run = (await response.json()) as MissionState
  await page.goto(`/mission-control/${run.run_id}`)
  const toggle = page.getByRole('switch', { name: 'Automatic recovery' })
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await page.getByRole('button', { name: '120×', exact: true }).click()
  await expect(
    page.getByText('Simulation speed updated to 120×.', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Start simulation', exact: true })
    .click()
  await expect
    .poll(async () => (await state(request, run.run_id)).status, {
      timeout: 20000,
    })
    .toBe('completed')
  expect((await state(request, run.run_id)).metrics.incidents_resolved).toBe(3)
  await page
    .getByRole('button', { name: 'Reset to new run', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Create new run', exact: true })
    .click()
  await expect(page).not.toHaveURL(new RegExp(run.run_id))
  await expect(toggle).toBeChecked()
  const resetId = page.url().split('/').at(-1)!
  expect((await state(request, resetId)).status).toBe('created')
  expect((await state(request, resetId)).run_profile).toBe('guided_demo')
  expect(
    (await (await request.get(`/api/v1/reports/${run.run_id}`)).json()).success,
  ).toBe(true)
})
