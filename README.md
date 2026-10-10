# CommandGrid

Fictional, noncombat infrastructure recovery simulator in the Apollo repository.

## Current milestone

Part A implements backend infrastructure: mission/objective CRUD, validated API requests, SQLAlchemy repositories, Alembic migrations, real TimescaleDB hypertables, persistent settings, atomic command/report storage, an injectable single-process runner, WebSockets, AI route/audit boundaries, startup scripts and Docker configuration.

Part B's deterministic simulation engine is integrated. Simulations, incident commands, telemetry, WebSocket updates, terminal reports and reset use the real engine. Its full numerical snapshot is saved privately to preserve seeded scheduling and objective evidence across restart. Part D's AI service remains pending; AI actions return explicit HTTP 503 responses.

The frontend builds and shows the labeled foundation preview. Part C still needs to connect its screens to the backend. Simulation flows are currently available through the API documentation.

## Local setup (Windows PowerShell)

Requirements: Node/npm, [uv](https://docs.astral.sh/uv/getting-started/installation/), Python 3.12+ (uv can install it), and Docker Desktop for the primary TimescaleDB database.

Run from the actual repository, not its parent folder:

```powershell
cd "C:\Users\vihaa\OneDrive\Documents\ChatGPT\apollo knight hacks\Apollo"
npm ci
npm run setup
Copy-Item .env.example .env
npm run db:up
npm run db:migrate
npm run dev
```

Do not overwrite an existing `.env`; update its settings instead. The env template contains synthetic local DB credentials and blank AI keys.

Frontend: [http://127.0.0.1:5173](http://127.0.0.1:5173).
API documentation: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).
Readiness: [http://127.0.0.1:8000/ready](http://127.0.0.1:8000/ready).

`npm run dev` starts the backend, waits for database readiness, then starts Vite. Occupied ports produce an actionable error. Ctrl+C stops the launcher's service processes. Use `npm run dev:backend` or `npm run dev:frontend` for individual services.

With no `.env` or DATABASE_URL, startup uses persistent SQLite at `backend/data/commandgrid.db`, explicitly identified as `sqlite/local-demo`. This convenience mode is not TigerData acceptance evidence. A configured PostgreSQL failure does not silently switch to SQLite.

The seed mission is inserted on first backend startup without overwriting saved edits.

## Containers

```powershell
docker compose up -d --build db backend
```

The frontend image serves the foundation preview:

```powershell
docker compose up -d --build
```

Container frontend URL: [http://127.0.0.1:4173](http://127.0.0.1:4173).
The nginx configuration proxies REST and WebSockets and provides SPA route fallback.

Do not run a host backend and a container backend against the same database simultaneously. Before using `npm run dev`, stop the container backend with `docker compose stop backend`. Named DB volumes preserve data; no volume deletion is part of normal startup/shutdown.

## Checks

```powershell
npm test
npm run lint:backend
npm run lint
npm run build
npm run test:backend
```

- `npm test` / `npm run test:backend`: all backend tests, including Part B numerical tests and real-engine API/storage integration. PostgreSQL-only checks skip without TEST_DATABASE_URL.
- `npm run build`: frontend typecheck/build.
- `npm run test:e2e`: Playwright starts isolated backend data and both services; stop existing servers on ports 8000/5173 first. Existing foundation tests need review by Part C for the full-stack UI.

To verify PostgreSQL tests, create a dedicated test database once:

```powershell
docker compose exec -T db psql -U commandgrid -d commandgrid -c "CREATE DATABASE commandgrid_test"
$env:TEST_DATABASE_URL = "postgresql+psycopg://commandgrid:commandgrid_local@127.0.0.1:5433/commandgrid_test"
npm test
Remove-Item Env:TEST_DATABASE_URL
```

Only use a disposable database whose name ends in `_test`. Repository/API and real-engine integration tests create and remove their own UUID-named schemas. Focused runner failure/cancellation tests also use a test-only engine; numerical tests and full API lifecycles use the real Part B engine.

## Documentation and agent handoff

- [Part A executable plan](docs/superpowers/plans/2026-10-10-commandgrid-parallel/part-a-backend.md)
- [Parallel implementation plan](docs/superpowers/plans/2026-10-10-commandgrid-parallel.md)
- [Shared API contract](docs/api-contract.md)
- [Architecture](docs/architecture.md)
- [Demo and validation guide](docs/demo.md)
- [Part A handoff and verification](docs/part-a-handoff.md)

## Operational boundaries

One backend worker and one active simulation are supported. A data-directory OS lock plus PostgreSQL advisory lock prevent duplicate processes from advancing the same database. A queue-backed worker and shared message bus are future scaling requirements.

API keys remain backend-only. Requests are bounded, CORS/browser WebSocket origins are restricted, AI calls are rate/concurrency/timeout limited, and generated proposals are schema validated before returning. Numerical reports and narratives are stored separately.

This is a single-user local demo. Authentication, authorization and per-user ownership must be implemented before shared public deployment. Gemini/Qwen live inference and paid GPU provisioning are not verified by this milestone.
