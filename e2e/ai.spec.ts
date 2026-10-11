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
import type { AIEnvelope, Report } from '../frontend/src/types/mission'
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
test('raced fixture 503 and 429 preserve assistant messages, respect Retry-After, and never auto-retry inference', async ({
  page,
  request,
}) => {
  let calls = 0
  await page.route('**/api/v1/ai/providers/status', (route) =>
    route.fulfill({ json: available }),
  )
  await page.route('**/api/v1/ai/chat', (route) => {
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
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Assistant retry'),
  )
  const run = await createRun(request, mission)
  await page.goto(`/mission-control/${run.run_id}`)
  await page
    .getByLabel('Assistant message', { exact: false })
    .fill('Keep this prompt')
  await page.getByRole('button', { name: 'Ask assistant' }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Raced AI service unavailable',
  )
  await expect(
    page.getByLabel('Assistant message', { exact: false }),
  ).toHaveValue('Keep this prompt')
  await page.getByRole('button', { name: 'Ask assistant' }).click()
  await expect(page.getByText(/Respecting Retry-After/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Ask assistant' }),
  ).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Ask assistant' })).toBeEnabled(
    { timeout: 3000 },
  )
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
