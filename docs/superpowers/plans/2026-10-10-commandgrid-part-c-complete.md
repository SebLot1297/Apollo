# CommandGrid Part C — Complete Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Follow repository instructions, including Superpowers and Caveman preferences. Complete the frontend implementation and verification, not another planning-only response.

**Goal:** Replace the foundation preview with a complete frontend for designing missions, operating the real Part A/B simulator and reviewing persisted results.

**Architecture:** TanStack Query owns server data. Zustand holds small UI selections; React Hook Form/Zod handles editable drafts. REST and WebSockets consume the public API contract, while the Python engine remains authoritative for numerical state, clock, objectives and reports.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, Lucide, React Router, TanStack Query, Zustand, React Hook Form, Zod, Recharts, custom SVG map, Playwright.

## 1. Assignment and baseline

Repository: https://github.com/SebLot1297/Apollo.git.

Local checkout: `C:/Users/vihaa/OneDrive/Documents/ChatGPT/apollo knight hacks/Apollo`.

Integrated baseline: commit `c5f52094bae52ad1109a5ee58e6c29085b6c4fca`, available on `main`, `codex/commandgrid-foundation` and `codex/commandgrid-fullstack`. Inspect current Git state first; preserve newer work.

Read:

- `docs/api-contract.md` — authoritative public JSON/API contract.
- `docs/part-a-handoff.md` — integration notes and boundaries.
- `docs/objective-semantics.md` — actual objective and metric semantics.
- `backend/app/api/requests.py`, `backend/app/api/routes.py` and `backend/app/services/missions/state.py` — read-only references.
- Existing `frontend/**`, `e2e/**` and root `playwright.config.ts`.

Parts A/B are implemented: CRUD, settings, Timescale persistence, deterministic simulation, runner, WebSockets, command idempotency, reset and reports. Prior verification: 60 backend tests and 194 subtests, frontend build/lint, and two foundation browser tests pass. Re-run relevant checks for your changes; these numbers are historical evidence.

Part C screens are currently a labeled foundation preview. Part D's AI service is absent and AI requests return explicit 503 responses. Implement all frontend AI interaction boundaries now, while accurately displaying unavailable providers. Core simulation must work without AI credentials or GPU infrastructure.

Some untracked C drafts may exist locally: `frontend/src/types/mission.ts`, `frontend/src/services/{api,queries}.ts`, `frontend/src/store/workspace.ts`. They were not pushed with Part A. Inspect and reuse useful pieces; do not assume they exist in another checkout or that they are correct. In particular, the draft Report type does not match the full ai_analysis envelope, default command keys are unsafe for retries, and REST polling can overwrite newer stream state.

This is a fictional, noncombat infrastructure/disaster-support simulator. Only Communications Recovery is enabled. Use synthetic locations. Preserve the existing dark navy/slate/cyan operations design, sidebar, typography, spacing and SVG terrain. Replace preview data and placeholder controls with actual backend behavior.

## 2. Ownership and delivery boundaries

Own `frontend/**`, `e2e/**` and a frontend handoff at `frontend/README.md`. Maintain this plan's checkboxes as work progresses.

Do not modify backend code, numerical rules, migrations, root manifests/lockfiles, Docker files, root Playwright configuration or another agent's work. Send the coordinator a concrete dependency/interface request if those need changes. Required frontend libraries are already declared; no new test framework is necessary.

In a shared checkout, do not switch branches, reset, stage another agent's files, commit or push without coordinator authorization. In an isolated checkout, use a `codex/` branch and scoped commits; request integration after verification. Do not provision paid infrastructure. This assignment implements C, not A/B/D.

## 3. Public API contract

Use relative URLs. Vite already proxies `/api`, `/health`, `/ready`; `/api` has WebSocket proxying. Never place provider keys or external model endpoints in frontend environment variables.

JSON uses snake_case, UUID strings, UTC dates and finite numbers. Collection endpoints return arrays. HTTP errors contain `detail`, either a string or FastAPI validation issues. Handle 204 without parsing JSON.

REST base: `/api/v1`.

| Feature    | Endpoint and behavior                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missions   | GET/POST `/missions`; GET/PUT/DELETE `/missions/{id}`. POST 201; DELETE 204; PUT uses full configuration and matching ID.                                 |
| Objectives | GET/POST `/missions/{id}/objectives`; PUT/DELETE `/objectives/{id}`. Mission validity applies after each change.                                          |
| Runs       | GET/POST `/simulations`; GET `/simulations/{run_id}`. Create body: `{mission_id, random_seed:42, time_multiplier:30}`. Returns created run, 201.          |
| Commands   | POST `/simulations/{run_id}/commands` with `{command_type,payload:{},idempotency_key:UUID}`. Same key/body replays; changed body with same key conflicts. |
| Reset      | POST `/simulations/{run_id}/reset` with `{idempotency_key}`. Terminal run only; returns new created run, 201, preserving old report.                      |
| History    | GET `/simulations/{run_id}/events`; GET `/simulations/{run_id}/telemetry?from_seconds=&to_seconds=`. Inclusive simulated-time window.                     |
| Reports    | GET `/reports`; GET `/reports/{run_id}`. Terminal numerical report is already saved; AI narrative is a separate request.                                  |
| Registry   | GET `/registry`: metrics/parameters are keyed dictionaries; categories contain `{key,label,available}`.                                                   |
| Settings   | GET/PUT `/settings`: editable fields only `ai_provider`, `demo_mode`, `simulation_speed`; GET includes database/ai_status. Speed affects future runs.     |
| Status     | GET `/health`, `/ready`; GET `/api/v1/ai/providers/status`. Connection success does not imply a configured AI provider is available.                      |

WebSocket: `/api/v1/simulations/{run_id}/stream`. Messages contain `{type:'snapshot'|'update'|'completion',sequence,state}`. Reconnect gets a complete current snapshot.

Mission fields: `id`, `schema_version:1`, `name`, `description`, `category`, `duration_seconds`, `parameters`, `objectives`, `facilities`, `support_teams`, `created_at`, `updated_at`.

Parameters: `weather_severity`, `environmental_disruption`, `team_count`, `equipment_reliability`, `resource_level`, `communication_reliability`, `backup_power_enabled`, `custom_metadata`. `mission_duration` is a registry entry for top-level `duration_seconds`, not another parameters property.

Objective fields: `id`, `name`, `metric_key`, `operator`, `target_value`, `required`, `deadline_seconds`, `evaluation_mode`, `description`. Do not send evaluator status in a configuration.

Public state includes `run_id`, `mission_id`, `mission`, `status`, `elapsed_time_seconds`, `random_seed`, `time_multiplier`, `sequence`, `metrics`, `systems`, `facilities`, `support_teams`, `incidents`, `events`, `objective_results`, `history`. `systems` contains numeric `communication_health`, `equipment_availability`, `power_availability`, `resource_level`.

Consume the public adapter state, not native Python system objects or engine_snapshot. Events use `sequence`, `simulated_time_seconds`, `event_type`, `severity`, `message`, `payload`. History samples use `simulated_time_seconds`, `metrics`, `systems`. Objective results contain `objective`, `achieved_value`, `passed`, `status`, `first_achieved_at_seconds`, `reason`.

Report fields: `run_id`, `mission`, `success`, `status`, `elapsed_time_seconds`, `final_metrics`, `objective_results`, `events`, `command_history`, `telemetry`, `summary`, `ai_analysis`, `created_at`. Render saved configuration snapshots even if the original mission was edited/deleted. Command records include `command_type`, `payload`, `elapsed_time_seconds`, `simulated_time_seconds`, `timestamp`, `effect`.

`ai_analysis` is null or the entire AI envelope, not a string:

```ts
export interface AIEnvelope<T> {
  provider: 'gemini' | 'qwen' | 'mock'
  model: string
  mock: boolean
  fallback_reason: string | null
  data: T
  usage: Record<string, number>
  latency_ms: number
}
// Report.ai_analysis: AIEnvelope<{ text: string }> | null
```

AI POST routes and request bodies:

- `/ai/generate-mission`: `{prompt,provider?}` → envelope with mission data.
- `/ai/generate-objectives`: `{prompt,mission_id?,provider?}` → envelope with objective array.
- `/ai/explain-incident`: `{run_id,incident_id,provider?}` → envelope with `{text}`.
- `/ai/chat`: `{run_id,message,provider?}` → envelope with `{text}`.
- `/ai/generate-report`: `{run_id,provider?}` → envelope with `{text}`, saved separately in the report.

Provider preference accepts `auto`, `gemini`, `qwen`, `mock`. Prompt/message length is 1..8000 characters. A provider response is advisory text/proposed configuration; it never executes commands or changes trusted metrics.

## 4. File structure

Keep modules focused. Use these paths, consolidating only where the existing code already serves the same responsibility:

- `frontend/src/types/mission.ts`: public mission/state/report/registry/AI types.
- `frontend/src/types/preview.ts`, `frontend/src/data/demoMission.ts`: remove production dependencies once all real screens work; delete if unused.
- `frontend/src/services/api.ts`: typed REST transport, errors, abort signals.
- `frontend/src/services/queries.ts`: query keys, reads, mutation invalidation.
- `frontend/src/services/state.ts`: one per-run monotonic state acceptance helper.
- `frontend/src/services/stream.ts`: socket lifecycle, frame validation, reconnect.
- `frontend/src/services/commands.ts`: stable command request/retry lifecycle.
- `frontend/src/store/workspace.ts`: selected run and incident; ephemeral connection UI state.
- `frontend/src/features/missions/{schema,templates,serialize}.ts`: form validation, fictional defaults, payload conversion.
- `frontend/src/components/missions/{MissionForm,ParameterFields,ObjectiveEditor,MissionReview}.tsx`.
- `frontend/src/components/control/{TelemetryCards,ObjectiveProgress,EventFeed,IncidentPanel,CommandConsole}.tsx`.
- `frontend/src/components/ai/{AIProposalReview,AIAssistant,ProviderBadge}.tsx`.
- `frontend/src/components/reports/{TelemetryCharts,ReportComparison}.tsx`.
- `frontend/src/components/ui/{RequestState,ConfirmDialog}.tsx`: reusable accessible feedback/confirmation.
- Modify existing `frontend/src/components/layout/AppLayout.tsx`, `frontend/src/components/dashboard/ScenarioMap.tsx`, `frontend/src/pages/{Dashboard,MissionBuilder,MissionControl,AfterActionReport,Settings}.tsx`, `frontend/src/App.tsx`, styles and main entry.
- Create `frontend/src/pages/ObjectiveDesigner.tsx`, `frontend/src/pages/ReportDetail.tsx`.
- Tests: `e2e/{transport,forms,commandgrid-flow,connection,ai,responsive}.spec.ts`; update `e2e/foundation.spec.ts` assertions to actual data/navigation.

Routes: `/`, `/mission-builder`, `/mission-builder/:missionId`, `/objectives`, `/objectives/:missionId`, `/mission-control`, `/mission-control/:runId`, `/reports`, `/reports/:runId`, `/settings`, plus accessible unknown-route screen. Reloading a detail route must recover server data without depending on a previous navigation.

## Task C1 — Typed transport, cache ordering and application shell

- [ ] Inspect baseline and draft files. Confirm `/ready` identifies the backend and `/registry` matches this plan.
- [ ] Define every public type; correct AI/report shapes. Keep preview types separate during migration.
- [ ] Implement abortable REST requests; useful errors for network failures, 404, 409, 422, 429 and 503. Map validation paths to fields. Do not retry mutations automatically.
- [ ] Create central query keys: missions, mission(id), runs, run(id), events(id), telemetry(id,window), reports, report(id), registry, settings, provider-status.
- [ ] Use one state acceptance rule for REST, commands, polling and stream snapshots. Validate run identity and sequence; older/equal data must never roll back newer state.
- [ ] Apply the sequence gate when cache writes occur, including TanStack Query's structuralSharing callback for run queries. Checking only socket frames or a fetch function before it resolves does not protect against late REST results. Mutation/stream writes use setQueryData with an updater reading the current cached state.
- [ ] Add `e2e/transport.spec.ts` tests before wiring reads. The following pure helper is the required behavior:

```ts
import type { MissionState } from '../types/mission'

export function acceptRunState(
  current: MissionState | undefined,
  incoming: MissionState,
  runId: string,
): MissionState | undefined {
  if (incoming.run_id !== runId) return current
  if (!Number.isSafeInteger(incoming.sequence) || incoming.sequence < 0)
    return current
  if (
    current &&
    current.run_id === runId &&
    current.sequence >= incoming.sequence
  )
    return current
  return incoming
}
```

- [ ] Tests must cover seq 8 followed by REST seq 7, duplicate seq 8, valid seq 9, wrong run ID and independent second-run seq 1. Use Playwright's runner for pure helper tests; avoid adding a framework.

```ts
// e2e/transport.spec.ts: focused ordering tests; these partial transport fixtures
// test only the sequence helper, not backend schema validity or persistence.
import { expect, test } from '@playwright/test'
import { acceptRunState } from '../frontend/src/services/state'
import type { MissionState } from '../frontend/src/types/mission'

const frame = (run_id: string, sequence: number) =>
  ({ run_id, sequence }) as MissionState

test('late REST and duplicate frames cannot roll back current run state', () => {
  const current = frame('run-a', 8)
  expect(acceptRunState(current, frame('run-a', 7), 'run-a')).toBe(current)
  expect(acceptRunState(current, frame('run-a', 8), 'run-a')).toBe(current)
  expect(acceptRunState(current, frame('run-a', 9), 'run-a')?.sequence).toBe(9)
  expect(acceptRunState(current, frame('run-b', 9), 'run-a')).toBe(current)
  expect(acceptRunState(undefined, frame('run-b', 1), 'run-b')?.sequence).toBe(
    1,
  )
})
```

- [ ] Render loading/error/retry/empty states. An unavailable backend must not look like zero saved missions or a healthy connection.
- [ ] Replace static global labels with actual active mission/status/server time. Add Objective Designer navigation. Preserve mobile menu, skip link and keyboard navigation.
- [ ] Run `npm run build`, `npm run lint`; run transport tests using `npm run test:e2e -- e2e/transport.spec.ts`. First confirm tests fail for the old acceptance behavior, then pass with the helper used by every state writer.

## Task C2 — Mission Builder and parameter editing

- [ ] Implement four steps: Mission information → Operational conditions → Objectives → Review/save. Back/next navigation preserves unsaved values.
- [ ] Support new mission, edit saved mission, and clone saved mission. Clone assigns fresh mission/objective UUIDs and regenerates fictional facilities/teams; edit preserves IDs and original created_at.
- [ ] Use registry-backed category/options/bounds. Only `communications_recovery` can be selected; unavailable categories are visible with explanations.
- [ ] Supply a local editable template matching Operation Signal Restore: duration 21600, weather 85, disruption 70, four teams, equipment 75, resources 70, communications 45, backup power enabled; final uptime >=90 required, systems_restored >=2 by 21600 required, final equipment >=75 optional. It is a proposed draft until saved, never a precomputed result. Also provide an empty builder with a valid initial required objective.
- [ ] Provide name/description, duration units with explicit seconds conversion, and each supported parameter control with value/unit/effect help from registry.
- [ ] Validate trimmed nonblank names, integer duration 60..86400 seconds, integer team_count 1..10, finite numeric percentages 0..100, strict backup boolean and schema_version 1. Reject blank numbers instead of treating them as zero.
- [ ] Metadata editor supports distinct nonblank keys and explicitly typed string/boolean/finite number/null values. Reject arrays/nested objects; label metadata as annotations with no numerical effects.
- [ ] When team_count changes, send support_teams=[] for regeneration. Preserve supplied facilities unless explicitly regenerating for a new/clone mission. Omitted/empty arrays get server defaults.
- [ ] Review shows exact units, required/optional objectives and all changed fields. Save calls real POST/PUT. Show field-specific 422 errors and ID conflicts; keep the draft after failure.
- [ ] Invalidate mission list/detail after confirmed save, then navigate to saved configuration or dashboard. Prevent double submission and warn before leaving dirty edits.
- [ ] Add `e2e/forms.spec.ts`: invalid duration, numeric blank, percent 101, fractional teams, invalid metadata, edit parameter, reload saved values. Run this file red→green against actual backend.

## Task C3 — Reusable Objective Designer

- [ ] Use the same ObjectiveEditor in Builder step three and the dedicated Objective Designer page. `/objectives` offers saved-mission selection or navigation to a new builder.
- [ ] Support name, description, metric, comparison, threshold, required flag, evaluation mode and applicable deadline. Metric registry determines unit, minimum/maximum, integer thresholds and supported modes/operators.
- [ ] Support the six registered metric keys and operators >=, <=, =, >, <. Display units clearly; never interpret an arbitrary expression as a rule.
- [ ] Mode help must explain final value at actual completion, maintained throughout the run, first qualifying value by deadline, and cumulative totals. Use backend results/reasons for historical evaluation; current value alone does not establish maintained/deadline success.
- [ ] Deadline mode requires a finite deadline within 0..duration_seconds. Other modes send null, not a stale deadline. Require at least one required objective and distinct UUIDs. Counts have integral nonnegative thresholds; percentages cannot exceed 100.
- [ ] Unsaved missions edit local objective drafts until full save. Dedicated saved-mission edits use objective POST/PUT/DELETE. Disable removal of the last required objective; backend validation still governs.
- [ ] Invalid incompatible metric/mode changes require explicit correction; no silent conversion of historical semantics. Batch edits may use one full mission PUT to avoid temporarily invalid intermediate configurations.
- [ ] Extend form tests: all-optional rejection, last-required delete prevention, deadline beyond duration, switching away from deadline, fractional count, optional deletion, objective update persists after reload.

## Task C4 — Real Dashboard and mission library

- [ ] Replace Operation Aurora preview imports with backend missions, runs and reports. Show saved count, actual active run, terminal counts and latest saved result.
- [ ] Library cards provide open/edit/clone/delete/launch. Show latest result linked to its report. Confirm deletion; handle active-run deletion conflict without removing the card.
- [ ] Display real recent activity from the selected/latest run's events; empty lists and unavailable requests have distinct presentation.
- [ ] Launch sends selected saved mission ID, default seed 42 and the server's future-run speed. Do not auto-start a created run; navigate to Mission Control where Start is explicit.
- [ ] If one active run already exists, offer Open active run. A race producing 409 refreshes runs and presents that action. Never silently reset/terminate another run.
- [ ] No mission launch on unsaved/invalid drafts. After mission deletion preserve historical report links and snapshot names.
- [ ] Update foundation navigation tests to seeded Operation Signal Restore and actual routes. Add library edit/clone/delete and conflicting-launch coverage.

## Task C5 — WebSocket lifecycle and live Mission Control

- [ ] Subscribe centrally once per selected run and fan cached state to global layout/control components. Avoid duplicate sockets/timers under React Strict Mode.
- [ ] Validate frame type, matching run ID, envelope/state sequence equality and basic field shapes before accepting it. Run identity and sequence checks apply across REST and stream responses.
- [ ] Show Connecting until a valid snapshot arrives; on close show Reconnecting/Offline with last confirmed update. Reconnect with bounded exponential delay up to 15 seconds and small jitter. Cancel timers/sockets on run changes/unmount; cap retry growth.
- [ ] On reconnect accept current snapshot through the central sequence gate. Use guarded REST polling while disconnected, plus focus/manual refresh. Never reset sequence merely because a socket reconnects.
- [ ] A completion frame invalidates runs/reports/report(id); navigate only after a report is actually retrievable. Handle missed completion via REST terminal state. An old cached command replay must not overwrite later live state.
- [ ] Mission Control reads the selected persisted run; recover route/run selection after reload. Missing/deleted/stale selection shows useful recovery actions.
- [ ] Render live metrics and four system cards, elapsed server time/duration/speed, objective results/reasons, events, incidents and recovery controls. Do not simulate time or incidents in the browser. Paused elapsed time must remain unchanged.
- [ ] Convert ScenarioMap to props using real facilities/team coordinates and server statuses. Preserve SVG terrain; allow keyboard/mouse marker selection. Use marker legend plus text/icons, not color alone. No invented routes or movement.
- [ ] Display event sequence/time/severity, filter without altering order, and allow selecting an incident. Use pagination/windowing or a bounded visible list for long feeds while retaining server evidence.
- [ ] Charts use real samples. For duplicate simulated timestamps, plot the last confirmed sample at that time while retaining all samples in history/tables. Show gaps/missing series accurately; cap rendered points without fabricating values.
- [ ] Add connection tests: newer WS followed by delayed older REST, duplicate frame, malformed/wrong-run frame, disconnect/reconnect snapshot, run switch cleanup, paused state, unavailable backend. Transport fixtures are allowed in these targeted tests and must be identified as fixtures.

## Task C6 — Commands, retries and terminal behavior

- [ ] Create a request object once per action with UUID key; freeze its command/payload/run identity until resolved. Disable repeat clicks while pending. A user Retry reuses that exact object/key; a new deliberate action gets a new key. Reset follows the same rule.
- [ ] Do not optimistically modify simulation state. On HTTP success accept returned state through the central gate, invalidate affected reads and show confirmation. On timeout show outcome unknown and offer retry/refresh; do not silently create a new key. Serialize commands per run.
- [ ] Do not automatically retry AI requests. Respect 429 Retry-After and display countdown/retry availability; preserve prompts/drafts after failure.
- [ ] Implement controls using this state matrix:

| Status                          | Available controls                                   |
| ------------------------------- | ---------------------------------------------------- |
| created                         | Start, Terminate                                     |
| running                         | Pause, Finish, Terminate, incident/recovery commands |
| paused                          | Resume, Finish, Terminate                            |
| completed / failed / terminated | View saved report, Reset to a new created run        |

- [ ] Confirm finish/terminate/reset consequences in UI. Finish evaluates at current elapsed time; it does not jump to mission duration. Reset preserves old results and selects the returned new run; a different active run blocks reset.
- [ ] Recovery commands: trigger_incident with kind communications_outage/power_failure/equipment_degradation; acknowledge_incident with incident_id; restore_service with optional incident_id; activate_backup_communications; activate_backup_power; run_equipment_diagnostic. No free-form executable console.
- [ ] Backup power requires configured capability; acknowledged/resolved incidents have accurate controls. Resource/capability failures and illegal transitions show backend errors. Repeating a no-op must not be represented as a new successful restoration.
- [ ] On disconnect disable state-changing controls until fresh server state is obtained. Keep historical browsing available with a stale-data label.
- [ ] Add command tests: one request on double-click, network retry retains key, next action gets a new key, 409 recovery, illegal controls disabled, reset selects new ID and old report remains accessible.

## Task C7 — Persisted reports, charts and comparison

- [ ] Replace report placeholder with sorted saved-report list and direct detail route. Show actual success/status/date, mission snapshot and elapsed time. Preserve failed/terminated outcomes.
- [ ] Detail displays required/optional objective outcomes, achieved values, thresholds, deadlines, first_achieved_at_seconds and reasons from backend. Overall result uses report.success, never a frontend recalculation.
- [ ] Display final metrics, complete incident/event timeline and accepted command history using effect/timestamps. Fetch persisted telemetry for time windows and use report.telemetry for the saved snapshot view.
- [ ] Use Recharts for communication uptime, equipment availability, resources and power. Clearly separate uptime percentage (historical metric) from instantaneous communication health. Provide accessible data table/text alternatives and missing-data states.
- [ ] Allow comparison of two real reports. Show mission/run identities, differing configurations, actual success/metrics/deltas and simulated-time plots without implying different configurations are controlled experiments. Do not compare fictional preview values.
- [ ] Show AI narrative separately with complete provenance and server summary independent of AI. Narrative requests refetch report(id); ensure final_metrics/success/objective_results remain unchanged.
- [ ] Add report tests: success, required failure, optional failure with overall success, terminated result, historical snapshot after mission edit/delete, previous-result comparison and reload persistence.

## Task C8 — Settings and AI-assisted workflows

- [ ] Settings reads persisted server preference/speed/demo mode. Validate finite speed >0 and <=3600; save only allowed keys. Existing run speed stays unchanged. Persisted client preferences must not override fresh server settings.
- [ ] Display database engine/status, SQLite local-demo versus PostgreSQL/Timescale, readiness flags and provider/model/configured/available/detail. Never show API keys or claim availability from configured=true alone.
- [ ] Implement mission/objective generation, selected-incident explanation, contextual chat and report narrative UI using the endpoints above. Each action requires a user click; no AI calls on ticks, route load or reconnect.
- [ ] Disable unavailable AI capabilities with a clear reason and a status refresh action. If a request races provider loss, show 503 without crashing or changing numerical state. While D is absent, all core C flows remain usable.
- [ ] Proposal review permits edit/discard/apply. Applying a mission proposal only changes a local draft; Save is separate. Preserve identity when applying fields to an existing edited mission; assign fresh IDs for a newly created/cloned mission and its objectives. Validate the complete merged draft. Avoid duplicate objective IDs.
- [ ] Objective proposals append/replace only with explicit selection and review; neither request nor Apply implicitly saves. Unsaved mission requests omit mission_id and include necessary duration/metric context in the bounded prompt.
- [ ] ProviderBadge displays returned provider/model, mock flag and fallback_reason. A mock response is visibly labeled DEMO/MOCK. Render text as text; if adding Markdown, use a sanitized renderer without raw HTML.
- [ ] AI panel is advisory. It cannot execute commands, declare objective success, change numeric fields or fabricate a live provider response.
- [ ] Add AI tests for actual unavailable-service state. Mock successful AI transport only in clearly labeled UI tests: edited proposal requires explicit Save; discard changes nothing; mock provenance visible; narrative cannot overwrite trusted metrics; 429/503 preserve drafts. Do not claim live inference verified from those tests.

## Task C9 — Real end-to-end acceptance, accessibility and handoff

- [ ] Write actual-backend `e2e/commandgrid-flow.spec.ts`. Use existing isolated Playwright servers; no mocking mission persistence, engine, commands, WebSockets or reports. Create fresh UUIDs per mission/objective to avoid global-ID conflicts.
- [ ] Success scenario: create a 600-second mission, weather/disruption 0, communications 100, equipment 75, four teams; required final incidents_resolved >=1 and optional final equipment >=100. Edit one parameter and the required objective in UI, save/reload, launch/start, trigger power_failure, acknowledge/restore that incident, observe confirmed state change, pause and verify elapsed time stops, resume, finish. Assert successful report with optional objective failed; reload and assert persisted metrics/results.
- [ ] Failure scenario: required final incidents_resolved >=2; resolve only one incident and finish. Assert report.success=false with required failure. Also cover termination and reset preserving old report. These outcomes come from engine evidence, never substituted fixtures.
- [ ] Include early finish and automatic duration completion. For a short automatic-completion case use minimum duration 60, high selected future-run speed, and a required elapsed_time_seconds >=60; wait on terminal/report state rather than a fixed sleep. Keep incident/recovery flows slower to avoid finishing before interaction.
- [ ] Exercise UI while Part D unavailable; core simulation still completes. Server restart recovery is already covered by A/B tests; coordinate a browser restart/resume check instead of attempting to spawn another backend against the same DB.
- [ ] Run desktop and 390px mobile flows. Test keyboard-only navigation, labeled fields, error focus, dialog focus trap/restore/Escape, visible focus, reduced motion, contrast and chart/table alternatives. No page overflow or runtime console errors.
- [ ] Update frontend/README.md with implemented routes, exact commands/results, screenshots, current provider limitations and coordinator integration requests. Report which tests used real backend, isolated SQLite, actual Timescale, or transport fixtures. Default Playwright uses isolated SQLite; do not call it Timescale evidence.
- [ ] Run final commands from repository root with existing dev/container backend stopped if they occupy Playwright ports 8000/5173:

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
git diff --check
```

- [ ] Expected: zero build/lint/test failures, all real frontend flows pass, no unrelated staged changes or committed secrets. For Timescale browser acceptance coordinate a dedicated isolated test DB/server configuration with A; do not point destructive test setup at saved user data.
- [ ] Return changed-file inventory, working user flows, exact checks and results, screenshots, interface requests and remaining limitations. State plainly that live Gemini/Qwen inference awaits D/configuration unless actually verified.

## Definition of done

A user can create/edit/save a valid mission, define required/optional objectives, launch/start a real run, observe streamed telemetry and map state, trigger/respond to incidents, pause/resume, finish with accurate results, revisit persisted reports, compare real runs and reset without losing history. Settings persist. AI interactions are complete at the UI boundary and gracefully unavailable until D is installed. Every visible control works or clearly explains why unavailable. No preview data is presented as a running mission, and no frontend calculation replaces backend objective evidence.

Begin implementation after repository inspection. Execute C1 through C9 in order; fix verification failures before moving on. Do not change A/B numerical/storage behavior to make a UI test pass.
