import { test, expect } from '@playwright/test'

test('configured Gemini recovers after a failed probe without manual refresh', async ({
  page,
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
  await page.goto('/mission-builder')
  await page
    .getByRole('combobox', { name: 'AI provider', exact: true })
    .selectOption('gemini')
  await page
    .getByLabel('Proposal prompt', { exact: false })
    .fill('Create a fictional exercise')
  const generate = page.getByRole('button', {
    name: 'Generate mission proposal',
  })
  await expect(generate).toBeDisabled()
  const initialProbes = probes
  recovered = true
  await expect(generate).toBeEnabled({ timeout: 20000 })
  expect(probes).toBeGreaterThan(initialProbes)
})
