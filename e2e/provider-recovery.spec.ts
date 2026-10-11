import { test, expect } from '@playwright/test'
import {
  configuration,
  createRun,
  resetWorkspace,
  saveConfiguration,
} from './helpers'

test('configured Gemini recovers after a failed probe without manual refresh', async ({
  page,
  request,
}) => {
  let probes = 0
  let recovered = false
  await page.route('**/api/v1/ai/providers/status', (route) => {
    probes++
    return route.fulfill({
      json: [
        {
          provider: 'gemini',
          model: 'fixture-model',
          configured: true,
          available: recovered,
          detail: recovered
            ? 'Model metadata reachable; inference unverified'
            : 'Health probe failed: timeout; inference unverified',
        },
      ],
    })
  })
  await resetWorkspace(request)
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Provider recovery'),
  )
  const run = await createRun(request, mission)
  await page.goto(`/mission-control/${run.run_id}`)
  await page
    .getByRole('combobox', { name: 'AI provider', exact: true })
    .selectOption('gemini')
  await page
    .getByLabel('Assistant message', { exact: false })
    .fill('Create a fictional exercise')
  const generate = page.getByRole('button', {
    name: 'Ask assistant',
  })
  await expect(generate).toBeDisabled()
  const initialProbes = probes
  recovered = true
  await expect(generate).toBeEnabled({ timeout: 20000 })
  expect(probes).toBeGreaterThan(initialProbes)
})
