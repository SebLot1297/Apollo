import { test, expect } from '@playwright/test'
import {
  configuration,
  resetWorkspace,
  saveConfiguration,
  command,
  launch,
  finish,
} from './helpers'
import type { Report } from '../frontend/src/types/mission'

test.beforeEach(async ({ request }) => resetWorkspace(request))

test('real mock explanations and report narrative persist without changing numerical state', async ({
  page,
  request,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Real mock narrative'),
  )
  const runId = await launch(page, mission)
  await page.getByRole('button', { name: 'Start simulation' }).click()
  await command(request, runId, 'trigger_incident', { kind: 'power_failure' })
  await page.getByRole('button', { name: 'Pause simulation' }).click()
  await expect(
    page.getByRole('button', { name: 'Resume simulation' }),
  ).toBeEnabled()
  const paused = await (
    await request.get(`/api/v1/simulations/${runId}`)
  ).json()
  await page
    .getByRole('combobox', { name: 'AI provider', exact: true })
    .selectOption('mock')
  await page.getByRole('button', { name: 'Explain selected incident' }).click()
  await expect(
    page.getByText('Model: deterministic-demo-v1', { exact: true }),
  ).toBeVisible()
  await page
    .getByLabel('Assistant message')
    .fill('Explain the recorded metrics and objective evidence')
  await page.getByRole('button', { name: 'Ask assistant' }).click()
  await expect(page.getByText('DEMO/MOCK', { exact: true })).toHaveCount(2)
  const afterChat = await (
    await request.get(`/api/v1/simulations/${runId}`)
  ).json()
  expect(afterChat.metrics).toEqual(paused.metrics)
  expect(afterChat.sequence).toBe(paused.sequence)
  expect(afterChat.command_history).toEqual(paused.command_history)
  await command(request, runId, 'acknowledge_incident', {
    incident_id: paused.incidents.at(-1).id,
  })
  await command(request, runId, 'restore_service', {
    incident_id: paused.incidents.at(-1).id,
  })
  await expect(
    page
      .getByTestId('incident-inspector')
      .getByRole('heading', { name: 'No active incidents' }),
  ).toBeVisible()
  await finish(page)
  const before = (await (
    await request.get(`/api/v1/reports/${runId}`)
  ).json()) as Report
  expect(before.success).toBe(true)
  expect(before.ai_analysis).toBeNull()
  await page
    .getByRole('combobox', { name: 'AI provider', exact: true })
    .selectOption('mock')
  await page.getByRole('button', { name: 'Generate report narrative' }).click()
  await expect(page.getByText('DEMO/MOCK', { exact: true })).toBeVisible()
  await expect(page.getByTestId('numerical-summary')).toHaveText(before.summary)
  await page.reload()
  await expect(
    page.getByText('Model: deterministic-demo-v1', { exact: true }),
  ).toBeVisible()
  const after = (await (
    await request.get(`/api/v1/reports/${runId}`)
  ).json()) as Report
  expect(after.ai_analysis?.provider).toBe('mock')
  expect(after.ai_analysis?.mock).toBe(true)
  expect(after.ai_analysis?.data.text).toContain(
    'Deterministic demo explanation',
  )
  const { ai_analysis: _beforeAnalysis, ...beforeNumbers } = before
  const { ai_analysis: _afterAnalysis, ...afterNumbers } = after
  expect(afterNumbers).toEqual(beforeNumbers)
  expect(errors).toEqual([])
})
