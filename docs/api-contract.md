# CommandGrid implementation contract

This document is the shared implementation boundary for the current full-stack milestone. JSON uses snake_case; IDs are UUID strings; timestamps are ISO 8601 UTC. Preserve the existing visual design. The frontend lives in `frontend/`; root npm scripts launch both services. Backend lives in `backend/app`.

## Mission

`MissionConfiguration`: id, schema_version=1, name, description, category (`communications_recovery` is the only enabled category), duration_seconds (60..86400), parameters, objectives, facilities, support_teams, created_at, updated_at.

Parameters: weather_severity (0..100), environmental_disruption (0..100), team_count (integer 1..10), equipment_reliability (0..100), resource_level (0..100), communication_reliability (0..100), backup_power_enabled (boolean), custom_metadata (string-keyed JSON scalar dictionary, inert).

Objective: id, name, metric_key, operator (`>=`, `<=`, `=`, `>`, `<`), target_value, required, deadline_seconds (nullable), evaluation_mode (`final`, `maintained`, `deadline`, `accumulated`), description. The evaluator supplies status; status is not a writable configuration field. Require at least one required objective. Deadline mode requires a deadline within the mission window.

Metric keys: communication_uptime_percent, equipment_availability_percent, incidents_resolved, supplies_delivered_percent, systems_restored, elapsed_time_seconds. Validate finite values and metric-specific supported modes/units. Percentage bounds 0..100; counts are nonnegative integers. Central metric and parameter registries are returned by GET /api/v1/registry.

Facility: id, name, kind (`relay`, `facility`, `power`), x, y (0..100), status (`operational`, `degraded`, `offline`). SupportTeam: id, name, x, y, status (`available`, `responding`). Mission save can omit facility/team arrays; backend fills fictional defaults matching team_count.

## Simulation state

`MissionState`: run_id, mission_id, mission (snapshot), status (`created`, `running`, `paused`, `completed`, `failed`, `terminated`), elapsed_time_seconds, random_seed, time_multiplier, sequence, metrics (metric-key -> number), systems (communication_health, equipment_availability, power_availability, resource_level; numeric percentages), facilities, support_teams, incidents, events, objective_results, history. Other internal fields may be included by the engine; frontend ignores them.

Incident: id, kind (`communications_outage`, `power_failure`, `equipment_degradation`), title, description, status (`active`, `acknowledged`, `resolved`), started_at_seconds, resolved_at_seconds (nullable).

Event: id, sequence, simulated_time_seconds, event_type, severity (`info`, `warning`, `critical`, `action`), message, payload (dictionary).

ObjectiveResult: objective (configuration snapshot), achieved_value, passed (bool), status (`pending`, `passed`, `failed`, `expired`), first_achieved_at_seconds (nullable), reason.

History sample: simulated_time_seconds, metrics, systems. Wall-clock timestamps are added by persistence, not used by numerical rules.

Engine interface in app/simulation/engine.py: `create_state(mission, random_seed=42, run_id=None, time_multiplier=30) -> MissionState`; `apply_command(state, command_type, payload=None) -> MissionState`; `tick(state, seconds) -> MissionState`; `build_report(state) -> dict`. Inputs remain unmodified. Commands reject illegal transitions with ValueError. Only `communications_recovery` supported. Seeded event generation, immutable configuration snapshots, exact time-weighted uptime, historical objective modes; no LLM involvement.

The native Part B state in app.schemas.simulation differs from the public JSON above. app.services.missions.engine_adapter maps native system objects, events and history to this contract. The complete native snapshot is saved in the run/command JSON but excluded from HTTP/WebSocket serialization. Public state/event sequences include runner recovery/reset events; native engine sequences are retained independently. Native history includes system percentages captured at each sampling boundary. GET /registry adapts Part B's registry lists to keyed dictionaries and category available flags. Numerical connectivity follows Part B's registry: effective communications and power health must both be >=50.

Commands: start, pause, resume, set_speed (payload.time_multiplier: finite number greater than 0 and at most 3600; created/running/paused only), trigger_incident (payload.kind), activate_backup_communications, activate_backup_power, run_equipment_diagnostic, restore_service (payload.incident_id optional), acknowledge_incident (payload.incident_id), finish, terminate. Reset API creates a NEW run from the same snapshot and seed using the current saved default speed; never erases prior results.

Report: run_id, mission, success, status, elapsed_time_seconds, final_metrics, objective_results, events, command_history, telemetry (history samples), summary, ai_analysis (nullable full AI envelope; narrative is in data.text), created_at. All required objectives must pass for success; terminated/failed runs are unsuccessful. AI cannot alter numeric results.

## HTTP API

Base /api/v1. Errors use {detail: string} or FastAPI validation detail array. Plain arrays for list endpoints.

- GET /missions -> MissionConfiguration[]; POST /missions (mission) -> mission, 201; GET/PUT/DELETE /missions/{id}; DELETE -> 204. Server owns updated_at.
- GET/POST /missions/{id}/objectives; PUT/DELETE /objectives/{id}. Mission validation applies after edits.
- POST /simulations {mission_id, random_seed:42, time_multiplier?:number} -> MissionState created. GET /simulations -> summaries/full state[]. GET /simulations/{run_id} -> state. Omitting time_multiplier uses the current persisted simulation_speed under the controller lock; an explicit value overrides only this run. Guided demo launches also use the shared default. One active created/running/paused run per process; conflicts ->409.
- POST /simulations/{run_id}/commands {command_type, idempotency_key:UUID, payload:{}} -> MissionState. Reusing the same key/payload returns prior result; conflicting payload ->409. /start, /pause, /resume, /finish accept {idempotency_key}. /reset -> new state.
- GET /simulations/{run_id}/events -> Event[]. GET /simulations/{run_id}/telemetry?from_seconds=&to_seconds= -> history sample[].
- GET /reports -> Report[]; GET /reports/{run_id} -> Report.
- WS /simulations/{run_id}/stream -> {type:'snapshot'|'update'|'completion', sequence, state:MissionState}. Connect/reconnect always gets current snapshot; client ignores duplicate/older sequence values and reconnects with bounded exponential backoff.
- GET /registry -> {metrics:dict, parameters:dict, categories:[{key,label,available}]}.
- GET /settings -> {ai_provider:'auto'|'gemini'|'qwen'|'mock', demo_mode:bool, simulation_speed:number, database:{engine,status}, ai_status:ProviderStatus[]}. PUT /settings updates only ai_provider,demo_mode,simulation_speed. Saving simulation_speed atomically updates the shared default and the active created/running/paused run, after settling elapsed running time at the old speed. Paused runs remain paused. Future launches and resets across all missions use this default unless explicitly overridden; terminal runs/reports retain their evidence. Invalid speed payloads return 422; illegal command transitions return 409.
- /health -> {status:'ok'}; /ready checks DB and identifies backend; no credentials returned.

## AI boundary

All AI calls explicit user requests. `AIService.execute(task, prompt, context={}, provider=None, demo_mode=False) -> dict` where task is generate_mission/generate_objectives/explain_incident/chat/generate_report. Returns {provider,model,mock,fallback_reason,data,usage,latency_ms}. `data` is a schema-valid mission, objective list, or {text:string}. `AIService.status() -> ProviderStatus[]` with provider/model/configured/available/detail, never credentials. AI agent owns services/ai and provider tests; main API records audit rows from envelopes.

POST /ai/generate-mission {prompt,provider?}; /ai/generate-objectives {prompt,mission_id?,provider?}; /ai/explain-incident {run_id,incident_id,provider?}; /ai/chat {run_id,message,provider?}; /ai/generate-report {run_id,provider?}. The response uses the envelope above. Generated configurations are proposals only; user must review and save explicitly. Mock fallback is labeled and deterministic, never represented as a live model response.

## Storage & operation

SQLAlchemy repositories; primary configured PostgreSQL/TimescaleDB. Compose provides local TimescaleDB. Explicit SQLite local demo fallback allowed for startup without Docker, identified in /ready and Settings. PostgreSQL/Timescale migrations and integration checks must be reported honestly. One asyncio runner; no multi-worker uvicorn. Persist commands, state, telemetry, events and reports transactionally before broadcasting. On process restart persisted running runs become paused; created runs stay created and require start, while paused runs require explicit resume. Take an OS process lock to prevent duplicate workers on one local data directory.
