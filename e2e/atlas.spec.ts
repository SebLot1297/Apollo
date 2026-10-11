import { test, expect, type WebSocketRoute } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  configuration,
  createRun,
  command,
  resetWorkspace,
  saveConfiguration,
  screenshot,
} from './helpers'
import type { MissionState, Report } from '../frontend/src/types/mission'

test.beforeEach(async ({ request }) => resetWorkspace(request))

test('atlas composition follows A and map selection handles edges, overlap, keyboard and long content', async ({
  page,
  request,
}) => {
  const run = await createRun(
    request,
    await saveConfiguration(
      request,
      await configuration(request, 'Atlas visual fixture'),
    ),
  )
  const incidentId = randomUUID()
  const state: MissionState = {
    ...run,
    status: 'running',
    sequence: 1000,
    elapsed_time_seconds: 222,
    mission: {
      ...run.mission,
      name: 'Communications Recovery',
      duration_seconds: 600,
    },
    systems: {
      communication_health: 82,
      equipment_availability: 75,
      power_availability: 64,
      resource_level: 58,
    },
    facilities: run.facilities.map((f) => ({
      ...f,
      x: f.kind === 'relay' ? 28 : f.kind === 'power' ? 75 : 25,
      y: f.kind === 'relay' ? 24 : f.kind === 'power' ? 57 : 75,
      status: f.kind === 'power' ? 'degraded' : 'operational',
    })),
    support_teams: [],
    incidents: [
      {
        id: incidentId,
        kind: 'power_failure',
        title: 'Power failure',
        description:
          'Synthetic power interruption. Inspect the power system and choose a recovery action.',
        status: 'active',
        started_at_seconds: 219,
        resolved_at_seconds: null,
      },
    ],
    events: Array.from({ length: 5 }, (_, i) => ({
      id: randomUUID(),
      sequence: 995 + i,
      simulated_time_seconds: 217 + i,
      event_type: i === 2 ? 'incident_started' : 'state_update',
      severity: i === 2 ? 'warning' : 'info',
      message:
        i === 2
          ? 'Power failure detected in the power system.'
          : 'Simulation state confirmed by the server.',
      payload: {},
    })),
    metrics: {
      ...run.metrics,
      incidents_resolved: 3,
      systems_restored: 2,
      supplies_delivered_percent: 18,
    },
  }
  let socket!: WebSocketRoute
  await page.route(`**/api/v1/simulations/${run.run_id}`, (route) =>
    route.fulfill({ json: state }),
  )
  await page.route('**/api/v1/simulations', (route) =>
    route.fulfill({ json: [state] }),
  )
  await page.route(
    `**/api/v1/simulations/${run.run_id}/recovery-plan`,
    (route) =>
      route.fulfill({
        json: {
          run_id: run.run_id,
          based_on_sequence: state.sequence,
          profile: 'standard',
          steps: [
            {
              id: 'backup',
              title: 'Activate backup power',
              explanation:
                'Activate auxiliary power to restore the power system. This is a system-wide recovery action.',
              command_type: 'activate_backup_power',
              payload: {},
              cost: 3,
              effects: { power_availability: 26 },
              blocked_reason: null,
            },
            {
              id: 'restore',
              title: 'Restore power service',
              explanation: 'Repair the selected power incident.',
              command_type: 'restore_service',
              payload: { incident_id: incidentId },
              cost: 8,
              effects: { power_availability: 36 },
              blocked_reason: null,
            },
          ],
          objective_outlook: {
            can_finish_successfully: false,
            note: 'Required objectives are not yet met.',
            required_objectives: [],
          },
        },
      }),
  )
  await page.routeWebSocket(`**/simulations/${run.run_id}/stream`, (ws) => {
    socket = ws
    ws.send(
      JSON.stringify({ type: 'snapshot', sequence: state.sequence, state }),
    )
  })
  await page.setViewportSize({ width: 1586, height: 992 })
  await page.goto(`/mission-control/${run.run_id}`)
  const inspector = page.getByTestId('incident-inspector')
  await expect(
    inspector.getByRole('button', { name: 'Execute action', exact: true }),
  ).toBeEnabled()
  await page.evaluate(() => document.fonts.ready)
  const boxes = await Promise.all(
    [
      'atlas-header',
      'mission-strip',
      'operations-workspace',
      'operations-summary',
    ].map((id) => page.getByTestId(id).boundingBox()),
  )
  expect(boxes[0]!.height).toBeCloseTo(54, 0)
  expect(boxes[1]!.y).toBeCloseTo(54, 0)
  expect(boxes[1]!.height).toBeCloseTo(78, 0)
  expect(Math.abs(boxes[2]!.height - 660)).toBeLessThan(8)
  expect(Math.abs(boxes[3]!.y - 792)).toBeLessThan(8)
  const inspectorBox = await inspector.boundingBox()
  expect(Math.abs(inspectorBox!.x - 1152)).toBeLessThan(8)
  mkdirSync('output/atlas-verification', { recursive: true })
  writeFileSync(
    'output/atlas-verification/geometry.json',
    JSON.stringify(
      {
        viewport: { width: 1586, height: 992 },
        regions: boxes,
        inspector: inspectorBox,
        reference: { header: 54, strip: 78, workspace: 660, inspectorX: 1152 },
        content:
          'Test-only state fixtures; not real simulation outcome evidence.',
      },
      null,
      2,
    ),
  )
  await page.screenshot({ path: 'frontend/screenshots/atlas-native.png' })
  await expect(page).toHaveScreenshot('atlas-native.png', {
    mask: [inspector.locator('.inspector-label > small')],
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  })
  await inspector
    .getByLabel('Recovery option', { exact: true })
    .selectOption('restore')
  await expect(
    inspector.getByRole('heading', { name: 'Restore power service' }),
  ).toBeVisible()
  const relay = page.getByRole('button', {
    name: /North Haven Relay: operational, coordinates/,
  })
  await relay.focus()
  await page.keyboard.press('Enter')
  await expect(relay).toHaveAttribute('aria-pressed', 'true')
  await expect(
    inspector.getByRole('heading', { name: 'North Haven Relay', exact: true }),
  ).toBeVisible()
  await page
    .getByLabel('Active incident', { exact: true })
    .selectOption(incidentId)
  await expect(page.locator('.map-marker.associated')).toHaveCount(1)
  socket.send(
    JSON.stringify({
      type: 'update',
      sequence: 1001,
      state: {
        ...state,
        sequence: 1001,
        incidents: state.incidents.map((i) => ({
          ...i,
          description: `${i.description} `.repeat(40),
        })),
      },
    }),
  )
  await expect(inspector.locator('.inspector-description')).toContainText(
    'Synthetic power interruption.',
  )
  await expect
    .poll(() => inspector.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  const crowded = {
    ...state,
    sequence: 1002,
    facilities: state.facilities.map((f, i) => ({
      ...f,
      x: i === 0 ? 0 : 100,
      y: i === 0 ? 0 : 100,
      name:
        i === 0
          ? 'Facility with an unusually long name for label overflow verification'
          : f.name,
    })),
  }
  socket.send(
    JSON.stringify({
      type: 'update',
      sequence: crowded.sequence,
      state: crowded,
    }),
  )
  await expect(
    page.getByRole('button', { name: /unusually long name/ }),
  ).toBeVisible()
  for (const width of [1200, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    const overflow = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return (
            r.width > 0 &&
            (r.right > innerWidth + 1 || r.left < -1) &&
            !el.closest('.cg-table-wrap')
          )
        })
        .slice(0, 25)
        .map((el) => ({
          tag: el.tagName,
          cls: el.className,
          width: el.getBoundingClientRect().width,
          right: el.getBoundingClientRect().right,
          position: getComputedStyle(el).position,
        })),
    )
    if (width === 320)
      await page.screenshot({
        path: 'output/atlas-verification/edge-layout-320.png',
      })
    // Recharts settles its ResizeObserver measurements after viewport changes.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        { message: JSON.stringify({ width, overflow }) },
      )
      .toBe(true)
    const canvas = await page.locator('.map-canvas').boundingBox()
    const markers = await page.locator('.map-marker').all()
    for (const marker of markers) {
      const box = await marker.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(canvas!.x)
      expect(box!.x + box!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width)
      await marker.focus()
      await page.keyboard.press('Enter')
      await expect(marker).toHaveAttribute('aria-pressed', 'true')
    }
  }
})

test('map inspector executes a real engine recovery and real screens share the light system at desktop and mobile', async ({
  page,
  request,
}) => {
  test.setTimeout(90000)
  const mission = await saveConfiguration(
    request,
    await configuration(request, 'Atlas screen coverage'),
  )
  const run = await createRun(request, mission)
  await command(request, run.run_id, 'start')
  await command(request, run.run_id, 'trigger_incident', {
    kind: 'power_failure',
  })
  await command(request, run.run_id, 'pause')
  await page.goto(`/mission-control/${run.run_id}`)
  const inspector = page.getByTestId('incident-inspector')
  await expect(
    inspector.getByRole('button', { name: 'Execute action', exact: true }),
  ).toBeEnabled()
  await page
    .getByLabel('Active incident', { exact: true })
    .selectOption({ label: 'Power failure · active' })
  await inspector
    .getByRole('button', { name: 'Execute action', exact: true })
    .click()
  await expect(page.getByTestId('power_availability')).toHaveText('90%')
  await expect(
    inspector.getByRole('heading', {
      name: 'Acknowledge Power failure',
      exact: true,
    }),
  ).toBeVisible()
  await inspector
    .getByLabel('Recovery option', { exact: true })
    .selectOption({ label: 'Restore Power failure' })
  await inspector
    .getByRole('button', { name: 'Execute action', exact: true })
    .click()
  await expect(
    inspector.getByRole('heading', { name: 'No active incidents' }),
  ).toBeVisible()
  await expect(page.getByLabel('Active incident', { exact: true })).toHaveCount(
    0,
  )
  await command(request, run.run_id, 'finish')
  // Scope screenshot data to this real run. Normalize identity/timestamps only;
  // numerical outcomes, objectives, facilities and command evidence stay real.
  const visualMission = {
    ...mission,
    name: 'Atlas screen coverage',
    created_at: '2026-10-10T12:00:00Z',
    updated_at: '2026-10-10T12:00:00Z',
  }
  const visualState: MissionState = {
    ...(await (await request.get(`/api/v1/simulations/${run.run_id}`)).json()),
    mission: visualMission,
  }
  const visualReport: Report = {
    ...(await (await request.get(`/api/v1/reports/${run.run_id}`)).json()),
    mission: visualMission,
    created_at: '2026-10-10T12:00:00Z',
  }
  for (const [url, json] of [
    ['**/api/v1/missions', [visualMission]],
    [`**/api/v1/missions/${mission.id}`, visualMission],
    ['**/api/v1/simulations', [visualState]],
    [`**/api/v1/simulations/${run.run_id}`, visualState],
    ['**/api/v1/reports', [visualReport]],
    [`**/api/v1/reports/${run.run_id}`, visualReport],
  ] as const)
    await page.route(url, (route) => route.fulfill({ json }))
  await page.routeWebSocket(
    `**/api/v1/simulations/${run.run_id}/stream`,
    (ws) =>
      ws.send(
        JSON.stringify({
          type: 'snapshot',
          sequence: visualState.sequence,
          state: visualState,
        }),
      ),
  )
  const pages: [string, string][] = [
    ['dashboard', '/'],
    ['builder', `/mission-builder/${mission.id}`],
    ['objectives', `/objectives/${mission.id}`],
    ['control', `/mission-control/${run.run_id}`],
    ['reports', `/reports/${run.run_id}`],
    ['settings', '/settings'],
  ]
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  for (const width of [1440, 390, 1200, 768, 320])
    for (const [name, url] of pages) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(url)
      await expect(page.locator('main h1').first()).toBeVisible()
      await expect(
        page.getByText('Loading server data…', { exact: true }),
      ).toHaveCount(0)
      if (name === 'reports')
        await expect(
          page.getByText('Loading incident history…', { exact: true }),
        ).toHaveCount(0)
      await page.evaluate(() => document.fonts.ready)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      expect(
        await page.evaluate(() => getComputedStyle(document.body).color),
      ).toBe('rgb(23, 52, 82)')
      if (width === 1440 || width === 390) {
        await screenshot(
          page,
          `frontend/screenshots/atlas-${name}-${width}.png`,
        )
        await page.screenshot({
          path: `frontend/screenshots/atlas-${name}-${width}-viewport.png`,
        })
        await expect(page).toHaveScreenshot(`atlas-${name}-${width}.png`, {
          animations: 'disabled',
          mask: [
            page.locator(
              '.inspector-label > small, .report-summary > section > p.cg-help, .mission-time',
            ),
          ],
          maxDiffPixelRatio: 0.01,
        })
      }
    }
  expect(errors).toEqual([])
})
