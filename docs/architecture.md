# CommandGrid architecture

## Boundaries

React frontend → REST/WebSocket API → Controller + Store → PostgreSQL/TimescaleDB.
The Controller calls Part B pure engine functions. AIGateway calls Part D AIService only on explicit requests. AI output never determines metrics, transitions or pass/fail.

Frontend lives in frontend/. Root npm workspaces target that directory. Backend is an editable Python package installed in backend/.venv using a committed uv lockfile.

## Modules

- app/core: env settings, fixed public errors, bounded request-body middleware, safe structured logs.
- app/models/storage.py: relational and time-series ORM definitions.
- app/db/database.py: sessions, migrations, readiness, PostgreSQL worker ownership.
- app/repositories/store.py: mission/objective data, normalized telemetry/events, atomic command/state/report writes, persistent preferences and AI audits.
- app/services/missions/controller.py: one serialized command/tick controller; real-time monotonic scheduling.
- app/services/missions/engine_adapter.py: translates Part B's native snapshots to the public contract, retaining the complete native state privately in storage.
- app/services/missions/state.py: API/storage state, independently sequenced public events and normalized history samples.
- app/websocket/hub.py: in-process fan-out with bounded queues of complete state updates.
- app/services/reports/ai_gateway.py: bounded context, provider envelope validation, expensive-request limits, audit persistence and narrative storage.
- app/api: validated REST requests and WebSocket routes.
- app/main.py: lifespan, OS lock, dependency loading, seed, recovery and error handlers.
- app/schemas, app/simulation, app/data: Part B ownership.
- app/services/ai: Part D ownership.

Part B supplies the numerical engine. The adapter translates native events/history and system health; API registry entries are keyed dictionaries with category availability flags. Engine scheduling cursors and objective evidence are stored as a private engine_snapshot, excluded from REST/WebSocket responses. Runner recovery events remain in public history after subsequent engine ticks. Native history samples capture system health and resources at each sampling boundary. Part D's absent service is explicitly unavailable.

## Database

Migration 0001 contains a frozen initial schema snapshot. Subsequent schema changes require new Alembic revisions.

Tables: missions, mission_objectives, simulation_runs, simulation_commands, mission_reports, ai_requests, application_settings, telemetry_samples, mission_events.

Configurations and state use JSONB on PostgreSQL. Deleting a mission preserves run snapshots and reports; deletion is refused while its run is active.

Timescale hypertables: telemetry_samples and mission_events. Time-inclusive primary keys satisfy partition uniqueness. Both wall time and simulated time are retained; run/time and run/simulated-time indexes support history queries. Metrics and systems are normalized as metrics.KEY and systems.KEY, grouped back into contract samples on read.

The tested image is timescale/timescaledb:2.23.1-pg17; the running extension reports 2.23.1. Hypertables use the compatible create_hypertable API. Sources: [Timescale hypertable reference](https://github.com/timescale/Tiger-Data-Docs/blob/main/src/content/docs/reference/timescaledb/hypertables/create_hypertable.mdx).

SQLite is an explicit local convenience mode with ordinary time-series tables. A failed configured PostgreSQL connection never silently becomes SQLite.

## Atomicity and ordering

Accepted command handling holds an asyncio controller lock:

1. Load persisted state and prior idempotency record.
2. Return the stored result for the same key/body, or conflict for changed content.
3. Settle real elapsed time and apply the engine command.
4. Persist state, appended telemetry/events, accepted command result and any terminal report in one transaction.
5. Broadcast only after commit.

A nullable unique active_slot allows one created/running/paused run; terminal runs clear the slot. Commands also have a unique run/idempotency key constraint.

Reset is a single transaction creating a new run, recording reset on the old run and preserving previous reports. Retrying the reset key resolves to the same created run.

## Runner and recovery

One asyncio task advances the active running mission at the configured real tick frequency. A monotonic clock supplies delta × time_multiplier. Pause/finish commands settle time under the same lock, avoiding double advancement. Explicit test/manual advance accepts simulated seconds without another multiplier.

Running persisted states become paused on backend startup/shutdown with a system event. Created states remain created and require start. Downtime is not simulated automatically. Resume resets the real-time anchor.

An OS lock prevents duplicate workers in a data directory. PostgreSQL advisory ownership additionally prevents separate data directories/processes from running the same database.

## WebSockets

Failed tick persistence suspends advancement and retries persisting a paused state; it never publishes uncommitted telemetry. Cancellation waits for threaded transactions to finish before releasing the controller lock, then publishes committed transitions even if the HTTP caller disconnected.

Connection/subscription and initial snapshot share the controller lock, preventing a missed transition between the two. Each envelope includes type, sequence and full state. Slow clients use bounded queues; newer complete state includes history, so obsolete updates can be discarded without losing recorded events. Sends have a timeout and disconnect cleanup.

Allowed browser origins are checked for both HTTP CORS and WebSocket connections. Nonbrowser clients without an Origin header can connect to the local demo.

## AI boundary

AIGateway accepts only known tasks, verifies referenced objects, bounds context to recent data, limits expensive requests, uses timeout/concurrency controls and records success/failure audit rows. Outputs are revalidated against domain schemas or text schema. Proposals do not save themselves.

After-action AI analysis is stored as its provenance envelope in ai_analysis; success/final_metrics/objective_results stay unchanged. Unknown billing estimates stay null. Audit usage accepts only recognized nonnegative token counts. Provider errors are fixed public messages rather than raw responses.

## Deployment and remaining work

Compose provides DB/backend containers and a prepared frontend nginx image. Backend runs as a nonroot user with one uvicorn worker. Ports bind to loopback.

Part B is integrated. Part C must complete UI/browser integration; Part D must supply AIService and optional secured inference files. Public authentication/authorization, distributed workers, shared bus and data retention policies are outside this local milestone.
