# Part A handoff — 2026-10-10

## A/B integration update

Part B commit c9d03f0 is now the branch baseline. The real engine is loaded through app.services.missions.engine_adapter.EngineAdapter. Its native numerical snapshot is saved privately with each run and idempotent command result. The adapter translates systems, event sequences, incident fields and history to docs/api-contract.md; HTTP/WebSocket responses omit the private snapshot. Recovery events survive subsequent engine commands. Native telemetry samples now capture system health/resources, and example JSON has been regenerated.

The missing frontend preview import is restored with its original preview types. The frontend remains a labeled foundation preview; Part C's full backend screen wiring and Part D's AI service are pending. Unfinished Part C client/store/type files and Part D source drafts remain local and are excluded from the Part A commit.

The complete backend suite now runs via npm test. Real-engine integration tests cover PostgreSQL/Timescale persistence, idempotency, WebSocket updates, telemetry windows, completed/failed/terminated reports, reset, restart/resume and background wall-clock scaling. Frontend build/lint and both foundation browser tests pass. Backend and frontend Docker images build successfully. See docs/demo.md for the integrated API flow.

Final staged-source verification (without unfinished C/D source drafts): 60 backend tests and 194 subtests pass with TEST_DATABASE_URL set to the dedicated Timescale test database. Frontend build, backend/frontend lint and formatting checks pass. Both Playwright foundation tests pass. Container readiness confirms TimescaleDB 2.23.1 and simulation_engine_ready=true; nginx API proxy/SPA fallback works. The combined host dev launcher also serves readiness on port 8000 and Vite on port 5173.

## Implemented

- Root npm workspace setup, Python 3.12+ uv environment/lockfile, combined launcher.
- FastAPI mission/objective CRUD, registry, settings, reports, simulations and AI route boundaries.
- SQLAlchemy relational storage and immutable Alembic initial migration.
- Timescale telemetry/event hypertables, indexes, normalized time-window queries.
- Atomic state/command/report writes, replay/conflict semantics, durable snapshots, reset replay.
- One active run, OS lock, PostgreSQL advisory lock.
- Injectable controller, monotonic clock, pause settlement, restart recovery, complete WebSocket snapshots.
- Request-size limit, strict speed/seed validation, restrictive CORS/WS browser origins.
- AI context/schema/rate/concurrency/timeout boundary and audits; numerical reports protected from narratives.
- Docker backend/database path and prepared frontend nginx build/proxy.

## Verification at initial Part A handoff (historical)

npm run setup: pass.
npm test (SQLite default fixtures): 19 pass, two PostgreSQL-only skips.
TEST_DATABASE_URL + npm test: 21 pass.
npm run lint:backend: pass.
npm run lint: pass.
docker compose config --quiet: pass.
docker compose build backend: pass.
docker compose up -d db backend: healthy backend/DB and real PostgreSQL readiness.
Database extension: TimescaleDB 2.23.1.
Hypertables: telemetry_samples, mission_events.
Frontend build: blocked by missing frontend/src/data/demoMission.ts import in Dashboard.tsx.
Playwright: confirmed the same import failure; one foundation test failed, remaining test not run.
Full backend tests: collection blocked by missing app.simulation.engine.

The PostgreSQL fixture runs repository/API tests against isolated schemas in commandgrid_test. Controller tests inject a test-only engine; no numerical simulation result is claimed verified.

## Part B interface

app.simulation.engine supplies the four native functions. Startup wraps them in EngineAdapter automatically. The native schemas stay in app.schemas.simulation; the public API/storage schemas live in app.services.missions.state. The adapter owns translation, without numerical calculations.

Expected functions: create_state, apply_command, tick, build_report.
State must be a valid MissionState with immutable inputs, monotonic sequence/events and append-only history.
tick receives already-accelerated simulated seconds.
build_report produces JSON-serializable terminal results, including trusted objectives/metrics and created_at.

Events/history are persisted incrementally. If your sampling format changes, coordinate it before altering history semantics. The controller records system recovery/reset events outside the pure engine.

Run statuses running become paused on restart; created stays created. Reset requires a terminal old run and creates a new UUID, preserving historical records.

## Part C integration

REST base /api/v1 and Vite proxy to localhost8000 are ready.
Replace the restored, explicitly labeled preview with actual backend data when implementing Part C.
AI report analysis is the full envelope (provider/model/mock/fallback_reason/data/usage/latency_ms); update frontend type/rendering to show data.text and provenance.
WebSocket reconnect sends a fresh full state with sequence; do not apply stale REST or repeated stream data.
Command keys must remain stable for retries of the same action.
Root Playwright starts isolated backend storage and frontend; stop already-running services first.
Existing foundation tests still expect the old Operation Aurora preview; update them for real backend data.

## Part D integration

Implement app.services.ai.service.AIService(settings), async execute/status/aclose according to shared contract.
Settings expose the lower_case config attributes documented in Part D.
Return validated task envelopes with provider provenance; mock must match provider=mock.
generate_objectives data is a plain list; generate_mission data is a complete schema-valid mission; text tasks return {text:string}.
The gateway validates, audits and persists analysis independently; it never autosaves proposals or executes commands.
Missing service returns 503 and provider status explicitly unavailable/unverified.
Do not perform LLM calls on ticks.

## Remaining integrated checks

Real B engine tests, API success/failure lifecycles, frontend build and foundation browser flow are verified. Part C's complete application flow, Part D adapter tests and live configured inference remain pending. Paid Vultr provisioning is not part of Part A.

The integrated Part A milestone includes the shared setup, backend, B adapter and preserved frontend preview. Part C client/store/type drafts and Part D provider drafts are not included.
