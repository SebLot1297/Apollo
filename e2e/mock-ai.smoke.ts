import { test, expect } from '@playwright/test'
import {
  configuration,
  resetWorkspace,
  saveConfiguration,
  saveMissionFromUI,
  launch,
  startAndResolvePower,
  finish,
} from './helpers'
import type {
  AIEnvelope,
  MissionConfiguration,
  Report,
} from '../frontend/src/types/mission'

test.beforeEach(async ({ request }) => resetWorkspace(request))

test('real mock mission and objective proposals require review, Apply and separate persistent Save', async ({
  page,
  request,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const originalCount = (await (await request.get('/api/v1/missions')).json())
    .length
  await page.goto('/mission-builder')
  await page
    .getByRole('combobox', { name: 'AI provider', exact: true })
    .selectOption('mock')
  await page
    .getByLabel('Proposal prompt', { exact: true })
    .fill('Fictional communications recovery smoke test')
  const generatedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/ai/generate-mission') && response.ok(),
  )
  await page.getByRole('button', { name: 'Generate mission proposal' }).click()
  const generated = (await (
    await generatedResponse
  ).json()) as AIEnvelope<MissionConfiguration>
  expect(generated.provider).toBe('mock')
  expect(generated.mock).toBe(true)
  await expect(page.getByText('DEMO/MOCK', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Model: deterministic-demo-v1', { exact: true }),
  ).toBeVisible()
  expect((await (await request.get('/api/v1/missions')).json()).length).toBe(
    originalCount,
  )
  await page.getByRole('button', { name: 'Discard proposal' }).click()
  await expect(page.getByLabel('Mission name', { exact: true })).toHaveValue(
    'Operation Signal Restore',
  )
  await page.getByRole('button', { name: 'Generate mission proposal' }).click()
  await page.getByRole('button', { name: 'Apply proposal to draft' }).click()
  await expect(page.getByLabel('Mission name', { exact: true })).toHaveValue(
    generated.data.name,
  )
  expect((await (await request.get('/api/v1/missions')).json()).length).toBe(
    originalCount,
  )
  await page
    .getByLabel('Mission name', { exact: true })
    .fill('Reviewed real mock proposal')
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const missionId = (await saveMissionFromUI(page)).id
  const saved = (await (
    await request.get(`/api/v1/missions/${missionId}`)
  ).json()) as MissionConfiguration
  expect(saved.id).not.toBe(generated.data.id)
  expect(saved.name).toBe('Reviewed real mock proposal')
  expect(saved.objectives).toHaveLength(2)
  await page.goto(`/mission-builder/${missionId}`)
  await page.reload()
  await page
    .getByRole('combobox', { name: 'AI provider', exact: true })
    .selectOption('mock')
  await page
    .getByLabel('Proposal prompt', { exact: true })
    .fill('Suggest two measurable objectives for this saved mission')
  const objectivesResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/ai/generate-objectives') && response.ok(),
  )
  await page
    .getByRole('button', { name: 'Generate objective proposals' })
    .click()
  const proposedObjectives = await objectivesResponse
  expect(proposedObjectives.request().postDataJSON().mission_id).toBe(saved.id)
  await expect(
    page.getByRole('button', { name: 'Append selected objectives' }),
  ).toBeDisabled()
  await page.getByLabel(/Select suggestion 1:/).check()
  await page.getByLabel(/Select suggestion 2:/).check()
  await page.getByRole('button', { name: 'Append selected objectives' }).click()
  expect(
    (await (await request.get(`/api/v1/missions/${missionId}`)).json())
      .objectives,
  ).toHaveLength(2)
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const updatedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/missions/${missionId}`) &&
      response.request().method() === 'PUT' &&
      response.ok(),
  )
  await saveMissionFromUI(page)
  await updatedResponse
  const updated = (await (
    await request.get(`/api/v1/missions/${missionId}`)
  ).json()) as MissionConfiguration
  expect(updated.objectives).toHaveLength(4)
  expect(
    updated.objectives.slice(0, 2).map((objective) => objective.id),
  ).toEqual(saved.objectives.map((objective) => objective.id))
  expect(
    new Set(updated.objectives.map((objective) => objective.id)).size,
  ).toBe(4)
  await page.goto(`/mission-builder/${missionId}`)
  await page.reload()
  await page.getByRole('button', { name: '3 · Objectives' }).click()
  await expect(page.locator('fieldset.cg-objective')).toHaveCount(4)
  expect(errors).toEqual([])
})

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
  await startAndResolvePower(page)
  await page.getByRole('button', { name: 'Pause simulation' }).click()
  await expect(
    page.getByRole('button', { name: 'Resume simulation' }),
  ).toBeEnabled()
  const paused = await (
    await request.get(`/api/v1/simulations/${runId}`)
  ).json()
  await page.getByRole('button', { name: /Power failure · resolved/ }).click()
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

test('real unsaved objective requests omit mission identity and add only selected fresh objectives', async ({
  page,
  request,
}) => {
  await page.goto('/mission-builder')
  await page
    .getByRole('combobox', { name: 'AI provider', exact: true })
    .selectOption('mock')
  await page
    .getByLabel('Proposal prompt', { exact: true })
    .fill('Suggest measurable objectives for this unsaved configuration')
  const response = page.waitForResponse(
    (result) => result.url().endsWith('/ai/generate-objectives') && result.ok(),
  )
  await page
    .getByRole('button', { name: 'Generate objective proposals' })
    .click()
  const result = await response,
    body = result.request().postDataJSON()
  expect(body.mission_id).toBeUndefined()
  expect(body.prompt).toContain('Unsaved mission context:')
  await page.getByLabel(/Select suggestion 1:/).check()
  await page.getByRole('button', { name: 'Append selected objectives' }).click()
  await page.getByRole('button', { name: '4 · Review and save' }).click()
  const created = await saveMissionFromUI(page)
  const saved = await (
    await request.get(`/api/v1/missions/${created.id}`)
  ).json()
  expect(saved.objectives).toHaveLength(4)
  expect(
    new Set(saved.objectives.map((objective: { id: string }) => objective.id))
      .size,
  ).toBe(4)
})
