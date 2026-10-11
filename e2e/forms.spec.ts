import { test, expect } from '@playwright/test'
import {
  configuration,
  resetWorkspace,
  saveConfiguration,
  saveMissionFromUI,
} from './helpers'
test.beforeEach(async ({ request }) => resetWorkspace(request))

test('replace all template objectives, repeatedly add/delete, and persist the replacement draft', async ({
  page,
  request,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/mission-builder')
  await page
    .getByLabel('Mission name', { exact: true })
    .fill('Replacement objectives regression')
  await page.getByRole('button', { name: '3 · Objectives' }).click()
  const objectives = page.locator('fieldset.cg-objective')
  await expect(objectives).toHaveCount(3)
  for (let remaining = 3; remaining > 0; remaining--) {
    await objectives
      .first()
      .getByLabel('Required for mission success')
      .uncheck()
    await objectives
      .first()
      .getByRole('button', { name: 'Delete objective 1' })
      .click()
    await expect(objectives).toHaveCount(remaining - 1)
  }
  await page.getByRole('button', { name: 'Add objective', exact: true }).click()
  await expect(objectives).toHaveCount(1)
  await objectives
    .first()
    .getByLabel('Objective name', { exact: true })
    .fill('Replacement resolution')
  await objectives
    .first()
    .getByLabel('Metric', { exact: true })
    .selectOption('incidents_resolved')
  await objectives
    .first()
    .getByLabel('Threshold (count)', { exact: true })
    .fill('1')
  await page.getByRole('button', { name: 'Add objective', exact: true }).click()
  await expect(objectives).toHaveCount(2)
  await objectives
    .nth(1)
    .getByLabel('Objective name', { exact: true })
    .fill('Replacement equipment')
  await objectives
    .nth(1)
    .getByLabel('Metric', { exact: true })
    .selectOption('equipment_availability_percent')
  await objectives
    .nth(1)
    .getByLabel('Threshold (%)', { exact: true })
    .fill('70')
  // Delete a middle row and append again without disturbing the existing count metric.
  await page.getByRole('button', { name: 'Add objective', exact: true }).click()
  await objectives
    .nth(1)
    .getByRole('button', { name: 'Delete objective 2' })
    .click()
  await page.getByRole('button', { name: 'Add objective', exact: true }).click()
  await expect(objectives).toHaveCount(3)
  await expect(
    objectives.first().getByLabel('Metric', { exact: true }),
  ).toHaveValue('incidents_resolved')
  await expect(
    objectives.first().getByLabel('Threshold (count)', { exact: true }),
  ).toHaveValue('1')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const created = await saveMissionFromUI(page)
  const mission = await (
    await request.get(`/api/v1/missions/${created.id}`)
  ).json()
  expect(mission.objectives).toHaveLength(3)
  expect(
    new Set(mission.objectives.map((objective: { id: string }) => objective.id))
      .size,
  ).toBe(3)
  expect(mission.objectives[0].name).toBe('Replacement resolution')
  await page.goto(`/mission-builder/${created.id}`)
  await page.reload()
  await page.getByRole('button', { name: '3 · Objectives' }).click()
  await expect(
    objectives.first().getByLabel('Objective name', { exact: true }),
  ).toHaveValue('Replacement resolution')
  expect(errors).toEqual([])
})
test('numeric boundaries, blank fields, and error focus', async ({ page }) => {
  await page.goto('/mission-builder')
  const duration = page.getByLabel('Duration (seconds)', { exact: true })
  for (const invalid of ['', '59', '86401', '60.5']) {
    await duration.fill(invalid)
    await page.getByRole('button', { name: 'Next step' }).click()
    await expect(duration).toHaveAttribute('aria-invalid', 'true')
    await expect(duration).toBeFocused()
  }
  await duration.fill('21600')
  await page.getByRole('button', { name: 'Next step' }).click()
  const teams = page.getByLabel('Support team count (count)', { exact: true })
  for (const invalid of ['', '0', '11', '1.5']) {
    await teams.fill(invalid)
    await page.getByRole('button', { name: 'Next step' }).click()
    await expect(teams).toHaveAttribute('aria-invalid', 'true')
  }
  await teams.fill('4')
  const weather = page.getByLabel('Weather severity (%)', { exact: true })
  for (const invalid of ['', '-1', '101']) {
    await weather.fill(invalid)
    await page.getByRole('button', { name: 'Next step' }).click()
    await expect(weather).toHaveAttribute('aria-invalid', 'true')
  }
  await weather.fill('85')
  await page.getByRole('button', { name: 'Next step' }).click()
  await expect(
    page.getByRole('heading', { name: 'Measurable objectives' }),
  ).toBeVisible()
})
test('objective bounds, last required protection, and switching deadline clears payload', async ({
  page,
  request,
}) => {
  const config = await configuration(request, 'Objective validation'),
    mission = await saveConfiguration(request, config)
  await page.goto(`/objectives/${mission.id}`)
  const objectives = page.locator('fieldset.cg-objective')
  await expect(
    objectives.nth(0).getByRole('button', { name: 'Delete objective 1' }),
  ).toBeDisabled()
  await objectives
    .nth(0)
    .getByLabel('Threshold (count)', { exact: true })
    .fill('1.5')
  await page.getByRole('button', { name: 'Save objectives' }).click()
  await expect(
    page.getByText('Count thresholds must be integers.'),
  ).toBeVisible()
  await objectives
    .nth(0)
    .getByLabel('Threshold (count)', { exact: true })
    .fill('1')
  await objectives
    .nth(0)
    .getByLabel('Evaluation mode', { exact: true })
    .selectOption('deadline')
  await objectives
    .nth(0)
    .getByLabel('Deadline (seconds)', { exact: true })
    .fill('601')
  await page.getByRole('button', { name: 'Save objectives' }).click()
  await expect(
    page.getByText('Deadline cannot exceed mission duration.'),
  ).toBeVisible()
  await objectives
    .nth(0)
    .getByLabel('Evaluation mode', { exact: true })
    .selectOption('final')
  await expect(
    objectives.nth(0).getByLabel('Deadline (seconds)', { exact: true }),
  ).toHaveCount(0)
  await objectives.nth(0).getByLabel('Required for mission success').uncheck()
  await page.getByRole('button', { name: 'Save objectives' }).click()
  await expect(
    page.getByText('At least one objective must be required.'),
  ).toBeVisible()
  await objectives.nth(0).getByLabel('Required for mission success').check()
  await objectives
    .nth(0)
    .getByLabel('Objective name', { exact: true })
    .fill('Updated via objective API')
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith(`/objectives/${mission.objectives[0].id}`) &&
      result.request().method() === 'PUT' &&
      result.ok(),
  )
  await page.getByRole('button', { name: 'Save objectives' }).click()
  await response
  const saved = await (
    await request.get(`/api/v1/missions/${mission.id}`)
  ).json()
  expect(saved.objectives[0].deadline_seconds).toBeNull()
  expect(saved.objectives[0].id).toBe(mission.objectives[0].id)
})
test('team regeneration and scalar metadata persist; server errors preserve drafts', async ({
  page,
  request,
}) => {
  const config = await configuration(request, 'Team regeneration')
  config.parameters.custom_metadata = {
    text: 'fictional',
    flag: true,
    number: 4.2,
    nothing: null,
  }
  const mission = await saveConfiguration(request, config)
  await page.goto(`/mission-builder/${mission.id}`)
  await page.getByRole('button', { name: '2 · Operational conditions' }).click()
  await page.getByLabel('Support team count (count)', { exact: true }).fill('6')
  await expect(
    page.getByLabel('Custom metadata (JSON scalar object)', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByText('no numerical effects and is never executed.', {
      exact: false,
    }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  let submitted: Record<string, unknown> | undefined
  await page.route(`**/api/v1/missions/${mission.id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    submitted = route.request().postDataJSON()
    await route.fulfill({
      status: 422,
      json: {
        detail: [
          {
            loc: ['body', 'parameters', 'resource_level'],
            msg: 'Fixture resource validation error',
            type: 'value_error',
          },
        ],
      },
    })
  })
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(
    page.getByText('Fixture resource validation error', { exact: true }),
  ).toBeVisible()
  expect(submitted?.support_teams).toEqual([])
  await expect(
    page.getByLabel('Support team count (count)', { exact: true }),
  ).toHaveValue('6')
  await page.unroute(`**/api/v1/missions/${mission.id}`)
  const savedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/missions/${mission.id}`) &&
      response.request().method() === 'PUT' &&
      response.ok(),
  )
  await saveMissionFromUI(page)
  await savedResponse
  await page.goto(`/mission-builder/${mission.id}`)
  await page.reload()
  await page.getByRole('button', { name: '2 · Operational conditions' }).click()
  await expect(
    page.getByLabel('Support team count (count)', { exact: true }),
  ).toHaveValue('6')
  const saved = await (
    await request.get(`/api/v1/missions/${mission.id}`)
  ).json()
  expect(saved.support_teams).toHaveLength(6)
  expect(saved.id).toBe(mission.id)
  expect(saved.parameters.custom_metadata).toEqual({
    text: 'fictional',
    flag: true,
    number: 4.2,
    nothing: null,
  })
  // A second count edit must use the newly saved configuration as its baseline.
  await page.getByLabel('Support team count (count)', { exact: true }).fill('4')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const secondResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/missions/${mission.id}`) &&
      response.request().method() === 'PUT' &&
      response.ok(),
  )
  await saveMissionFromUI(page)
  await secondResponse
  expect(
    (await (await request.get(`/api/v1/missions/${mission.id}`)).json())
      .support_teams,
  ).toHaveLength(4)
})
test('clone generates fresh identities; dirty navigation requires explicit discard', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Clone source'),
  )
  await page.goto(`/mission-builder?clone=${mission.id}`)
  await expect(page.getByLabel('Mission name', { exact: true })).toHaveValue(
    `${mission.name} — copy`,
  )
  await page.getByLabel('Mission name', { exact: true }).fill('Unsaved clone')
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Dashboard', exact: true })
    .click()
  await expect(
    page.getByRole('dialog', { name: 'Discard unsaved changes?' }),
  ).toBeVisible()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await expect(page.getByLabel('Mission name', { exact: true })).toHaveValue(
    'Unsaved clone',
  )
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const clonedId = (await saveMissionFromUI(page)).id
  expect(clonedId).not.toBe(mission.id)
  const cloned = await (
    await request.get(`/api/v1/missions/${clonedId}`)
  ).json()
  expect(
    cloned.objectives.every(
      (o: { id: string }) => !mission.objectives.some((old) => old.id === o.id),
    ),
  ).toBe(true)
  expect(
    cloned.facilities.every(
      (f: { id: string }) => !mission.facilities.some((old) => old.id === f.id),
    ),
  ).toBe(true)
})

test('coordinated required-objective swap saves atomically through the real mission endpoint', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Required swap'),
  )
  const writes: string[] = []
  page.on('request', (req) => {
    if (['PUT', 'POST', 'DELETE'].includes(req.method())) writes.push(req.url())
  })
  await page.goto(`/objectives/${mission.id}`)
  const objectives = page.locator('fieldset.cg-objective')
  await objectives.nth(1).getByLabel('Required for mission success').check()
  await objectives.nth(0).getByLabel('Required for mission success').uncheck()
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith(`/missions/${mission.id}`) &&
      result.request().method() === 'PUT' &&
      result.ok(),
  )
  await page.getByRole('button', { name: 'Save objectives' }).click()
  await response
  expect(writes).toEqual([
    new URL(`/api/v1/missions/${mission.id}`, page.url()).href,
  ])
  const saved = await (
    await request.get(`/api/v1/missions/${mission.id}`)
  ).json()
  expect(
    saved.objectives.map((o: { required: boolean }) => o.required),
  ).toEqual([false, true])
  expect(saved.objectives.map((o: { id: string }) => o.id)).toEqual(
    mission.objectives.map((o) => o.id),
  )
})

test('saved objective deletion and addition preserve the remaining IDs through real objective endpoints', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Saved replacement'),
  )
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/objectives/${mission.id}`)
  const objectives = page.locator('fieldset.cg-objective')
  await objectives
    .nth(1)
    .getByRole('button', { name: 'Delete objective 2' })
    .click()
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/objectives/${mission.objectives[1].id}`) &&
      response.request().method() === 'DELETE' &&
      response.status() === 204,
  )
  await page.getByRole('button', { name: 'Save objectives' }).click()
  await deleted
  await expect(
    page.getByText('Configuration saved to the backend.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Add objective', exact: true }).click()
  await expect(objectives).toHaveCount(2)
  await objectives
    .nth(1)
    .getByLabel('Objective name', { exact: true })
    .fill('New saved elapsed goal')
  await objectives
    .nth(1)
    .getByLabel('Metric', { exact: true })
    .selectOption('elapsed_time_seconds')
  await objectives
    .nth(1)
    .getByLabel('Threshold (seconds)', { exact: true })
    .fill('120')
  const added = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/missions/${mission.id}/objectives`) &&
      response.request().method() === 'POST' &&
      response.ok(),
  )
  await page.getByRole('button', { name: 'Save objectives' }).click()
  await added
  await expect(
    page.getByText('Configuration saved to the backend.'),
  ).toBeVisible()
  const saved = await (
    await request.get(`/api/v1/missions/${mission.id}`)
  ).json()
  expect(saved.objectives[0].id).toBe(mission.objectives[0].id)
  expect(saved.objectives[1].id).not.toBe(mission.objectives[1].id)
  expect(saved.objectives[1].name).toBe('New saved elapsed goal')
  await objectives
    .first()
    .getByRole('button', { name: 'Delete objective 1' })
    .click()
  const removedFirst = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/objectives/${mission.objectives[0].id}`) &&
      response.request().method() === 'DELETE' &&
      response.status() === 204,
  )
  await page.getByRole('button', { name: 'Save objectives' }).click()
  await removedFirst
  await page.reload()
  await expect(objectives).toHaveCount(1)
  await expect(
    objectives.first().getByLabel('Objective name', { exact: true }),
  ).toHaveValue('New saved elapsed goal')
  await expect(
    objectives.first().getByLabel('Metric', { exact: true }),
  ).toHaveValue('elapsed_time_seconds')
  await expect(
    objectives.first().getByLabel('Threshold (seconds)', { exact: true }),
  ).toHaveValue('120')
  expect(errors).toEqual([])
})
