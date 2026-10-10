# Part C — Frontend and Browser Experience Implementation Plan

The expanded plan for the integrated A/B baseline is [CommandGrid Part C — Complete Frontend Implementation Plan](../2026-10-10-commandgrid-part-c-complete.md). Use that document for the current full coding-agent assignment; the original outline below is retained for context.

> **For agentic workers:** Use the executing-plans skill to work through the checkboxes. This assignment is one workstream in the CommandGrid parallel plan. Request coordinator review when changing a shared interface.

**Goal:** Connect mission design, live recovery operations and persisted reports in the existing polished UI.

**Architecture:** React Query owns server data, Zustand holds small UI selection state, and React Hook Form/Zod validates forms. REST and WebSockets consume the shared contract; numerical simulation never runs in the browser.

**Tech Stack:** React, TypeScript, Vite, Tailwind, Lucide, Router, TanStack Query, Zustand, React Hook Form, Zod, Recharts, Playwright.

## Assignment context

Repository: `C:/Users/vihaa/OneDrive/Documents/ChatGPT/apollo knight hacks/Apollo`.

Read `docs/api-contract.md`, the master plan `docs/superpowers/plans/2026-10-10-commandgrid-parallel.md`, and existing files in your ownership area before editing. Existing code is draft; passing checks, rather than file presence, determine completion. Preserve useful implementation and the established dark operations UI.

This is a fictional, noncombat infrastructure/disaster-support simulator. Only Communications Recovery is enabled initially. Other categories must be visibly unavailable. No real operational locations, targeting, weapon control, or arbitrary executable parameter rules.

In a shared checkout, edit only your assigned files. Do not stage other agents' work, reset files, change branches, or commit/push without coordinator instruction. In separate checkouts, use a dedicated `codex/` branch and commit only your assigned files; the coordinator merges. Root dependency installation and lockfiles belong to Agent A. Send required dependencies to A. Never use paid cloud resources without a separate explicit instruction.

Return: changed files; implemented behavior; exact commands and results; unresolved failures; interface changes; external integrations tested live versus mocked. Do not claim completion from mocks or source inspection alone.

## File ownership

Own `frontend/**` and `e2e/**`. A installs dependencies and owns root package/lockfiles and Playwright configuration. Coordinate frontend package dependency changes with A.

Preserve existing sidebar, topbar, dark colors, typography and fictional SVG map. Draft API/query/store files may already exist; inspect and finish them.

## Task C1 — Typed transport and application shell

- [ ] Define TypeScript mission/objective/state/report/AI-envelope types matching backend fields. Normalize registry minimum/maximum and supported_modes; do not invent a second contract.
- [ ] Implement REST client with useful detail/validation errors, query invalidation after mutations and loading/error/empty states.
- [ ] Implement typed routes for Dashboard, Mission Builder, Objective Designer, Mission Control, Reports and Settings.
- [ ] Show actual active mission, connection, status and simulated time in global navigation. Remove placeholder working-status claims.
- [ ] Configure Vite proxy to backend REST/health/readiness and WebSocket endpoints.
- [ ] Add bounded WebSocket reconnect backoff, fresh snapshot handling, per-run sequence deduplication and cleanup on route/run change. Reconcile REST responses without overwriting newer stream state.

## Task C2 — Mission and objective design

- [ ] Build four steps: information/template/duration; operational parameters; objectives; review/save.
- [ ] Support editing saved configurations and adding/removing objectives. Fetch supported metric modes/bounds from registry.
- [ ] Validate names, durations, finite thresholds, integer counts, percentage bounds, required objectives, deadline applicability and deadline within mission.
- [ ] Provide supported parameter controls and scalar custom metadata. When team_count changes, send empty support_teams for server regeneration.
- [ ] Mark non-Communications categories unavailable. Save through real mission/objective APIs; show server validation clearly.
- [ ] AI generation buttons return proposals; user reviews/edits then explicitly applies/saves. Show provider, model and mock/fallback label. No automatic mission persistence.

## Task C3 — Dashboard and live Mission Control

- [ ] Render saved mission library, active run, completed counts/results and recent activity from backend data.
- [ ] Launch selected mission, respecting one-active-run conflicts, then navigate to control.
- [ ] Render fictional facilities/teams, communication/equipment/resources/power telemetry, objective status, event feed and selectable incident details.
- [ ] Wire start/pause/resume/finish/terminate/reset and recovery commands. Generate one UUID idempotency key per user action; reuse it when retrying that action.
- [ ] Disable unavailable/illegal controls while preserving server validation. Show command pending/error state and confirmed changes.
- [ ] Allow demonstration incidents, acknowledgment and supported restoration. No client-side hardcoded success.
- [ ] Show AI explanations/chat from explicit requests, visually separate from trusted telemetry and objective results.
- [ ] Handle disconnected/paused/terminal state correctly; unfinished capabilities are visibly unavailable.

## Task C4 — Reports and Settings

- [ ] List persisted historical reports and display required/optional outcomes, final metrics, incident timeline and command history.
- [ ] Chart persisted health/metric history with Recharts. Handle missing samples and long histories without fabricating points.
- [ ] Provide simple previous-result comparison using real saved report values.
- [ ] Request optional after-action narrative explicitly, displaying provider/mock provenance independently of pass/fail.
- [ ] Settings edit provider preference, demo mode and future-run speed; show DB/Gemini/Qwen status without secrets.
- [ ] Verify responsive layouts, keyboard labels, focus, loading, failures and empty states.

## Task C5 — Tests and browser handoff

- [ ] Form tests: invalid duration/percentage/count, deadline beyond duration, all-optional rejection, required objective creation/deletion and parameter editing.
- [ ] Navigation/status tests: route links, backend loading/unavailable states, paused controls and terminal report display.
- [ ] Stream tests: reconnect snapshot, duplicate/older sequence ignored, run change clears prior stream, REST response cannot roll back newer state.
- [ ] Write an integrated Playwright flow in `e2e/commandgrid-flow.spec.ts`: create mission → edit parameter/objective → save → launch/start → trigger incident → recovery → finish → verify report.
- [ ] Add successful and unsuccessful objective outcomes, plus explicit unavailable-AI fallback coverage. Use an isolated test DB via A; do not mock the core backend in end-to-end tests.
- [ ] Supply A the server/test setup needs. Fix defects within frontend/e2e ownership.

Run after A installs deps:

```powershell
npm run build --workspace frontend
npm run lint --workspace frontend
npm run test:e2e
```

Expected: compile/lint exit 0; relevant Playwright tests pass. Transport fixtures are acceptable for UI unit tests; integrated flow must use actual backend.

## Hand off

Return screenshots or browser evidence where available, covered user flows, exact test results, remaining API dependencies and accessibility/responsive issues. Do not alter numerical engine or persistence behavior to make the UI appear successful.
