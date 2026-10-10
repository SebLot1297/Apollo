# CommandGrid frontend

The current interface implements the approved Spatial atlas direction across every route. See [design system](../DESIGN.md), [approved substitutions](../docs/atlas-direction.md), and [implementation/verification](../docs/atlas-implementation.md). The original mockup is preserved in `../output/mockups/a-spatial-atlas.png`; locally served terrain provenance and the Roboto license are in `public/assets/`.

Browser tests can use isolated ports without stopping existing development services. Set `COMMANDGRID_TEST_API_PORT` and `COMMANDGRID_TEST_FRONTEND_PORT` before running Playwright. Defaults remain 8000/5173. The Vite proxy accepts `COMMANDGRID_API_PROXY`, retaining its existing default.

## Earlier Part C handoff

Implemented against integrated A/B baseline `c5f52094bae52ad1109a5ee58e6c29085b6c4fca` and integrated on top of Part D commit `c0472b5` in the existing `codex/commandgrid-foundation` checkout. All Part C implementation changes are confined to `frontend/` and `e2e/`. Backend code, numerical rules, migrations, root manifests/lockfiles, Docker and root Playwright configuration are unchanged by Part C.

## Routes and working journeys

| Route                                         | Behavior                                                                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                           | Actual saved mission library, active run, saved results and recent events; create, edit, clone, confirmed delete and launch. Launch creates a stopped run using saved preferences and a chosen seed.                                          |
| `/mission-builder`                            | Four-step mission draft, editable Signal Restore template, strict validation, explicit server Save. `?clone=<mission UUID>` creates fresh mission/objective identities and asks the server to generate facilities/teams.                      |
| `/mission-builder/:missionId`                 | Direct/reload-safe editing that preserves identity; parameters, scalar metadata and objectives persist through mission PUT. Changed team count sends empty teams for regeneration.                                                            |
| `/objectives`, `/objectives/:missionId`       | Mission chooser and shared objective editor. Single additions/updates/deletions use the objective API; coordinated changes use one mission PUT. Registry modes, units, operators and thresholds are enforced.                                 |
| `/mission-control`, `/mission-control/:runId` | Run chooser and live server state, elapsed time, four systems, metrics, keyboard-selectable facility/team map, incident inspection, recovery controls, objective evidence, telemetry and event feed.                                          |
| `/reports`, `/reports/:runId`                 | Persisted list/detail, authoritative success, full configuration snapshot, metrics, historical objective reasons/achievement times, telemetry table/chart, events, command effects, separate optional AI narrative and two-report comparison. |
| `/settings`                                   | Persistent provider/demo/default-speed preferences, database mode, backend/engine readiness and configured versus available provider status.                                                                                                  |

Only Communications Recovery is available. All terrain/locations are fictional. The obsolete Aurora preview source and planned-page component have been removed. Forms retain unsaved drafts after errors and confirm dirty navigation. Confirmed mission saves return to the top of the Dashboard and show the screen-reader-announced **mission saved successfully** popup, dismissible manually or after eight seconds. Failed or invalid saves remain in the editor without success feedback. Dialogs trap/restore focus and support Escape. Mobile navigation, visible keyboard focus, reduced motion and chart tables are supported.

Core journey: create a valid configuration → save/reload → launch → explicitly start → trigger, acknowledge and restore a synthetic incident → pause/resume → finish at current elapsed time → inspect/reload persisted results → compare previous runs → reset to a new stopped run while keeping the old report. Termination, natural duration completion, one-active-run conflicts and historical reports after source edits/deletion are covered.

## State and transport guarantees

- Relative REST and WebSocket URLs use the existing Vite proxy; no provider secrets or authoritative localStorage data.
- Abortable reads; empty HTTP 204 responses; field-specific FastAPI validation; useful network/404/409/422/429/503 errors. Mutations and inference never automatically retry.
- Public adapter state is validated. One acceptance rule rejects wrong run identities, invalid sequences and older/equal replacements across REST structural sharing, list/detail cache writes, polling, commands and WebSockets. Sequences persist independently per run.
- The layout owns one shared stream subscription. Ref-counting and microtask disposal handle Strict Mode. A valid snapshot establishes Live; reconnect uses bounded exponential delays with jitter, up to 15 seconds. Disconnected REST polling is guarded by the same acceptance rule. Disposal cancels reconnect/snapshot/poll timers, closes the socket and aborts polling.
- Terminal REST state recovers missed completion and invalidates run/report queries. UI time comes only from server state.
- Commands use immutable payloads and one UUID per deliberate action, serialized per run. Unknown outcomes offer refresh or retry with the original request/key. No optimistic numerical changes. Finish/terminate/reset require consequence confirmation; reset selects a new run identity.
- Charts plot real recorded samples with numeric time spacing and at most 600 unique timestamps. The last sample at a duplicate time is plotted; the original history remains accessible in 100-row table pages. Events render 50 at a time with an explicit expansion control.
- Route modules load on demand while the shell and stream remain mounted.

## AI boundary and limitations

Part D is now included through the existing upstream commit. Normal development supports deterministic mock assistance without credentials and optional configured Gemini/Qwen providers. See `../docs/ai-providers.md`. The unchanged Playwright runner sets `ENABLE_AI=false`, so its real backend reports providers unavailable and inference returns HTTP 503. Core operations work without AI keys/GPU. Refreshing availability is explicit, and configured never means available.

Mission/objective generation, incident explanation, chat and report narrative calls occur only after an explicit user action. Prompts/messages are bounded to 1–8000 characters. Unsaved objective requests omit `mission_id` and include draft context; oversized combined context is rejected with a useful message, never truncated. Editable proposals support Discard and explicit Apply to local state, followed by a separate Save. Existing mission/objective identities are preserved; new and appended identities are fresh. The merged configuration is validated. Rate limits preserve prompts/drafts, respect Retry-After and never automatically retry.

AI envelopes display provider, model, mock flag, fallback reason and latency. Mock responses visibly say DEMO/MOCK. Text is rendered as React text, never injected HTML. The assistant cannot execute suggested commands. Numerical evidence and `report.success` remain separate from narrative; narrative generation refetches persisted reports.

**The standard browser suite uses labeled transport fixtures for successful AI responses. The separate mock-AI suite now verifies the real backend mock service, proposal saves, explanation/chat numerical isolation and persisted report narratives. Live Gemini/Qwen inference remains unverified.**

## Verification

Run from the repository root after stopping existing dev/container servers on ports 8000/5173:

```text
npm run build
npm run lint
npm test
npm run test:e2e
npx playwright test --config e2e/mock-ai.config.ts
git diff --check
```

Final verification on 2026-10-10:

| Command            | Result                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`    | Passed TypeScript and Vite production build, 2582 modules; Vite build 1.45 seconds. Route splitting keeps all JavaScript chunks below 500 kB (entry 433.24 kB, telemetry 356.95 kB). |
| `npm run lint`     | Passed with no warnings or errors.                                                                                                                                                   |
| `npm test`         | 125 passed, 2 PostgreSQL-only skipped, 194 subtests passed in 11.09 seconds.                                                                                                         |
| `npm run test:e2e` | All 39 Chromium tests passed in 1.6 minutes against isolated backend/Vite servers.                                                                                                   |
| `git diff --check` | Passed, no whitespace errors.                                                                                                                                                        |

Objective editor regression: deleting all template objectives and then appending new ones originally crashed because field-array updates preceded watched values. Rows now match watched values by their objective UUID and use the field-array value during the transition. Two real-backend regression tests cover empty-to-new drafts, repeated middle-row replacement, saved objective POST/DELETE, preserved IDs and reload. The focused forms suite passed all seven tests in 22.5 seconds; build/lint and the complete 39-test browser suite passed. Backend source is unchanged; the backend result above is from the prior Part D integration verification.

Fresh application testing: `npm test` passed 125 tests and 194 subtests, with two PostgreSQL-only skips, in 19.51 seconds. `npm run test:e2e` passed all 39 tests in 2.5 minutes. The separate `npx playwright test --config e2e/mock-ai.config.ts` passed all three real mock-AI checks in 28.0 seconds. The application source was unchanged during this additional testing; build/lint results above remain from the verified objective fix. See [the hands-on checklist](TESTING.md) for repeatable manual journeys.

Save/launch fixes: cached mission and preference forms now refresh clean fields while retaining dirty drafts. Confirmed mission responses populate detail/objective/library caches and cancel older reads. New mission navigation retains explicit save confirmation; invalid saves state that nothing was saved. All draft controls, including template and AI Apply, lock while submitting. Future launches let the backend read the current saved speed instead of supplying a potentially stale cached value. An active run appears only on its own mission card; other cards identify the blocking mission and disable Launch, so a newly saved mission cannot open an unrelated older run. Mission Control explains when saved missions become runs and that mission configuration is captured at launch while speed remains adjustable.

The focused seven-test save regression suite passed in 31.9 seconds. The full Chromium suite, including ten new persistence/launch checks, passed all **49 tests in 3.3 minutes** against disposable SQLite storage. The new checks cover stale cached forms, delayed preference reads with a dirty draft, pending-save controls, repeated saves/reloads, confirmation after create, follow-up read failure, deadline validation, an unrelated active run, fresh server speed despite cached dashboard preferences, and the exact speed-1 → build/save → reload → launch journey with all submitted parameters. The final production build and lint passed; all three real mock-AI checks passed in 14.1 seconds. No backend or user-data changes are included.

Launch speed selection: each launchable mission card now exposes **Simulation speed (×)**, initialized from the saved preference. Explicit choices, including fractional speeds, are validated as finite and greater than 0 through 3600 and sent only in that run's creation request. **Use saved default** clears the override; untouched/default launches still let the backend read the current preference. Choices are independent across mission cards, lock during launch, and never update saved preferences or existing runs. Build/lint passed, all four new `launch-speed.spec.ts` tests passed in 12.4 seconds, and 22 existing flow/persistence/responsive regressions passed in 1.1 minutes against isolated SQLite storage.

Mission-save notification verification: build/lint passed, all **57 Chromium tests passed in 2.0 minutes**, and all three real mock-AI checks passed in 13.7 seconds. Four new checks verify notification/redirect only after a confirmed write, preservation on failed/invalid writes, create/edit persistence, dismissal, expiry and the popup/top-of-dashboard layout at 390 px. Existing create/edit/clone and AI proposal tests now reopen the editor from the dashboard to verify reload. Saved cards are identified by mission UUID because names may repeat. Tests use disposable SQLite storage; backend source is unchanged.

Screenshots were visually reviewed for desktop/mobile layout, readable telemetry axes, natural panel sizing and honest unavailable AI. Runtime and console-error checks passed for the desktop/390px real-data journeys. The initial 64-file implementation and subsequent test additions remain inside the assigned frontend/test scope. The frontend lint configuration excludes generated `dist/` and Vite dependency caches so lint remains valid after builds/browser runs.

For local review, run `npm run dev`, then open `http://127.0.0.1:5173`. The normal development store is separate from the disposable Playwright databases.

Setup uses the existing manifests: `npm ci`, `npm run setup` (uv and Python 3.12+), and `npx playwright install chromium`. For this Windows machine, locked Python dependencies were installed using temporary uv and the bundled Python runtime; no dependency declarations or lockfiles changed. The sandbox requires escalated process access for browser servers and pytest temporary directories.

### Real backend versus fixtures

| Tests                                       | Evidence                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commandgrid-flow.spec.ts`                  | Real API persistence, engine, runner, WebSockets, success with optional failure, required failure, pause freeze, early finish, termination/reset, natural completion, active/delete/resource conflicts, launch race, historical snapshots and report comparison. No engine/state fixtures.                     |
| `forms.spec.ts`                             | Real mission/objective writes, reload, scalar metadata, team regeneration (including repeated edits), identity preservation and atomic required swap. One targeted 422 fixture verifies field errors/draft retention.                                                                                          |
| `persistence.spec.ts`                       | Real settings and mission persistence, clean/dirty form refresh, repeated saves, confirmation/validation, pending-save locking, current server launch speed and the correct mission snapshot. Targeted read failures/delays exercise cache and draft safety.                                                   |
| `foundation.spec.ts`, `responsive.spec.ts`  | Actual backend navigation, desktop/390px layouts, real map keyboard selection, no horizontal overflow or runtime errors, chart table alternatives, dialog focus/Escape/restore and persisted default-speed settings.                                                                                           |
| `transport.spec.ts`                         | Actual server state seeds plus targeted delayed REST/WS/command/error fixtures; exercises runtime cache/state/request code, immutable retries and telemetry deduplication without pretending fixture state is a real simulation.                                                                               |
| `connection.spec.ts`                        | Targeted WS reconnect/malformed/run-change/disposal fixtures; actual backend polling recovers a missed real completion/report.                                                                                                                                                                                 |
| `ai.spec.ts`                                | Actual unavailable AI with a successful core run; labeled provider/proposal/rate-limit/explanation/chat/narrative fixtures verify UI boundaries, explicit Save, identity, validation, safe text and numerical isolation.                                                                                       |
| `mock-ai.smoke.ts` with `mock-ai.config.ts` | Real backend mock service, no successful-response fixtures: mission/objective review, separate saves, identity preservation, explanation/chat numerical isolation and persisted report narrative after reload. Live providers are disabled with empty credentials; root Playwright configuration is unchanged. |

Default Playwright uses a newly isolated **SQLite** database for each invocation, as configured by the existing runner. Backend unit/integration tests also run with their default isolated storage. These checks do **not** verify PostgreSQL/TimescaleDB. The two PostgreSQL-only backend tests are skipped without `TEST_DATABASE_URL`; the A/B handoff's older Timescale results are historical, not results of this frontend change.

## Screenshots

All screenshots capture real SQLite-backed API/engine data, never Aurora preview data or successful AI fixtures. Captures reset scroll position to the page top.

- [Desktop mission control](screenshots/mission-control-desktop.png) and [successful persisted report](screenshots/report-desktop.png).
- [1440px control](screenshots/control-1440.png), [dashboard](screenshots/dashboard-1440.png), [builder](screenshots/builder-1440.png), [report with telemetry table](screenshots/report-1440.png).
- [390px control](screenshots/control-390.png), [dashboard](screenshots/dashboard-390.png), [builder](screenshots/builder-390.png), [report with telemetry table](screenshots/report-390.png).

## Changed-file inventory

- Application: `src/App.tsx`, `src/main.tsx`, `src/workspace.css`, `src/utils/format.ts`, `.oxlintrc.json`.
- Layout/map: `src/components/layout/AppLayout.tsx`, `src/components/dashboard/ScenarioMap.tsx`.
- Pages: `Dashboard.tsx`, `MissionBuilder.tsx`, new `ObjectiveDesigner.tsx`, `MissionControl.tsx`, `AfterActionReport.tsx`, `Settings.tsx` in `src/pages/`.
- Public types/UI state: `src/types/mission.ts`, `src/store/workspace.ts`, `src/store/notifications.ts`.
- Services: `api.ts`, `client.ts`, `queries.ts`, `state.ts`, `stream.ts`, `commands.ts`, `history.ts` in `src/services/`.
- Mission drafts: `validation.ts`, `templates.ts`, `useDirtyGuard.ts` in `src/features/missions/`; `MissionForm.tsx`, `ObjectiveEditor.tsx` in `src/components/missions/`.
- Shared feedback/confirmation: `Feedback.tsx`, `Confirm.tsx`, `confirmation.ts`, `NotificationToast.tsx` in `src/components/ui/`.
- Control: `Commands.tsx`, `Events.tsx`, `ObjectiveResults.tsx` in `src/components/control/`.
- Reports: `Telemetry.tsx`, `Comparison.tsx` in `src/components/reports/`.
- AI: `useAI.ts`, `types.ts`, `Availability.tsx`, `Provenance.tsx`, `ProposalPanel.tsx`, `Assistant.tsx`, `ReportNarrative.tsx` in `src/components/ai/`.
- Removed unused preview modules: `src/data/demoMission.ts`, `src/types/preview.ts`, `src/components/layout/PlannedPage.tsx`.
- Tests: updated `../e2e/foundation.spec.ts`; new `helpers.ts`, `transport.spec.ts`, `forms.spec.ts`, `commandgrid-flow.spec.ts`, `connection.spec.ts`, `ai.spec.ts`, `responsive.spec.ts` in `../e2e/`.
- Testing additions: `../e2e/mock-ai.config.ts`, `../e2e/mock-ai.smoke.ts`, `../e2e/persistence.spec.ts`, `../e2e/launch-speed.spec.ts`, `../e2e/save-notification.spec.ts`, and the manual checklist `TESTING.md`.
- Handoff: this README and ten screenshots in `screenshots/`.

## Shared simulation speed

**Settings → Default simulation speed → Save preferences** saves one default for every mission and updates the current unfinished run. Future launches (including guided demos) and resets use that saved value unless a launch explicitly overrides it. **Mission Control → Command console → Run speed (×) → Apply speed**, or its preset buttons, changes only the selected created/running/paused run. Fractional speeds are supported; values must be finite, greater than 0 and at most 3600.

Backend preference and run changes commit together before broadcasting. Elapsed time is settled at the old speed; paused runs stay paused, guided incident boundaries still pause, and terminal reports stay intact. `../backend/tests/test_speed_settings.py` covers the engine/API, persistence/restart, timing, rollback, cancellation, concurrent launches and guided demo boundaries. `../e2e/control-speed.spec.ts` covers custom controls, the global default across missions/resets, validation, failed commands and mobile layout. Follow `TESTING.md` for the manual checklist.

After integrating the newer demo/recovery features, validation passed: production build, frontend lint, backend lint, **160 backend tests** plus 194 subtests (two optional database checks skipped), **63 Chromium browser tests** in 2.7 minutes, and **three real mock-AI browser tests** in 14.0 seconds. Browser and persistence checks used disposable SQLite databases; existing local mission data was preserved.

## Manual and automatic recovery

**Mission Control → Command console → Recovery commands → Automatic recovery** toggles the selected created/running/paused run. Manual is the default. Automatic schedules real repairs 10 simulated seconds after damage is detected, records their source/time/effects, and spends actual resources. Outstanding timers freeze while paused and are cancelled when switching to Manual. Mode changes are server-confirmed and persist across reloads/restarts; resets retain the mode. Recovery controls and guidance execute buttons are disabled while Automatic is active. Guided demos can run unattended in Automatic and retain incident pauses in Manual.

The backend uses a pure, deterministic recovery policy integrated with incident boundaries, preserving objective/deadline evaluation and speed-independent outcomes. Insufficient resources or unsupported capabilities are recorded; Automatic can still fail. Reports label automatic command evidence. `../backend/tests/test_automatic_recovery.py` exercises timings, mode transitions, failure limits, speed/tick invariance, storage and guided runs; `../e2e/automatic-recovery.spec.ts` checks real unattended reports, manual switching, pause/cancellation, failures, reset and mobile behavior. Existing saved missions/reports are preserved and older snapshots default to Manual.

Validation passed: **183 backend tests** and 194 subtests (two optional database checks skipped), **68 Chromium tests** in 3.9 minutes, **three real mock-AI browser checks** in 17.4 seconds, production build, frontend/backend lint and formatting. The 23 new backend checks include matching automatic outcomes at 1×, 5×, 30×, 120× and 3600×. All persistence/browser checks used isolated SQLite storage.

## Milestones and integration

- [x] C1 typed transport, gated shared cache and connected application shell.
- [x] C2 four-step create/edit/clone builder and persistent parameters.
- [x] C3 reusable registry-aware objective editing and atomic coordinated updates.
- [x] C4 real mission/run/report dashboard and guarded launch/delete workflows.
- [x] C5 shared validated live stream, disconnected polling, real map/telemetry/evidence.
- [x] C6 immutable serialized recovery commands, same-key retries and preserved reset history.
- [x] C7 persisted reports, authoritative outcomes and real report comparison.
- [x] C8 server preferences and explicit, unavailable-safe AI frontend workflows.
- [x] C9 complete regression, screenshots and handoff results.

Shared speed controls extend the command API and atomic preference persistence without adding dependencies or changing the database schema. The requested `docs/superpowers/plans/2026-10-10-commandgrid-part-c-complete.md` does not exist in the integrated checkout; progress is recorded here rather than creating or modifying an unrelated plan. The named executing-plans/Caveman skills were not installed, so the assignment and available repository contracts were followed directly. No coordinator thread was provided, and no external messages were sent.

Remaining qualification: verify live provider calls; coordinate an isolated Timescale browser configuration if that storage evidence is needed. No application defects were found by these additional checks. No paid infrastructure was provisioned.
