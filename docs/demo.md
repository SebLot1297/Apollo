# CommandGrid demonstration and validation

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
