# CommandGrid demonstration and validation

## Guided Hackathon Recovery Demo

A repeatable 3–5 minute operator-led demo: healthy systems → seeded incidents → guided recovery → successful report. Launch it from the dashboard **Launch guided demo** button (or `POST /api/v1/simulations/demo`). It creates a stopped run from the canonical _Hackathon Recovery Demo_ snapshot at **5×** with seed **13337** and profile `guided_demo`.

The seed places exactly three incidents in the 900 simulated-second window: **communications outage ≈230s**, **equipment degradation ≈488s**, **power failure ≈594s**. On a guided run the runner pauses precisely at each incident boundary so recovery can happen while paused without costing uptime.

Presenter checklist:

1. Dashboard → **Launch guided demo**. Confirm the **Guided demo** badge.
2. **Start simulation**, then set speed with the **1×/5×/10×/30×/60×/120×** presets. Speed is server-confirmed and shown with estimated wall time remaining.
3. At each auto-pause, open the **Recovery plan** panel and click **Execute action** for the recommended steps (backup communications/power, acknowledge, restore/diagnose). Paused recovery consumes resources and improves systems without advancing time.
4. Optionally click **Generate AI strategy** for a Gemini (or labeled deterministic) explanation. It never changes numeric outcomes and is marked outdated after further actions.
5. Finish the full 900-second window; the **Objective outlook** offers **Finish successfully** only when required objectives actually pass.
6. Open the report to show success, final metrics, and evidence. Replay with **Reset to new run** (preserves the canonical mission, seed, and 5× demo speed).

Ignoring recovery produces degraded systems, unresolved incidents, and an unsuccessful report — outcomes always come from real commands, resources, and objective evaluation.

The recovery plan is read-only: generating it previews commands on copied engine snapshots and never writes to the run. Without Gemini configured, guidance and all recovery controls still work; the AI button reports the deterministic fallback.

## Current verified Part A demo

1. Follow README setup. Use TimescaleDB, not the optional SQLite convenience mode, for persistence acceptance.
2. Open http://127.0.0.1:8000/docs.
3. GET /ready: confirm postgresql/timescaledb and extension version.
4. GET /api/v1/missions: inspect Operation Signal Restore.
5. POST /api/v1/missions: create a mission with new mission/objective UUIDs, a required measurable objective and supported parameters. Omit facilities/support_teams to generate defaults.
6. PUT /api/v1/missions/{id}: edit a parameter/name.
7. GET it again, restart backend, GET again: changes persist.
8. Add/edit/remove objectives using objective endpoints. Removing the last required objective returns 422.
9. Change Settings: provider preference, speed and demo mode persist.
10. Observe simulation_engine_ready=true and ai_service_ready=false. Simulations use Part B's real engine; Part D AI actions return explicit 503 errors.

POST copies need new objective IDs because objective UUIDs are globally unique. GET list responses are plain arrays. Mission PUT uses the full mission configuration and matching body/route ID.

## Integrated A/B API demo

Run these steps through /docs or an HTTP client. The frontend remains the foundation preview until Part C connects its screens. POST /simulations accepts mission_id and returns a created run. Command endpoints require a fresh idempotency_key UUID for each new action; reuse that same key when retrying an action.

Operation Signal Restore is seeded with four teams, severe weather, equipment reliability 75%, intermittent communications, backup power and duration 21600 simulated seconds.

Required: final communication uptime >=90%; systems_restored >=2 by 21600 seconds.
Optional: final equipment availability >=75%.

1. Edit one mission parameter and required objective; save.
2. Launch a simulation and start it.
3. Observe actual server telemetry through WebSocket.
4. Trigger a communications_outage and acknowledge it.
5. Activate backup communications or restore supported service.
6. Trigger and recover another supported degraded system.
7. Pause; verify elapsed time stops. Resume.
8. Finish; inspect persisted objective evidence and trusted pass/fail.
9. Run a failure scenario by leaving a required condition unmet.
10. AI narratives await Part D; requests currently return 503 without changing numerical results.
11. Restart backend; inspect the saved mission, report and time-series history.

Use a sufficiently long connected period before finishing to satisfy 90% historical uptime. Immediate recovery/early finish does not guarantee success. Do not rewrite outcomes to make the demonstration pass.

## Integration evidence

- The complete backend suite includes real-engine API/storage tests; enable TEST_DATABASE_URL to run those against PostgreSQL/TimescaleDB.
- TimescaleDB 2.23.1 and both hypertables are queried directly.
- Backend container builds and serves readiness with PostgreSQL.
- Focused failure/cancellation tests use a test-only engine. Numerical and full lifecycle tests use the actual Part B engine.
- Frontend typecheck/build and two foundation browser tests pass.
- Backend and frontend Docker images build successfully.
- Live Gemini/Qwen inference is unverified.
