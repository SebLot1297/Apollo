import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type {
  MissionConfiguration,
  MissionState,
} from '../frontend/src/types/mission'

export async function resetWorkspace(request: APIRequestContext) {
  const runs = (await (
    await request.get('/api/v1/simulations')
  ).json()) as MissionState[]
  for (const run of runs.filter((run) =>
    ['created', 'running', 'paused'].includes(run.status),
  )) {
    const result = await request.post(
      `/api/v1/simulations/${run.run_id}/commands`,
      {
        data: {
          command_type: 'terminate',
          payload: {},
          idempotency_key: randomUUID(),
        },
      },
    )
    expect([200, 409]).toContain(result.status())
  }
  expect(
    (
      await request.put('/api/v1/settings', {
        data: { simulation_speed: 1, ai_provider: 'auto', demo_mode: false },
      })
    ).ok(),
  ).toBeTruthy()
}
export async function configuration(
  request: APIRequestContext,
  name = 'Browser mission',
): Promise<MissionConfiguration> {
  const seed = (
    (await (
      await request.get('/api/v1/missions')
    ).json()) as MissionConfiguration[]
  ).find((mission) => mission.name === 'Operation Signal Restore')!
  const now = new Date().toISOString()
  return {
    ...structuredClone(seed),
    id: randomUUID(),
    name: `${name} ${randomUUID().slice(0, 8)}`,
    duration_seconds: 600,
    parameters: {
      ...seed.parameters,
      weather_severity: 0,
      environmental_disruption: 0,
      communication_reliability: 100,
      equipment_reliability: 75,
      resource_level: 70,
    },
    objectives: [
      {
        ...seed.objectives[0],
        id: randomUUID(),
        name: 'Required resolution',
        metric_key: 'incidents_resolved',
        target_value: 1,
        evaluation_mode: 'final',
        deadline_seconds: null,
      },
      {
        ...seed.objectives[2],
        id: randomUUID(),
        name: 'Optional equipment goal',
        target_value: 100,
      },
    ],
    facilities: [],
    support_teams: [],
    created_at: now,
    updated_at: now,
  }
}
export async function saveConfiguration(
  request: APIRequestContext,
  mission: MissionConfiguration,
) {
  const response = await request.post('/api/v1/missions', { data: mission })
  expect(response.status()).toBe(201)
  return (await response.json()) as MissionConfiguration
}
export async function saveMissionFromUI(page: Page) {
  const response = page.waitForResponse(
    (result) =>
      /\/api\/v1\/missions(?:\/[\da-f-]+)?$/.test(result.url()) &&
      ['POST', 'PUT'].includes(result.request().method()) &&
      result.ok(),
  )
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  const saved = (await (await response).json()) as MissionConfiguration
  await expect(page).toHaveURL('http://127.0.0.1:5173/')
  await expect(page.locator('.cg-toast')).toHaveText(
    'mission saved successfully',
  )
  await expect(
    page
      .getByRole('article')
      .filter({ has: page.locator(`a[href="/mission-builder/${saved.id}"]`) }),
  ).toBeVisible()
  return saved
}
export async function createRun(
  request: APIRequestContext,
  mission: MissionConfiguration,
) {
  const response = await request.post('/api/v1/simulations', {
    data: { mission_id: mission.id, random_seed: 42, time_multiplier: 1 },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as MissionState
}
export async function command(
  request: APIRequestContext,
  runId: string,
  command_type: string,
  payload = {},
) {
  const response = await request.post(`/api/v1/simulations/${runId}/commands`, {
    data: { command_type, payload, idempotency_key: randomUUID() },
  })
  expect(response.ok()).toBeTruthy()
  return (await response.json()) as MissionState
}
export async function launch(page: Page, mission: MissionConfiguration) {
  await page.goto('/')
  await page
    .getByRole('article', { name: `Mission ${mission.name}`, exact: true })
    .getByRole('button', { name: 'Launch', exact: true })
    .click()
  await expect(page).toHaveURL(/\/mission-control\/[\da-f-]+$/)
  await expect(
    page.getByRole('button', { name: 'Start simulation' }),
  ).toBeEnabled()
  return page.url().split('/').at(-1)!
}
export async function startAndResolvePower(page: Page) {
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await expect(
    page.getByRole('button', { name: 'Pause simulation' }),
  ).toBeEnabled()
  await page.getByLabel('Synthetic incident kind').selectOption('power_failure')
  await page
    .getByRole('button', { name: 'Trigger incident', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Acknowledge selected incident' }),
  ).toBeEnabled()
  await page
    .getByRole('button', { name: 'Acknowledge selected incident' })
    .click()
  await expect(
    page.getByRole('button', { name: /Power failure · acknowledged/ }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Restore selected incident' }).click()
  await expect(
    page.getByRole('button', { name: /Power failure · resolved/ }),
  ).toBeVisible()
}
export async function finish(page: Page) {
  await page.getByRole('button', { name: 'Finish simulation' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Finish run', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'View report', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'View report', exact: true }).click()
  await expect(page).toHaveURL(/\/reports\/[\da-f-]+$/)
}
export async function screenshot(page: Page, path: string) {
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.scrollTo(0, 0)
  })
  await page.screenshot({ path, fullPage: true })
}
