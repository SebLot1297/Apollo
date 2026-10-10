# CommandGrid Parallel Implementation Plan

> **For agentic workers:** Use the executing-plans skill to work through the checkboxes. This assignment is one workstream in the CommandGrid parallel plan. Request coordinator review when changing a shared interface.

**Goal:** Build the requested full-stack CommandGrid demo through four concurrently implementable assignments.

**Architecture:** One FastAPI backend owns persistence and a single simulation runner. A pure Python engine supplies numerical state; React consumes REST and WebSocket data; AI adapters provide optional proposals and narratives.

**Tech Stack:** React, TypeScript, Vite, Tailwind, FastAPI, Python 3.12+, SQLAlchemy, Alembic, TigerData/TimescaleDB, Gemini, Qwen/vLLM.

## Checkout at plan creation

Repository: `C:/Users/vihaa/OneDrive/Documents/ChatGPT/apollo knight hacks/Apollo`.
Working branch at preparation: `codex/commandgrid-fullstack`.

The original foundation was pushed on `codex/commandgrid-foundation`. Full-stack work is uncommitted draft: frontend files have moved into `frontend/`; schema, registry, seed, engine-test and AI-adapter drafts exist. The backend engine implementation, API, database setup and combined launcher are not yet verified or complete. Root npm scripts still need repair for the moved frontend. Python 3.12 virtual environment exists at `backend/.venv`; dependency installation still needs completion. Docker Desktop was started, but TimescaleDB migrations have not been verified.

This document divides the work; creating it does not launch additional coding agents or certify any phase complete.

## Four parallel assignments

Part A update (2026-10-10): backend/API, real TimescaleDB migrations and containers, startup scripts and controller boundaries are implemented. See docs/part-a-handoff.md for current verification and remaining Part B/C/D integration work. The original draft status above describes the starting point.

| Agent                            | Responsibility                                                                                         | Exclusive write ownership                                                                                                                                                                                                                                                                                                                                                                                                                                | Handoff document                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A — Backend and integration lead | Workspace startup, DB/migrations, API, runner, WebSockets, persistence, deployment, integration checks | Root configs/lockfiles, scripts/, backend/app/{core,db,models,repositories,api,websocket}/, backend/app/services/{missions,objectives,reports}/, backend/app/main.py, backend/app/migrate.py, backend/app/**init**.py, backend/pyproject.toml, backend/alembic/, backend/alembic.ini, backend/tests/test_api.py, test_repositories.py, test_integration.py, infrastructure/{docker,database}/, README.md, architecture/demo docs, root Playwright config | [Part A](2026-10-10-commandgrid-parallel/part-a-backend.md)    |
| B — Simulation and objectives    | Validated mission schemas, registries, seed, deterministic engine, numerical reports                   | backend/app/schemas/, backend/app/simulation/, backend/app/data/, backend/tests/test_engine.py, test_schemas.py, docs/objective-semantics.md                                                                                                                                                                                                                                                                                                             | [Part B](2026-10-10-commandgrid-parallel/part-b-simulation.md) |
| C — Frontend                     | All pages, forms, API client, live Mission Control, reports, UI tests                                  | frontend/ except dependency changes coordinated with A; e2e/                                                                                                                                                                                                                                                                                                                                                                                             | [Part C](2026-10-10-commandgrid-parallel/part-c-frontend.md)   |
| D — AI and Vultr inference       | Gemini/Qwen/mock adapters, validated generation, routing, limits, context, inference deployment files  | backend/app/services/ai/, backend/tests/test_ai.py, infrastructure/vultr/, docs/ai-providers.md                                                                                                                                                                                                                                                                                                                                                          | [Part D](2026-10-10-commandgrid-parallel/part-d-ai.md)         |

A acts as coordinator while B, C and D work in parallel. This fits four active coding slots. Each owner writes its own tests. The final integrated acceptance flow belongs to A, with C owning browser test source.

## Shared interfaces: settle before integration

- [ ] A reviews and freezes `docs/api-contract.md` with B/C/D before incompatible changes.
- [ ] B publishes importable schema exports, registry shapes and engine signatures immediately.
- [ ] D publishes `AIService` constructor/configuration, `execute`, `status` and `aclose` signatures.
- [ ] A installs frontend dependencies and backend dev dependencies; only A writes root lockfiles.
- [ ] C implements against the contract; test fixtures may simulate the transport, but production UI reads backend state.
- [ ] All interface changes go through A and are communicated to every affected owner.

Engine exports:

```python
create_state(mission, random_seed=42, run_id=None, time_multiplier=30) -> MissionState
apply_command(state, command_type, payload=None) -> MissionState
tick(state, seconds) -> MissionState
build_report(state) -> dict
```

AI exports:

```python
AIService(config=None, *, providers=None)
await service.execute(task, prompt, context={}, provider=None, demo_mode=False)
await service.status()
await service.aclose()
```

JSON: snake_case, UUID strings, UTC timestamps. REST base: `/api/v1`; collection responses are plain arrays. Errors use `detail`. The shared contract defines complete payloads; no agent invents a second state format.

WebSocket:

```json
{
  "type": "snapshot",
  "sequence": 12,
  "state": { "run_id": "...", "status": "running" }
}
```

The example illustrates the envelope only; actual state must satisfy the full schema. Reconnect returns a complete current snapshot; clients reject older/duplicate updates for the same run.

## Parallel execution order

### Gate 0 — Contracts and startup

A fixes workspace/dependency setup and creates health/readiness endpoints. B completes importable schemas and registry first. C builds typed navigation/forms against fixtures in tests. D builds provider tests without credentials. All four can begin immediately; C and D do not wait for database deployment.

### Gate 1 — Independently testable modules

A verifies mission/objective CRUD and migrations on actual local TimescaleDB. B verifies deterministic numerical tests. C verifies form validation/navigation with transport fixtures. D verifies schema validation, provider failure and mock labeling with mocked external calls.

### Gate 2 — Working vertical slice

A connects engine → transactional persistence → broadcasts. C connects Mission Builder → saved mission → launch → live state → recovery command → persisted report. B supplies accurate pass/fail and history. D remains optional; the core flow works with unavailable inference.

### Gate 3 — AI and deployment

D connects to A's AI routes and audit persistence. C exposes review/edit/save for generated proposals and separately labeled report narratives. A verifies Docker/local setup. Vultr deployment files are prepared; paid GPU provisioning and live model verification require available infrastructure and credentials.

### Gate 4 — Release checks

A runs backend tests, frontend build/lint and Playwright against integrated services. Verify both successful and unsuccessful missions, restart persistence, pause/resume, idempotency conflicts, WebSocket reconnects and unavailable AI. Fix issues in the owning workstream. Record exact evidence and any unverified external milestones.

## Coordination rules

1. Shared checkout: disjoint file ownership, no concurrent dependency installers, no agent branch switching or broad Git staging.
2. Separate coding sessions/checkouts: start from one shared checkpoint including current drafts; use `codex/commandgrid-backend`, `codex/commandgrid-simulation`, `codex/commandgrid-frontend`, `codex/commandgrid-ai`. A integrates contract/schema changes first.
3. Dependency on another owner means consume its interface or request a change; never silently edit its files.
4. Every owner reports tests and failures, not estimates of completeness.
5. Simulation state and pass/fail remain deterministic Python outputs. AI cannot execute commands or alter trusted results.
6. PostgreSQL/TimescaleDB is the primary acceptance target. Any SQLite fallback must be labeled local demo and must not count as TigerData verification.
7. One backend process and one active run. Horizontal scaling is documented future architecture, requiring a shared bus and separate worker.
8. Existing uncommitted work must be preserved. A alone resolves shared startup, lockfiles, contract updates and final merge conflicts.

## Requirements coverage

| Original sections                                             | Owner                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| 1–3: product, stack, pages/design                             | C; A supplies runtime/API                             |
| 4–6: mission parameters, objectives, deterministic simulation | B; A supplies orchestration                           |
| 7: TigerData, time series, migrations/history                 | A                                                     |
| 8–10: Gemini, Qwen/Vultr, AI orchestration                    | D; A supplies routes/audit storage                    |
| 11–12: REST, WebSockets                                       | A; C consumes                                         |
| 13–15: architecture, env, reliability/security                | A; D owns inference-specific controls                 |
| 16–17: phases/priorities                                      | A coordinates gates; every owner completes its area   |
| 18: Operation Signal Restore                                  | B seed; C UI; A integrated demo; D optional narration |
| 19–20: tests and done criteria                                | Every owner tests its area; A verifies end to end     |

## Integrated acceptance checklist

- [ ] Create/edit a mission; parameters and custom required/optional objectives validate.
- [ ] Save and reload configuration from actual Timescale/PostgreSQL across restart.
- [ ] Launch one server-authoritative simulation; second active launch returns conflict.
- [ ] Time advances once, pauses exactly, resumes, and completes at configured duration.
- [ ] Seeded incidents and accepted commands produce reproducible outcomes.
- [ ] Live map, telemetry, events and objectives update via WebSocket.
- [ ] Trigger, acknowledge and resolve incidents; supported recovery commands change state.
- [ ] Repeated command key returns prior result; changed payload with reused key conflicts.
- [ ] Required objective outcomes determine mission success; optional outcomes are reported separately.
- [ ] Reports, command history and time-series data persist and reload after restart.
- [ ] AI proposals validate and remain editable before explicit save.
- [ ] Inference failure leaves simulation operational; mock/fallback provenance is visible.
- [ ] Docker, env template, README, architecture and demo instructions match tested commands.
- [ ] Tests need no real AI keys/GPU. Live Gemini/Qwen status is reported separately.
