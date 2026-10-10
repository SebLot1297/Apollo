import { test, expect, type WebSocketRoute } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  configuration,
  createRun,
  resetWorkspace,
  saveConfiguration,
} from './helpers'
import type { MissionState } from '../frontend/src/types/mission'
test.beforeEach(async ({ request }) => resetWorkspace(request))
const frame = (state: MissionState, type = 'update') =>
  JSON.stringify({ type, sequence: state.sequence, state })

test('telemetry deduplicates by last confirmed time for plotting and retains the complete source', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { plotSamples } = await import('/src/services/history.ts')
    const history = Array.from({ length: 605 }, (_, i) => ({
      simulated_time_seconds: i,
      metrics: { communication_uptime_percent: i % 100 },
      systems: {},
    }))
    history.push({
      ...history[604],
      metrics: { communication_uptime_percent: 88 },
    })
    const plotted = plotSamples(history)
    return {
      plotted: plotted.length,
      first: plotted[0].simulated_time_seconds,
      last: plotted.at(-1)?.metrics.communication_uptime_percent,
      source: history.length,
      originalValue: history[604].metrics.communication_uptime_percent,
    }
  })
  expect(result).toEqual({
    plotted: 600,
    first: 5,
    last: 88,
    source: 606,
    originalValue: 4,
  })
})

test('sequence gate covers cache structuralSharing, updater writes, and independent runs', async ({
  page,
  request,
}) => {
  const base = await createRun(
    request,
    await saveConfiguration(
      request,
      await configuration(request, 'Cache ordering'),
    ),
  )
  await page.goto('/')
  const result = await page.evaluate(
    async ({ base, secondId }) => {
      const { createQueryClient } = await import('/src/services/client.ts')
      const { cacheState, keys, runOptions } =
        await import('/src/services/queries.ts')
      const { acceptState, parseFrame } = await import('/src/services/state.ts')
      const client = createQueryClient()
      const newer = { ...base, sequence: 100, elapsed_time_seconds: 20 }
      cacheState(client, base.run_id, newer)
      await client.fetchQuery({
        ...runOptions(base.run_id, client),
        queryFn: async () => ({ ...base, sequence: 5 }),
        staleTime: 0,
      })
      const afterREST = client.getQueryData(
        keys.run(base.run_id),
      ) as typeof base
      cacheState(client, base.run_id, { ...base, sequence: 3 })
      const afterCommand = client.getQueryData(
        keys.run(base.run_id),
      ) as typeof base
      cacheState(client, secondId, { ...base, run_id: secondId, sequence: 1 })
      const second = client.getQueryData(keys.run(secondId)) as typeof base
      const rejects = [
        { ...newer, sequence: -1 },
        { ...newer, sequence: 1.5 },
        { ...newer, sequence: NaN },
        { ...newer, run_id: secondId },
        { ...newer, systems: {} },
      ].every(
        (candidate) =>
          acceptState(afterREST, candidate, base.run_id) === afterREST,
      )
      const duplicate =
        acceptState(
          afterREST,
          { ...newer, elapsed_time_seconds: 0 },
          base.run_id,
        ) === afterREST
      const malformed = [
        { type: 'unknown', sequence: 100, state: newer },
        { type: 'update', sequence: 101, state: newer },
        {
          type: 'snapshot',
          sequence: 100,
          state: { ...newer, run_id: secondId },
        },
      ].every((candidate) => parseFrame(candidate, base.run_id) === null)
      const unmounted = createQueryClient()
      unmounted.setQueryData(keys.runs, [{ ...newer, sequence: 200 }])
      cacheState(unmounted, base.run_id, { ...base, sequence: 60 })
      const listed = (
        unmounted.getQueryData(keys.run(base.run_id)) as typeof base
      ).sequence
      unmounted.clear()
      client.clear()
      return {
        rest: afterREST.sequence,
        command: afterCommand.sequence,
        second: second.sequence,
        rejects,
        duplicate,
        malformed,
        listed,
      }
    },
    { base, secondId: randomUUID() },
  )
  expect(result).toEqual({
    rest: 100,
    command: 100,
    second: 1,
    rejects: true,
    duplicate: true,
    malformed: true,
    listed: 200,
  })
})

test('newer WebSocket state survives delayed REST, duplicate/older/wrong-run/malformed frames', async ({
  page,
  request,
}) => {
  const base = await createRun(
    request,
    await saveConfiguration(
      request,
      await configuration(request, 'WS ordering'),
    ),
  )
  const newer: MissionState = {
    ...base,
    sequence: 40,
    status: 'running',
    elapsed_time_seconds: 40,
    systems: { ...base.systems, resource_level: 80 },
  }
  let websocket!: WebSocketRoute, release!: () => void
  const delay = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**/api/v1/simulations/${base.run_id}`, async (route) => {
    await delay
    await route.fulfill({
      json: {
        ...base,
        sequence: 10,
        systems: { ...base.systems, resource_level: 10 },
      },
    })
  })
  await page.routeWebSocket(`**/simulations/${base.run_id}/stream`, (ws) => {
    websocket = ws
    ws.send(frame(newer, 'snapshot'))
  })
  await page.goto(`/mission-control/${base.run_id}`)
  await expect(page.getByTestId('resource_level')).toHaveText('80%')
  const received = page.waitForResponse((response) =>
    response.url().endsWith(`/simulations/${base.run_id}`),
  )
  release()
  await received
  websocket.send(
    frame({ ...newer, systems: { ...newer.systems, resource_level: 1 } }),
  )
  websocket.send(
    frame({
      ...newer,
      sequence: 30,
      systems: { ...newer.systems, resource_level: 2 },
    }),
  )
  websocket.send(frame({ ...newer, run_id: randomUUID(), sequence: 400 }))
  websocket.send(
    JSON.stringify({
      type: 'update',
      sequence: 900,
      state: { run_id: base.run_id, sequence: 900 },
    }),
  )
  websocket.send(
    JSON.stringify({
      type: 'update',
      sequence: 901,
      state: { ...newer, sequence: 902 },
    }),
  )
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
  await expect(page.getByTestId('resource_level')).toHaveText('80%')
  await expect(page.getByLabel('Run overview')).toContainText('Sequence 40')
})

test('commands double-click once, retry original key, and assign a new key for a deliberate next action', async ({
  page,
  request,
}) => {
  const base = await createRun(
    request,
    await saveConfiguration(
      request,
      await configuration(request, 'Command retries'),
    ),
  )
  const running: MissionState = { ...base, status: 'running', sequence: 50 }
  const bodies: Record<string, unknown>[] = []
  await page.routeWebSocket(`**/simulations/${base.run_id}/stream`, (ws) =>
    ws.send(frame(running, 'snapshot')),
  )
  await page.route(
    `**/api/v1/simulations/${base.run_id}/commands`,
    async (route) => {
      bodies.push(route.request().postDataJSON())
      if (bodies.length === 1) {
        await new Promise((resolve) => setTimeout(resolve, 300))
        await route.abort('timedout')
        return
      }
      await route.fulfill({
        json: {
          ...running,
          sequence: 50 + bodies.length,
          status: bodies.length === 2 ? 'paused' : 'running',
        },
      })
    },
  )
  await page.goto(`/mission-control/${base.run_id}`)
  await expect(
    page.getByRole('button', { name: 'Pause simulation' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Pause simulation' }).dblclick()
  await expect(
    page.getByRole('button', { name: 'Retry same action' }),
  ).toBeEnabled()
  expect(bodies).toHaveLength(1)
  await page.getByRole('button', { name: 'Retry same action' }).click()
  await expect(
    page.getByRole('button', { name: 'Resume simulation' }),
  ).toBeEnabled()
  expect(bodies[0]).toEqual(bodies[1])
  expect(Object.keys(bodies[0]).sort()).toEqual([
    'command_type',
    'idempotency_key',
    'payload',
  ])
  await page.getByRole('button', { name: 'Resume simulation' }).click()
  await expect(
    page.getByRole('button', { name: 'Pause simulation' }),
  ).toBeEnabled()
  expect(bodies[2].idempotency_key).not.toBe(bodies[1].idempotency_key)
})

test('old idempotent command response cannot overwrite a newer live state', async ({
  page,
  request,
}) => {
  const base = await createRun(
    request,
    await saveConfiguration(
      request,
      await configuration(request, 'Old command'),
    ),
  )
  const newer: MissionState = {
    ...base,
    status: 'running',
    sequence: 80,
    systems: { ...base.systems, resource_level: 88 },
  }
  await page.routeWebSocket(`**/simulations/${base.run_id}/stream`, (ws) =>
    ws.send(frame(newer, 'snapshot')),
  )
  await page.route(`**/api/v1/simulations/${base.run_id}/commands`, (route) =>
    route.fulfill({
      json: {
        ...base,
        status: 'paused',
        sequence: 60,
        systems: { ...base.systems, resource_level: 22 },
      },
    }),
  )
  await page.goto(`/mission-control/${base.run_id}`)
  await expect(
    page.getByRole('button', { name: 'Pause simulation' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Pause simulation' }).click()
  await expect(page.getByText(/pause confirmed by the server/)).toBeVisible()
  await expect(page.getByTestId('resource_level')).toHaveText('88%')
  await expect(
    page.getByRole('button', { name: 'Pause simulation' }),
  ).toBeEnabled()
})

test('transport handles 204, validation details, 404/409/429/503, abort, timeout, and immutable requests', async ({
  page,
}) => {
  await page.route('**/api/v1/transport-*', async (route) => {
    const kind = route.request().url().split('transport-')[1]
    if (kind === 'empty') return route.fulfill({ status: 204 })
    if (kind === 'delay') {
      await new Promise((resolve) => setTimeout(resolve, 100))
      await route.fulfill({ json: {} }).catch(() => {})
      return
    }
    const status = Number(kind)
    return route.fulfill({
      status,
      headers: status === 429 ? { 'Retry-After': '2' } : {},
      json: {
        detail:
          status === 422
            ? [
                {
                  loc: ['body', 'name'],
                  msg: 'Blank name',
                  type: 'value_error',
                },
              ]
            : `Fixture ${status}`,
      },
    })
  })
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { request, ApiError } = await import('/src/services/api.ts')
    const { newAction } = await import('/src/services/commands.ts')
    const empty = await request('/transport-empty', { method: 'DELETE' })
    const errors = []
    for (const status of [404, 409, 422, 429, 503]) {
      try {
        await request(`/transport-${status}`)
      } catch (error) {
        const result = error as InstanceType<typeof ApiError>
        errors.push({
          status: result.status,
          fields: result.fields.length,
          retry: result.retryAfter,
        })
      }
    }
    let unknown = false
    try {
      await request('/transport-delay', {
        method: 'POST',
        body: {},
        timeout: 10,
      })
    } catch (error) {
      unknown = (error as InstanceType<typeof ApiError>).outcomeUnknown
    }
    const controller = new AbortController()
    controller.abort()
    let aborted = false
    try {
      await request('/transport-delay', { signal: controller.signal })
    } catch (error) {
      aborted = (error as Error).name === 'AbortError'
    }
    const input = { nested: { value: 1 } },
      action = newAction(crypto.randomUUID(), 'pause', input)
    input.nested.value = 2
    return {
      empty: empty === undefined,
      errors,
      unknown,
      aborted,
      immutable:
        Object.isFrozen(action) &&
        Object.isFrozen(action.payload) &&
        Object.isFrozen(action.payload.nested),
      preserved: (action.payload.nested as { value: number }).value,
    }
  })
  expect(results.empty).toBe(true)
  expect(results.unknown).toBe(true)
  expect(results.aborted).toBe(true)
  expect(results.immutable).toBe(true)
  expect(results.preserved).toBe(1)
  expect(results.errors).toEqual([
    { status: 404, fields: 0, retry: 0 },
    { status: 409, fields: 0, retry: 0 },
    { status: 422, fields: 1, retry: 0 },
    { status: 429, fields: 0, retry: 2 },
    { status: 503, fields: 0, retry: 0 },
  ])
})
