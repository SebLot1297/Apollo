# Part A — Backend, Database and Integration Implementation Plan

> **For agentic workers:** Use the executing-plans skill to work through the checkboxes. This assignment is one workstream in the CommandGrid parallel plan. Request coordinator review when changing a shared interface.

**Goal:** Make local startup, persisted API operations and the real-time runner work end to end.

**Architecture:** A single FastAPI app coordinates pure engine functions from Agent B, SQLAlchemy repositories and an in-process broadcast hub. Commit state before publishing updates; inference from Agent D stays outside tick processing.

**Tech Stack:** Python 3.12+, FastAPI, Pydantic, SQLAlchemy 2, Alembic, psycopg, TimescaleDB, asyncio, Docker Compose, Node/npm launchers.

## Assignment context

Repository: `C:/Users/vihaa/OneDrive/Documents/ChatGPT/apollo knight hacks/Apollo`.

Read `docs/api-contract.md`, the master plan `docs/superpowers/plans/2026-10-10-commandgrid-parallel.md`, and existing files in your ownership area before editing. Existing code is draft; passing checks, rather than file presence, determine completion. Preserve useful implementation and the established dark operations UI.

This is a fictional, noncombat infrastructure/disaster-support simulator. Only Communications Recovery is enabled initially. Other categories must be visibly unavailable. No real operational locations, targeting, weapon control, or arbitrary executable parameter rules.

In a shared checkout, edit only your assigned files. Do not stage other agents' work, reset files, change branches, or commit/push without coordinator instruction. In separate checkouts, use a dedicated `codex/` branch and commit only your assigned files; the coordinator merges. Root dependency installation and lockfiles belong to Agent A. Send required dependencies to A. Never use paid cloud resources without a separate explicit instruction.

Return: changed files; implemented behavior; exact commands and results; unresolved failures; interface changes; external integrations tested live versus mocked. Do not claim completion from mocks or source inspection alone.

## File ownership

Own root `package.json`, `package-lock.json`, `.gitignore`, `.env.example`, `docker-compose.yml`, `playwright.config.ts`; `scripts/setup.mjs`, `dev.mjs`, `backend.mjs`; `backend/pyproject.toml`, lockfile, `alembic.ini`, `alembic/**`; `backend/app/__init__.py`, `main.py`, `migrate.py`; `backend/app/core/**`, `db/**`, `models/**`, `repositories/**`, `api/**`, `websocket/**`, `services/missions/**`, `services/objectives/**`, `services/reports/**`; `backend/tests/test_api.py`, `test_repositories.py`, `test_integration.py`; `infrastructure/docker/**`, `infrastructure/database/**`; `README.md`, `docs/architecture.md`, `docs/demo.md`, and shared contract updates.

B owns schemas/engine/seed. C owns frontend and e2e tests. D owns AI adapters and Vultr files. Do not implement competing versions.

## Task A1 — Workspace and baseline service

- [ ] Inspect draft changes; preserve them. Check Python venv and install backend dev dependencies inside it.
- [ ] Make root npm workspace scripts target `frontend/`; `npm run dev` starts backend and frontend from this repository regardless of caller shell details.
- [ ] Install C's requested React Query, Zustand, React Hook Form, Zod and resolver dependencies; coordinate changes to frontend package manifest.
- [ ] Create settings/env loading, restrictive local CORS, safe structured logging and bounded request bodies. Reject oversized body with 413; never log credentials.
- [ ] Add `/health` and `/ready`; readiness actually queries DB and identifies configured storage.
- [ ] Provide actionable startup errors for missing Python environment, failed migrations and occupied ports. Shut down only this launcher's child processes.

## Task A2 — Database schema and repositories

- [ ] Add mission, objective, run, command, report and AI-request ORM models. Use JSONB on PostgreSQL for validated config/state snapshots; ordinary relational fields/indexes support lookup.
- [ ] Add telemetry_samples and mission_events with wall-clock time, run ID and simulated time. Composite uniqueness includes partition time.
- [ ] Write Alembic relational/index migrations and Timescale extension/hypertable creation targeting the verified installed version.
- [ ] Implement validated mission/objective CRUD; objective edits revalidate the complete mission. Preserve historical run snapshots when missions change or are deleted.
- [ ] Persist initial Operation Signal Restore through B's seed function idempotently.
- [ ] Add run/time-window telemetry, event and historical report queries. Insert telemetry in bounded batches.
- [ ] Verify migrations and repository round trips against real local TimescaleDB; record server/extension version. A labeled SQLite convenience fallback cannot substitute for this check.

## Task A3 — API, runner and broadcasts

- [ ] Implement all mission/objective/simulation/report/registry/settings routes from shared contract, with UUID request validation and useful 404/409/422 errors.
- [ ] Enforce one active created/running/paused run; serialize command/tick operations with one controller lock.
- [ ] Add command idempotency storage: same run/key/body returns stored result; changed body with reused key gives 409.
- [ ] Apply B's engine command, persist state/events/telemetry/command result/report in one transaction, then broadcast. On DB failure publish no uncommitted state.
- [ ] Run one asyncio worker, using a monotonic clock and configurable accelerated time. Never advance paused/terminal runs.
- [ ] Prevent duplicate worker processes; document single-worker deployment. On restart restore state safely and require explicit resumption rather than silently advancing downtime.
- [ ] WebSocket connect/reconnect sends current snapshot; updates/completion have monotonically increasing sequence. Disconnect slow clients without blocking engine or leaking sockets.
- [ ] Reset creates a new run and preserves previous records. Completion/termination creates a durable report from B's numerical results.

## Task A4 — AI routes and operational settings

- [ ] Consume D's service interface; implement generate-mission/objectives, explain-incident, chat, generate-report and providers/status endpoints.
- [ ] Pass only bounded relevant context. Validate referenced mission/run/incident existence. Generation returns proposals without autosaving.
- [ ] Persist AI task/provider/model/status/latency/token usage/estimated cost when known; never invent billing estimates or store secrets.
- [ ] Persist AI report analysis separately from trusted numerical results, including provider/mock/fallback provenance.
- [ ] Settings expose storage and provider readiness, demo mode and future-run speed without API keys. Validate updates.

## Task A5 — Deployment, integration and documentation

- [ ] Provide local DB Compose, backend/frontend container builds, health checks, volumes, env template and tested setup instructions.
- [ ] Document single-user/local scope; public deployment requires auth, authorization and ownership. D handles secured inference deployment.
- [ ] Integrate C's browser tests through root Playwright configuration with both services and isolated test data.
- [ ] Write restart, transaction rollback, concurrent-command, duplicate-key/conflicting-key, telemetry-window and WebSocket snapshot/reconnect tests.
- [ ] Run success and failure demos against persisted backend data. Document actual results and remaining unverified external services.

## Required checks

From repo root after creating the launcher:

```powershell
npm install
npm run setup
npm run db:up
npm run db:migrate
npm test
npm run build
npm run lint
npm run test:e2e
```

Expected: setup/migrations exit 0; backend tests pass; frontend compiles/lints; browser flow passes against real backend. Before launchers exist use `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_api.py backend/tests/test_repositories.py backend/tests/test_integration.py -q`.

Acceptance tests must cover: command retries returning identical results, conflicts returning 409, one active run, DB rollback producing no broadcast, paused time unchanged, terminal reports available after restart, Timescale hypertables present and queryable.

## Hand off

Publish working API URLs, tested database versions, exact setup commands, migrations/test evidence and integration failures to B/C/D. Final completion report must distinguish core verified demo from unverified cloud inference.

## Execution plan — 2026-10-10

The existing Part B engine and Part D AI service are not yet implemented. Integrate through injectable interfaces; production endpoints return 503 until the actual modules are available. Test doubles may verify orchestration in tests only. Do not add numerical or AI substitutes to Part A.

1. **Setup:** create backend/pyproject.toml, scripts/backend.mjs, scripts/setup.mjs and scripts/dev.mjs; convert root package.json to a frontend workspace. Install backend dependencies in backend/.venv and coordinate frontend dependencies through npm. Expected: correct Vite frontend and health/readiness endpoints reachable.
2. **Repository tests first:** create backend/tests/test_repositories.py testing durable mission CRUD, objective validation, run snapshots, telemetry windows, atomic commands/report writes and rollback. Run tests to expose missing repository behavior before implementing.
3. **Storage:** create backend/app/core/config.py, backend/app/db/database.py, backend/app/models/storage.py and backend/app/repositories/store.py. Alembic migration 0001 creates relational tables, unique idempotency keys, time-series indexes and Timescale hypertables. Seed via Part B's demo_mission() without overwriting saved edits.
4. **API tests first:** create backend/tests/test_api.py for CRUD/status validation, missing engine/service 503s, secret-free settings, body limit 413, persistent settings and readiness. Implement backend/app/main.py plus focused backend/app/api modules; use create_app(settings, engine_api=None, ai_service=None) for dependency injection.
5. **Runner tests first:** create backend/tests/test_integration.py using a test-only engine to verify single active run, serialized commands/ticks, replay/conflict, pause, restart, commit-before-broadcast, snapshot/reconnect and durable reports. Implement backend/app/services/missions/controller.py and backend/app/websocket/hub.py; use monotonic time, a process lock and PostgreSQL advisory lock.
6. **AI boundary:** implement bounded request schemas/routes and audit writes. Load Part D lazily; validate all output and preserve narrative provenance. Unavailable providers do not stop simulation. No mock in production Part A code.
7. **Deployment:** add Compose, backend/frontend Dockerfiles, nginx proxy and .env.example. Start local TimescaleDB; run migrations and repository/API tests against PostgreSQL using a dedicated test database. Record actual extension version and hypertable evidence.
8. **Verification:** run `npm test`, `npm run lint:backend`, `npm run build`, `npm run lint`, then the existing browser tests if the frontend permits. Record Part B/C/D gaps honestly. Write README.md, docs/architecture.md and docs/demo.md with exact startup and handoff commands.

### Tracking

- [x] Dependency setup and combined launcher verified.
- [x] Mission/objective CRUD and settings persist across restart.
- [x] PostgreSQL/Timescale migrations and time-window queries verified.
- [x] Controller/idempotency/rollback/WebSocket tests pass using an injected test-only engine.
- [x] AI route boundary and audits tested independently of credentials.
- [x] Backend/database containers build and run; frontend preview import restored and container build passes.
- [x] Part B integrated through a public-state adapter with durable private native snapshots.
- [x] Real-engine success/failure/reset/restart/WebSocket/telemetry API flows verified against TimescaleDB.
- [x] Frontend foundation desktop/mobile browser tests pass.
- [ ] Part C full application and Part D provider integration remain pending.
