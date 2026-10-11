import { test, expect } from '@playwright/test'

test('separate backend receives REST requests and the live simulation socket', async ({
  page,
}) => {
  const backend = process.env.VITE_API_BASE_URL
  test.skip(
    !backend,
    'Run with VITE_API_BASE_URL pointing to the isolated test backend',
  )
  const origin = new URL(backend!).origin
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/')
  const runId = await page.evaluate(async () => {
    const { api } = await import('/src/services/api.ts')
    await api.health()
    await api.readiness()
    await api.registry()
    return (await api.createDemo()).run_id
  })
  for (const path of [
    '/health',
    '/ready',
    '/api/v1/registry',
    '/api/v1/simulations/demo',
  ]) {
    expect(requests).toContain(`${origin}${path}`)
  }
  const socket = page.waitForEvent('websocket')
  await page.evaluate(async (runId) => {
    const { createQueryClient } = await import('/src/services/client.ts')
    const { subscribeRun } = await import('/src/services/stream.ts')
    subscribeRun(createQueryClient(), runId)
  }, runId)
  expect((await socket).url()).toBe(
    `${origin.replace(/^http/, 'ws')}/api/v1/simulations/${runId}/stream`,
  )
})
