# CommandGrid frontend handoff — Part C

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
| `/settings`                                   | Persistent provider/demo/future-speed preferences, database mode, backend/engine readiness and configured versus available provider status.                                                                                                   |

Only Communications Recovery is available. All terrain/locations are fictional. The obsolete Aurora preview source and planned-page component have been removed. Forms retain unsaved drafts after errors and confirm dirty navigation. Dialogs trap/restore focus and support Escape. Mobile navigation, visible keyboard focus, reduced motion and chart tables are supported.

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

**Successful frontend AI tests use labeled transport fixtures. Live Gemini/Qwen inference and frontend-driven backend mock persistence have not been verified by this browser configuration. Part D's backend tests cover its mock service and persistence separately.**

## Verification

Run from the repository root after stopping existing dev/container servers on ports 8000/5173:

```text
npm run build
npm run lint
npm test
npm run test:e2e
git diff --check
```

Final verification on 2026-10-10:

| Command            | Result                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`    | Passed TypeScript and Vite production build, 2582 modules; Vite build 1.41 seconds. Route splitting keeps all JavaScript chunks below 500 kB (entry 433.24 kB, telemetry 356.95 kB). |
| `npm run lint`     | Passed with no warnings or errors.                                                                                                                                                   |
| `npm test`         | 125 passed, 2 PostgreSQL-only skipped, 194 subtests passed in 11.09 seconds.                                                                                                         |
| `npm run test:e2e` | All 37 Chromium tests passed in 1.5 minutes against isolated backend/Vite servers.                                                                                                   |
| `git diff --check` | Passed, no whitespace errors.                                                                                                                                                        |

Screenshots were visually reviewed for desktop/mobile layout, readable telemetry axes, natural panel sizing and honest unavailable AI. Runtime and console-error checks passed for the desktop/390px real-data journeys. All 64 changed/added/removed files are inside the assigned frontend/test scope. The frontend lint configuration excludes generated `dist/` and Vite dependency caches so lint remains valid after builds/browser runs.

For local review, run `npm run dev`, then open `http://127.0.0.1:5173`. The normal development store is separate from the disposable Playwright databases.

Setup uses the existing manifests: `npm ci`, `npm run setup` (uv and Python 3.12+), and `npx playwright install chromium`. For this Windows machine, locked Python dependencies were installed using temporary uv and the bundled Python runtime; no dependency declarations or lockfiles changed. The sandbox requires escalated process access for browser servers and pytest temporary directories.

### Real backend versus fixtures

| Tests                                      | Evidence                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commandgrid-flow.spec.ts`                 | Real API persistence, engine, runner, WebSockets, success with optional failure, required failure, pause freeze, early finish, termination/reset, natural completion, active/delete/resource conflicts, launch race, historical snapshots and report comparison. No engine/state fixtures. |
| `forms.spec.ts`                            | Real mission/objective writes, reload, scalar metadata, team regeneration (including repeated edits), identity preservation and atomic required swap. One targeted 422 fixture verifies field errors/draft retention.                                                                      |
| `foundation.spec.ts`, `responsive.spec.ts` | Actual backend navigation, desktop/390px layouts, real map keyboard selection, no horizontal overflow or runtime errors, chart table alternatives, dialog focus/Escape/restore and persisted future-speed settings.                                                                        |
| `transport.spec.ts`                        | Actual server state seeds plus targeted delayed REST/WS/command/error fixtures; exercises runtime cache/state/request code, immutable retries and telemetry deduplication without pretending fixture state is a real simulation.                                                           |
| `connection.spec.ts`                       | Targeted WS reconnect/malformed/run-change/disposal fixtures; actual backend polling recovers a missed real completion/report.                                                                                                                                                             |
| `ai.spec.ts`                               | Actual unavailable AI with a successful core run; labeled provider/proposal/rate-limit/explanation/chat/narrative fixtures verify UI boundaries, explicit Save, identity, validation, safe text and numerical isolation.                                                                   |

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
- Public types/UI state: `src/types/mission.ts`, `src/store/workspace.ts`.
- Services: `api.ts`, `client.ts`, `queries.ts`, `state.ts`, `stream.ts`, `commands.ts`, `history.ts` in `src/services/`.
- Mission drafts: `validation.ts`, `templates.ts`, `useDirtyGuard.ts` in `src/features/missions/`; `MissionForm.tsx`, `ObjectiveEditor.tsx` in `src/components/missions/`.
- Shared feedback/confirmation: `Feedback.tsx`, `Confirm.tsx`, `confirmation.ts` in `src/components/ui/`.
- Control: `Commands.tsx`, `Events.tsx`, `ObjectiveResults.tsx` in `src/components/control/`.
- Reports: `Telemetry.tsx`, `Comparison.tsx` in `src/components/reports/`.
- AI: `useAI.ts`, `types.ts`, `Availability.tsx`, `Provenance.tsx`, `ProposalPanel.tsx`, `Assistant.tsx`, `ReportNarrative.tsx` in `src/components/ai/`.
- Removed unused preview modules: `src/data/demoMission.ts`, `src/types/preview.ts`, `src/components/layout/PlannedPage.tsx`.
- Tests: updated `../e2e/foundation.spec.ts`; new `helpers.ts`, `transport.spec.ts`, `forms.spec.ts`, `commandgrid-flow.spec.ts`, `connection.spec.ts`, `ai.spec.ts`, `responsive.spec.ts` in `../e2e/`.
- Handoff: this README and ten screenshots in `screenshots/`.

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

No backend interface/dependency change is required. The requested `docs/superpowers/plans/2026-10-10-commandgrid-part-c-complete.md` does not exist in the integrated checkout; progress is recorded here rather than creating or modifying an unrelated plan. The named executing-plans/Caveman skills were not installed, so the assignment and available repository contracts were followed directly. No coordinator thread was provided, and no external messages were sent.

Remaining qualification: verify live provider calls and frontend-driven backend mock persistence; coordinate an isolated Timescale browser configuration if that storage evidence is needed. No application defects are currently known after the full regression. No paid infrastructure was provisioned.
