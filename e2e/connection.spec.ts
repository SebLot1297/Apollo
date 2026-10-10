import { test, expect, type WebSocketRoute } from '@playwright/test'
import {
  command,
  configuration,
  createRun,
  resetWorkspace,
  saveConfiguration,
} from './helpers'
test.beforeEach(async ({ request }) => resetWorkspace(request))
test('one Strict Mode socket reconnects to a fresh snapshot without resetting sequence', async ({
  page,
  request,
}) => {
  const state = await createRun(
    request,
    await saveConfiguration(request, await configuration(request, 'Reconnect')),
  )
  const sockets: WebSocketRoute[] = []
  await page.routeWebSocket(`**/simulations/${state.run_id}/stream`, (ws) => {
    sockets.push(ws)
    const incoming = {
      ...state,
      sequence: sockets.length === 1 ? 50 : 51,
      elapsed_time_seconds: sockets.length === 1 ? 10 : 11,
    }
    ws.send(
      JSON.stringify({
        type: 'snapshot',
        sequence: incoming.sequence,
        state: incoming,
      }),
    )
  })
  await page.goto(`/mission-control/${state.run_id}`)
  await expect(page.getByLabel('Run overview')).toContainText('Sequence 50')
  expect(sockets).toHaveLength(1)
  await sockets[0].close({ code: 1012, reason: 'Fixture reconnect' })
  await expect(page.getByLabel('Run overview')).toContainText('Sequence 51')
  expect(sockets).toHaveLength(2)
  await expect(
    page.getByRole('button', { name: 'Start simulation' }),
  ).toBeEnabled()
})
test('malformed/wrong run snapshots do not establish live state or enable commands', async ({
  page,
  request,
}) => {
  const state = await createRun(
    request,
    await saveConfiguration(
      request,
      await configuration(request, 'Invalid snapshot'),
    ),
  )
  await page.routeWebSocket(`**/simulations/${state.run_id}/stream`, (ws) => {
    ws.send('not JSON')
    ws.send(
      JSON.stringify({
        type: 'snapshot',
        sequence: state.sequence,
        state: { ...state, run_id: 'wrong' },
      }),
    )
    ws.send(
      JSON.stringify({ type: 'snapshot', sequence: state.sequence + 1, state }),
    )
  })
  await page.goto(`/mission-control/${state.run_id}`)
  await expect(
    page.getByRole('button', { name: 'Start simulation' }),
  ).toBeDisabled()
  await expect(
    page.getByText(
      'Commands disabled while disconnected or awaiting a fresh snapshot.',
    ),
  ).toBeVisible()
})
test('changing run closes its prior socket', async ({ page, request }) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Run change'),
  )
  const old = await createRun(request, mission)
  await command(request, old.run_id, 'terminate')
  const current = await createRun(request, mission)
  let oldConnections = 0,
    oldClosed = 0
  await page.routeWebSocket(`**/simulations/${old.run_id}/stream`, (ws) => {
    oldConnections++
    ws.onClose(() => {
      oldClosed++
    })
    ws.send(
      JSON.stringify({ type: 'snapshot', sequence: old.sequence, state: old }),
    )
  })
  await page.goto(`/mission-control/${old.run_id}`)
  await expect.poll(() => oldConnections).toBe(1)
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Mission Control', exact: true })
    .click()
  await page
    .getByRole('link', { name: new RegExp(current.run_id.slice(0, 8)) })
    .click()
  await expect(page).toHaveURL(new RegExp(current.run_id))
  await expect.poll(() => oldClosed).toBe(1)
  expect(oldConnections).toBe(1)
})
test('missed completion is recovered by guarded REST polling and persisted report refresh', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Missed completion'),
  )
  const created = await createRun(request, mission),
    state = await command(request, created.run_id, 'start')
  let first!: WebSocketRoute,
    count = 0
  await page.routeWebSocket(`**/simulations/${state.run_id}/stream`, (ws) => {
    count++
    if (count === 1) {
      first = ws
      ws.send(
        JSON.stringify({ type: 'snapshot', sequence: state.sequence, state }),
      )
    }
  })
  await page.goto(`/mission-control/${state.run_id}`)
  await expect(
    page.getByRole('button', { name: 'Pause simulation' }),
  ).toBeEnabled()
  await first.close({
    code: 1012,
    reason: 'Completion frame intentionally missed',
  })
  const final = await command(request, state.run_id, 'finish')
  await expect(page.getByLabel('Run overview')).toContainText(final.status, {
    timeout: 10000,
  })
  await page.getByRole('button', { name: 'View report', exact: true }).click()
  await expect(page.getByTestId('numerical-summary')).toBeVisible()
})

test('disposing the last stream subscriber cancels its scheduled reconnect and polling', async ({
  page,
  request,
}) => {
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Timer cleanup'),
  )
  const old = await createRun(request, mission)
  await command(request, old.run_id, 'terminate')
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', { name: 'Workspace settings' }),
  ).toBeVisible()
  await page.clock.install()
  let connections = 0,
    polls = 0,
    socket!: WebSocketRoute
  await page.routeWebSocket(`**/simulations/${old.run_id}/stream`, (ws) => {
    connections++
    socket = ws
    ws.send(
      JSON.stringify({ type: 'snapshot', sequence: old.sequence, state: old }),
    )
  })
  await page.route(`**/api/v1/simulations/${old.run_id}`, (route) => {
    polls++
    return route.fulfill({ json: old })
  })
  await page.evaluate(async (runId) => {
    const { createQueryClient } = await import('/src/services/client.ts')
    const { subscribeRun } = await import('/src/services/stream.ts')
    const client = createQueryClient(),
      dispose = subscribeRun(client, runId)
    Object.assign(window, {
      disposeFixtureStream: () => {
        dispose()
        client.clear()
      },
    })
  }, old.run_id)
  await expect.poll(() => connections).toBe(1)
  await socket.close({
    code: 1012,
    reason: 'Schedule reconnect before disposal',
  })
  await page.evaluate(async () => {
    const { useWorkspace } = await import('/src/store/workspace.ts')
    await new Promise<void>((resolve) => {
      const unsubscribe = useWorkspace.subscribe((state) => {
        if (Object.values(state.connections).includes('reconnecting')) {
          unsubscribe()
          resolve()
        }
      })
      if (
        Object.values(useWorkspace.getState().connections).includes(
          'reconnecting',
        )
      ) {
        unsubscribe()
        resolve()
      }
    })
    ;(
      window as unknown as { disposeFixtureStream: () => void }
    ).disposeFixtureStream()
    await Promise.resolve()
  })
  await page.clock.fastForward(30000)
  expect(connections).toBe(1)
  expect(polls).toBe(0)
})
