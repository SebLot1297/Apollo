import { test, expect, type APIRequestContext } from '@playwright/test'
import { command, resetWorkspace } from './helpers'
import type { MissionState, Report } from '../frontend/src/types/mission'

test.beforeEach(async ({ request }) => resetWorkspace(request))

const terminal = (status: string) =>
  ['completed', 'failed', 'terminated'].includes(status)

async function state(request: APIRequestContext, runId: string) {
  return (await (
    await request.get(`/api/v1/simulations/${runId}`)
  ).json()) as MissionState
}

// Drive the remaining recovery through the API (the presenter's actions) so the
// browser test can reach the report quickly after exercising the UI controls.
async function recover(request: APIRequestContext, runId: string) {
  const current = await state(request, runId)
  for (const incident of current.incidents.filter((i) => i.status !== 'resolved')) {
    if (incident.kind === 'communications_outage')
      await command(request, runId, 'activate_backup_communications')
    if (incident.kind === 'power_failure')
      await command(request, runId, 'activate_backup_power')
    if (incident.status === 'active')
      await command(request, runId, 'acknowledge_incident', {
        incident_id: incident.id,
      })
    if (incident.kind === 'equipment_degradation')
      await command(request, runId, 'run_equipment_diagnostic')
    else
      await command(request, runId, 'restore_service', {
        incident_id: incident.id,
      })
  }
}

test('guided demo: launch, speed, paused recovery and successful report', async ({
  page,
  request,
}) => {
  test.setTimeout(120000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Launch guided demo' }).click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  const runId = page.url().split('/').at(-1)!
  await expect(page.getByText('Guided demo', { exact: true })).toBeVisible()

  // Live speed control: pick 120x so the seeded incidents arrive quickly.
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await page.getByRole('button', { name: '120×' }).click()
  await expect
    .poll(async () => (await state(request, runId)).time_multiplier)
    .toBe(120)

  // First incident auto-pauses the run and guidance becomes available.
  await expect(
    page.getByRole('button', { name: 'Resume simulation' }),
  ).toBeVisible({ timeout: 30000 })
  const first = await state(request, runId)
  expect(first.status).toBe('paused')
  expect(first.incidents.at(-1)!.kind).toBe('communications_outage')
  await expect(page.getByTestId('recovery-plan')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Execute action', exact: true }).first(),
  ).toBeVisible()

  // Recovery while paused improves systems without advancing simulated time.
  const elapsedBefore = (await state(request, runId)).elapsed_time_seconds
  await page
    .getByRole('button', { name: 'Execute action', exact: true })
    .first()
    .click()
  await expect(page.getByTestId('communication_health')).toHaveText('85%', {
    timeout: 15000,
  })
  expect((await state(request, runId)).elapsed_time_seconds).toBe(elapsedBefore)

  // Complete the demo: recover at each auto-pause, then finish and read the report.
  for (let round = 0; round < 8; round++) {
    const current = await state(request, runId)
    if (terminal(current.status)) break
    await recover(request, runId)
    const latest = await state(request, runId)
    if (terminal(latest.status)) break
    await command(request, runId, 'resume')
    await expect
      .poll(async () => {
        const now = await state(request, runId)
        return now.status
      }, { timeout: 30000 })
      .not.toBe('running')
  }
  const final = await state(request, runId)
  expect(terminal(final.status)).toBe(true)
  expect(Math.abs(final.elapsed_time_seconds - 900)).toBeLessThan(1)

  await page.goto(`/reports/${runId}`)
  await expect(page.getByText('Success', { exact: true })).toBeVisible()
  const report = (await (
    await request.get(`/api/v1/reports/${runId}`)
  ).json()) as Report
  expect(report.success).toBe(true)
  expect(errors).toEqual([])
})
