import { test, expect } from '@playwright/test'
import {
  command,
  configuration,
  createRun,
  launch,
  resetWorkspace,
  saveConfiguration,
  startAndResolvePower,
  finish,
} from './helpers'
import type {
  AIEnvelope,
  MissionConfiguration,
  Report,
} from '../frontend/src/types/mission'
test.beforeEach(async ({ request }) => resetWorkspace(request))
const available = [
  {
    provider: 'mock',
    model: 'fixture-model',
    configured: true,
    available: true,
    detail: 'Test fixture, not live inference',
  },
]
const envelope = <T>(data: T): AIEnvelope<T> => ({
  provider: 'mock',
  model: 'fixture-model',
  mock: true,
  fallback_reason: 'Test fixture',
  data,
  usage: {},
  latency_ms: 5,
})

test('actual unavailable AI leaves the real core simulation flow functional and makes no inference calls', async ({
  page,
  request,
}) => {
  const posts: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/ai/'))
      posts.push(req.url())
  })
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'AI independent'),
  )
  await launch(page, mission)
  await expect(
    page.getByText(/AI unavailable. Configure and enable/),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Ask assistant' }),
  ).toBeDisabled()
  await startAndResolvePower(page)
  await finish(page)
  await expect(page.getByText('Success', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Generate report narrative' }),
  ).toBeDisabled()
  expect(posts).toEqual([])
})
test('fixture mission proposals support edit/discard/apply and require a separate real Save', async ({
  page,
  request,
}) => {
  const generated = await configuration(request, 'AI fixture proposal')
  generated.name = 'Reviewed AI mission'
  await page.route('**/api/v1/ai/providers/status', (route) =>
    route.fulfill({ json: available }),
  )
  await page.route('**/api/v1/ai/generate-mission', (route) =>
    route.fulfill({ json: envelope(generated) }),
  )
  let saves = 0
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/missions'))
      saves++
  })
  await page.goto('/mission-builder')
  await page
    .getByLabel('Proposal prompt', { exact: false })
    .fill('Propose a fictional mission')
  await page.getByRole('button', { name: 'Generate mission proposal' }).click()
  await expect(page.getByText('DEMO/MOCK', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Discard proposal' }).click()
  await expect(page.getByLabel('Mission name', { exact: true })).toHaveValue(
    'Operation Signal Restore',
  )
  expect(saves).toBe(0)
  await page.getByRole('button', { name: 'Generate mission proposal' }).click()
  const proposed = { ...generated, name: 'Edited AI proposal' }
  await page
    .getByLabel('Proposal JSON', { exact: true })
    .fill(JSON.stringify(proposed))
  await page.getByRole('button', { name: 'Apply proposal to draft' }).click()
  await expect(page.getByLabel('Mission name', { exact: true })).toHaveValue(
    'Edited AI proposal',
  )
  expect(saves).toBe(0)
  expect(
    (
      (await (
        await request.get('/api/v1/missions')
      ).json()) as MissionConfiguration[]
    ).some((m) => m.name === 'Edited AI proposal'),
  ).toBe(false)
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-builder\/[\da-f-]+$/)
  expect(saves).toBe(1)
})
test('fixture objective suggestions require selection, omit unsaved mission_id, include context, and append fresh IDs', async ({
  page,
  request,
}) => {
  const generated = (await configuration(request, 'AI objectives'))
    .objectives[0]
  let body: Record<string, unknown> = {}
  await page.route('**/api/v1/ai/providers/status', (route) =>
    route.fulfill({ json: available }),
  )
  await page.route('**/api/v1/ai/generate-objectives', (route) => {
    body = route.request().postDataJSON()
    return route.fulfill({
      json: envelope([
        generated,
        { ...generated, name: 'Duplicate ID suggestion' },
      ]),
    })
  })
  await page.goto('/mission-builder')
  await page
    .getByLabel('Proposal prompt', { exact: false })
    .fill('Suggest measurable objectives')
  await page
    .getByRole('button', { name: 'Generate objective proposals' })
    .click()
  await expect(
    page.getByRole('button', { name: 'Append selected objectives' }),
  ).toBeDisabled()
  expect(body.mission_id).toBeUndefined()
  expect(String(body.prompt)).toContain('Unsaved mission context:')
  expect(String(body.prompt).length).toBeLessThanOrEqual(8000)
  await page.getByLabel(/Select suggestion 1:/).check()
  await page.getByLabel(/Select suggestion 2:/).check()
  await page.getByRole('button', { name: 'Append selected objectives' }).click()
  await page.getByRole('button', { name: '3 · Objectives' }).click()
  await expect(page.locator('fieldset.cg-objective')).toHaveCount(5)
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await expect(page).toHaveURL(/\/mission-builder\/[\da-f-]+$/)
  const saved = (await (
    await request.get(`/api/v1/missions/${page.url().split('/').at(-1)}`)
  ).json()) as MissionConfiguration
  expect(new Set(saved.objectives.map((o) => o.id)).size).toBe(5)
  expect(saved.objectives.every((o) => o.id !== generated.id)).toBe(true)
})
test('fixture apply to an existing mission preserves mission and existing objective identities', async ({
  page,
  request,
}) => {
  const original = await saveConfiguration(
    request,
    await configuration(request, 'Existing AI target'),
  )
  const generated = await configuration(request, 'AI replacement')
  generated.name = 'AI edited existing mission'
  await page.route('**/api/v1/ai/providers/status', (route) =>
    route.fulfill({ json: available }),
  )
  await page.route('**/api/v1/ai/generate-mission', (route) =>
    route.fulfill({ json: envelope(generated) }),
  )
  await page.goto(`/mission-builder/${original.id}`)
  await page
    .getByLabel('Proposal prompt', { exact: false })
    .fill('Edit this configuration')
  await page.getByRole('button', { name: 'Generate mission proposal' }).click()
  await page.getByRole('button', { name: 'Apply proposal to draft' }).click()
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith(`/missions/${original.id}`) &&
      result.request().method() === 'PUT' &&
      result.ok(),
  )
  await page.getByRole('button', { name: 'Save mission', exact: true }).click()
  await response
  const saved = (await (
    await request.get(`/api/v1/missions/${original.id}`)
  ).json()) as MissionConfiguration
  expect(saved.id).toBe(original.id)
  expect(saved.objectives.map((o) => o.id)).toEqual(
    original.objectives.map((o) => o.id),
  )
})
test('raced fixture 503 and 429 preserve prompts, respect Retry-After, and never auto-retry inference', async ({
  page,
}) => {
  let calls = 0
  await page.route('**/api/v1/ai/providers/status', (route) =>
    route.fulfill({ json: available }),
  )
  await page.route('**/api/v1/ai/generate-mission', (route) => {
    calls++
    return route.fulfill({
      status: calls === 1 ? 503 : 429,
      headers: { 'Retry-After': '1' },
      json: {
        detail:
          calls === 1 ? 'Raced AI service unavailable' : 'Fixture rate limit',
      },
    })
  })
  await page.goto('/mission-builder')
  await page
    .getByLabel('Proposal prompt', { exact: false })
    .fill('Keep this prompt')
  await page.getByRole('button', { name: 'Generate mission proposal' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Raced AI service unavailable',
  )
  await expect(
    page.getByLabel('Proposal prompt', { exact: false }),
  ).toHaveValue('Keep this prompt')
  await page.getByRole('button', { name: 'Generate mission proposal' }).click()
  await expect(page.getByText(/Respecting Retry-After/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Generate mission proposal' }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: 'Generate mission proposal' }),
  ).toBeEnabled({ timeout: 3000 })
  expect(calls).toBe(2)
})
test('fixture report narrative provenance is separate from real unsuccessful numerical evidence', async ({
  page,
  request,
}) => {
  const config = await configuration(request, 'Narrative isolation')
  config.objectives[0].target_value = 2
  const mission = await saveConfiguration(request, config),
    run = await createRun(request, mission)
  await command(request, run.run_id, 'terminate')
  const report = (await (
    await request.get(`/api/v1/reports/${run.run_id}`)
  ).json()) as Report
  const narrative = envelope({
    text: '<img src=x onerror="window.aiInjected=true"> Fictional narrative claims success.',
  })
  let generated = false
  await page.route('**/api/v1/ai/providers/status', (route) =>
    route.fulfill({ json: available }),
  )
  await page.route('**/api/v1/ai/generate-report', (route) => {
    generated = true
    return route.fulfill({ json: narrative })
  })
  await page.route(`**/api/v1/reports/${run.run_id}`, (route) =>
    route.fulfill({
      json: { ...report, ai_analysis: generated ? narrative : null },
    }),
  )
  await page.goto(`/reports/${run.run_id}`)
  await page.getByRole('button', { name: 'Generate report narrative' }).click()
  await expect(page.getByText('DEMO/MOCK', { exact: true })).toBeVisible()
  await expect(page.getByText('Unsuccessful', { exact: true })).toBeVisible()
  await expect(page.getByTestId('numerical-summary')).toHaveText(report.summary)
  await expect(page.locator('.cg-ai-text img')).toHaveCount(0)
  expect(
    await page.evaluate(
      () => (window as unknown as { aiInjected?: boolean }).aiInjected,
    ),
  ).toBeUndefined()
  expect(
    (await (await request.get(`/api/v1/reports/${run.run_id}`)).json())
      .final_metrics,
  ).toEqual(report.final_metrics)
})

test('explicit fixture incident explanation and chat preserve paused real state and never send commands', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
      request,
      await configuration(request, 'Assistant boundary'),
    ),
    run = await createRun(request, mission)
  await command(request, run.run_id, 'start')
  const impaired = await command(request, run.run_id, 'trigger_incident', {
    kind: 'power_failure',
  })
  const paused = await command(request, run.run_id, 'pause')
  const incidentId = impaired.incidents.at(-1)!.id
  const inference: { task: string; body: Record<string, unknown> }[] = [],
    commands: string[] = []
  await page.route('**/api/v1/ai/providers/status', (route) =>
    route.fulfill({ json: available }),
  )
  for (const task of ['explain-incident', 'chat'])
    await page.route(`**/api/v1/ai/${task}`, (route) => {
      inference.push({ task, body: route.request().postDataJSON() })
      return route.fulfill({
        json: envelope({
          text: `Fixture ${task} suggests restore_service.`,
          command_type: 'restore_service',
        }),
      })
    })
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/commands'))
      commands.push(req.url())
  })
  await page.goto(`/mission-control/${run.run_id}`)
  await expect(
    page.getByRole('button', { name: 'Resume simulation' }),
  ).toBeEnabled()
  expect(inference).toEqual([])
  await page.getByRole('button', { name: 'Explain selected incident' }).click()
  await expect(
    page.getByText('Fixture explain-incident suggests restore_service.'),
  ).toBeVisible()
  await page
    .getByLabel('Assistant message')
    .fill('Explain the recorded evidence')
  await page.getByRole('button', { name: 'Ask assistant' }).click()
  await expect(
    page.getByText('Fixture chat suggests restore_service.'),
  ).toBeVisible()
  expect(inference).toEqual([
    {
      task: 'explain-incident',
      body: { run_id: run.run_id, incident_id: incidentId, provider: 'auto' },
    },
    {
      task: 'chat',
      body: {
        run_id: run.run_id,
        message: 'Explain the recorded evidence',
        provider: 'auto',
      },
    },
  ])
  expect(commands).toEqual([])
  const after = await (
    await request.get(`/api/v1/simulations/${run.run_id}`)
  ).json()
  expect(after.metrics).toEqual(paused.metrics)
  expect(after.sequence).toBe(paused.sequence)
})

test('oversized draft context and invalid fixture proposals are rejected without truncation or draft loss', async ({
  page,
  request,
}) => {
  const generated = await configuration(request, 'Invalid AI proposal')
  generated.objectives[0].target_value = 1.5
  let objectiveCalls = 0
  await page.route('**/api/v1/ai/providers/status', (route) =>
    route.fulfill({ json: available }),
  )
  await page.route('**/api/v1/ai/generate-objectives', (route) => {
    objectiveCalls++
    return route.fulfill({ json: envelope([]) })
  })
  await page.route('**/api/v1/ai/generate-mission', (route) =>
    route.fulfill({ json: envelope(generated) }),
  )
  await page.goto('/mission-builder')
  await page
    .getByLabel('Proposal prompt', { exact: true })
    .fill('x'.repeat(7900))
  await page
    .getByRole('button', { name: 'Generate objective proposals' })
    .click()
  await expect(page.getByRole('alert')).toContainText('exceeds 8000 characters')
  expect(objectiveCalls).toBe(0)
  await expect(page.getByLabel('Proposal prompt', { exact: true })).toHaveValue(
    'x'.repeat(7900),
  )
  await page
    .getByLabel('Proposal prompt', { exact: true })
    .fill('Propose a mission')
  await page.getByRole('button', { name: 'Generate mission proposal' }).click()
  await page.getByRole('button', { name: 'Apply proposal to draft' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Count thresholds must be integers',
  )
  await expect(page.getByLabel('Mission name', { exact: true })).toHaveValue(
    'Operation Signal Restore',
  )
  await expect(page.getByLabel('Proposal JSON', { exact: true })).toBeVisible()
})
