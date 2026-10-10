# Part B — Deterministic Simulation and Objective Evaluation Implementation Plan

> **For agentic workers:** Use the executing-plans skill to work through the checkboxes. This assignment is one workstream in the CommandGrid parallel plan. Request coordinator review when changing a shared interface.

**Goal:** Implement trustworthy seeded state transitions, objective outcomes and numerical reports.

**Architecture:** Pure engine functions consume validated mission snapshots and return new states. FastAPI, persistence, wall-clock scheduling and LLM calls are outside this module; Agent A supplies those.

**Tech Stack:** Python 3.12+, Pydantic, pytest.

## Assignment context

Repository: `C:/Users/vihaa/OneDrive/Documents/ChatGPT/apollo knight hacks/Apollo`.

Read `docs/api-contract.md`, the master plan `docs/superpowers/plans/2026-10-10-commandgrid-parallel.md`, and existing files in your ownership area before editing. Existing code is draft; passing checks, rather than file presence, determine completion. Preserve useful implementation and the established dark operations UI.

This is a fictional, noncombat infrastructure/disaster-support simulator. Only Communications Recovery is enabled initially. Other categories must be visibly unavailable. No real operational locations, targeting, weapon control, or arbitrary executable parameter rules.

In a shared checkout, edit only your assigned files. Do not stage other agents' work, reset files, change branches, or commit/push without coordinator instruction. In separate checkouts, use a dedicated `codex/` branch and commit only your assigned files; the coordinator merges. Root dependency installation and lockfiles belong to Agent A. Send required dependencies to A. Never use paid cloud resources without a separate explicit instruction.

Return: changed files; implemented behavior; exact commands and results; unresolved failures; interface changes; external integrations tested live versus mocked. Do not claim completion from mocks or source inspection alone.

## File ownership

Own `backend/app/schemas/mission.py`, `simulation.py`, package initializers; `backend/app/simulation/**`; `backend/app/data/seed.py`; `backend/tests/test_engine.py`, `test_schemas.py`; `docs/objective-semantics.md`.

Keep schema fields/export names compatible with `docs/api-contract.md`. Existing engine-test drafts may reference missing implementation; complete them rather than assuming they pass.

## Task B1 — Schemas, registry and demonstration seed

- [ ] Export MissionConfiguration, MissionObjective, MissionParameters, Facility, SupportTeam, MissionState, Incident, Event, ObjectiveResult and HistorySample.
- [ ] Validate UUIDs, UTC timestamps, version 1, finite numeric values, percentages 0–100, integer counts, team_count 1–10 and duration 60–86400 seconds.
- [ ] Reject empty/all-optional objectives, duplicate IDs, invalid modes/metrics/operators and deadlines outside mission duration. Evaluation status is output only.
- [ ] Publish metric registry with name, unit, minimum, maximum, value_type, supported_modes and calculation semantics. Publish parameter defaults, bounds, validation and explicit effects.
- [ ] Fill fictional facilities/teams when omitted; regenerate teams from an empty list after team_count changes. Custom metadata accepts scalar data and remains inert.
- [ ] Seed six-hour Operation Signal Restore: four teams, severe weather, 75% equipment, intermittent comms, enabled backup power, required 90% uptime and two systems restored by deadline; optional final equipment >=75%.

## Task B2 — Engine and clock-independent transitions

Implement these exact interfaces in `backend/app/simulation/engine.py`:

```python
def create_state(mission, random_seed=42, run_id=None, time_multiplier=30): ...
def apply_command(state, command_type, payload=None): ...
def tick(state, seconds): ...
def build_report(state): ...
```

Bodies must be real implementation; the signatures define the boundary.

- [ ] Write failing state-transition tests, then implement created/running/paused/completed/failed/terminated transitions. Invalid commands raise ValueError and leave input unchanged.
- [ ] Make ticks independent of real clock: positive simulated delta, duration clipping, no movement when paused/terminal, monotonic timestamps and sequence.
- [ ] Preserve RNG progression in serializable state; same mission/seed/command schedule produces equivalent events/metrics after save/reload.
- [ ] Apply explicit weather/disruption/reliability/resource/team/backup rules. Parameter changes demonstrably affect outcomes.
- [ ] Generate communications_outage, power_failure and equipment_degradation deterministically. Document incident scheduling and recovery effects.
- [ ] Implement start/pause/resume, trigger incident, backup comms/power, diagnostic, restore service, acknowledge incident, finish and terminate. Record every accepted command and explanatory event.
- [ ] Make repeated incident acknowledgment/resolution safe; do not increment counters twice. Enforce backup power capability.
- [ ] Store samples and event histories needed for objective evidence and reports. Avoid tick-partition-dependent numerical results.

## Task B3 — Metrics and historical objective evaluation

- [ ] Define what counts as connected service; integrate connected simulated seconds exactly over each interval. Uptime = connected time / elapsed time, with documented zero-duration behavior.
- [ ] Implement equipment availability, incidents_resolved, supplies_delivered_percent, systems_restored and elapsed_time_seconds according to registry. Unsupported scenario capabilities must be honestly described.
- [ ] Implement >=, <=, =, > and < with documented numeric comparison semantics.
- [ ] Final: compare endpoint value at completion. Maintained: remember any violating interval/state. Deadline: record first qualifying time and require it within deadline. Accumulated: compare actual cumulative counter.
- [ ] Evaluate objectives after relevant transitions, not only terminal tick. Track achieved value, status, first achievement and reason; distinguish pending, expired, failed and passed.
- [ ] Require every required objective to pass. Optional failures never fail the mission. Terminated/failed runs never become successful.
- [ ] Build deterministic report values, incident timeline, command history, telemetry and summary; ai_analysis is separate and initially null.

## Task B4 — Meaningful verification

Tests must prove:

- [ ] Operators at equality and immediately above/below thresholds; rejection of NaN/infinity, fractional count targets and unsupported modes.
- [ ] Deadline success at boundary and failure just afterward; first achievement retained after later metric decline.
- [ ] Maintained failure retained after recovery; final objectives correctly use endpoint value.
- [ ] Exact uptime for known connected/disconnected intervals; pause does not inflate uptime or elapsed time.
- [ ] Optional failure with all required passed succeeds; required failure cannot be overridden.
- [ ] Seed replay across serialization and tick chunking yields same numerical/event results.
- [ ] Recovery counters increment only on legitimate restoration; resources/capabilities constrain commands.
- [ ] Duration clipping, command rejection, immutable inputs and completion report correctness.

Run:

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_schemas.py backend/tests/test_engine.py -q
```

Expected: all tests pass without API, DB, AI keys or GPU. If missing dependencies, ask A to install them in the project venv.

## Hand off

Notify A/C/D as soon as schemas and registry import. Deliver passing engine tests, documented objective semantics and exact sample state/report payloads. Do not implement persistence or runner scheduling.
