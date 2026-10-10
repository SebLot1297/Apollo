import { test, expect } from '@playwright/test'
import { configuration, resetWorkspace, saveConfiguration } from './helpers'
test.beforeEach(async ({ request }) => resetWorkspace(request))
test('numeric boundaries, blank fields, invalid metadata, and error focus', async ({
  page,
}) => {
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
  for (const invalid of [
    '{"nested":{"x":1}}',
    '{"array":[1]}',
    '{"number":1e999}',
    'broken JSON',
  ]) {
    await page
      .getByLabel('Custom metadata (JSON scalar object)', { exact: true })
      .fill(invalid)
    await page.getByRole('button', { name: 'Next step' }).click()
    await expect(
      page.getByLabel('Custom metadata (JSON scalar object)', { exact: true }),
    ).toHaveAttribute('aria-invalid', 'true')
  }
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
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Team regeneration'),
  )
  await page.goto(`/mission-builder/${mission.id}`)
  await page.getByRole('button', { name: '2 · Operational conditions' }).click()
  await page.getByLabel('Support team count (count)', { exact: true }).fill('6')
  await page
    .getByLabel('Custom metadata (JSON scalar object)', { exact: true })
    .fill('{"text":"fictional","flag":true,"number":4.2,"nothing":null}')
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
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await savedResponse
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
  // A second count edit in the same mounted form must use the newly saved baseline.
  await page.getByLabel('Support team count (count)', { exact: true }).fill('4')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const secondResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/missions/${mission.id}`) &&
      response.request().method() === 'PUT' &&
      response.ok(),
  )
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
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
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-builder\/[\da-f-]+$/)
  const clonedId = page.url().split('/').at(-1)!
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
    `http://127.0.0.1:5173/api/v1/missions/${mission.id}`,
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
