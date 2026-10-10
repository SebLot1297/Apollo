# CommandGrid Part B: domain and simulation semantics

This is a pure Python, fictional Communications Recovery simulator. Public entry
points are `create_state`, `apply_command`, `tick`, and `build_report` in
`app.simulation.engine`. They return independent copies and perform no I/O, API,
database, real-time scheduling, or AI calls. Only the parameters enumerated below
affect numerical state. Custom metadata is never interpreted.

## Integration baseline and dependencies

The checked-out Apollo foundation did **not** include `docs/api-contract.md`,
`docs/superpowers/plans/2026-10-10-commandgrid-parallel.md`, any backend draft,
backend virtual environment, or the executing-plans skill. This implementation
uses the assignment's explicit fields and function signatures. It does not change
the existing frontend's camelCase preview types. Before API/frontend integration,
the coordinator must reconcile these new domain schemas with the missing shared
contract. No existing backend interface was renamed.

Python 3.10+ and Pydantic **2** are required; pytest is needed for the requested
pytest command. Dependency installation/manifests remain Agent A's responsibility.
The tests also run with Python's built-in unittest runner. `backend/app` is a
Python namespace package; put `backend` on the integration process's module path.
Both test files set their own import path, so root-level test commands work.

The configuration snapshot in `MissionState` is named `mission`. Each
`ObjectiveResult` contains its configuration snapshot as `objective`.
`HistorySample` contains `elapsed_time_seconds`, `timestamp`, `sequence`, and
`metrics`. `Event` contains `id`, `type`, `message`, `timestamp`,
`elapsed_time_seconds`, and `details`. Command records contain `command_type`,
`payload`, `elapsed_time_seconds`, `timestamp`, and an explanatory `effect`.
These field choices require contract review when the shared documents are supplied.

`get_registry()` returns fresh JSON-serializable `metrics`, `parameters`, and
`categories` lists. Entries expose `key`, `name`, `label`, `unit`, bounds, and
either `value_type`/`supported_modes`/`operators`/`calculation`, or
`type`/`default`/`description`/`validation`/`effects`. The underlying definitions
are read-only. Four unfinished mission categories are explicitly disabled in the
registry and rejected by configuration validation. `mission_duration` describes
top-level `duration_seconds`; it is not a second parameter.

## Configuration

`schema_version` is integer 1. UUIDs serialize as strings. Configuration dates
must be timezone-aware and normalize to UTC. Duration is an integer in
60–86400 seconds; team count is an integer in 1–10. Percentages/coordinates are
finite numbers in 0–100. Booleans and numeric strings are rejected as numerical
inputs. Names of missions/objectives must contain non-whitespace characters.
Unexpected fields are rejected, including objective evaluation status.

Objectives require a registered metric/operator/mode, a nonnegative finite
threshold within the metric's bounds, integral count thresholds, distinct IDs,
and at least one required objective. Only `deadline` accepts a deadline; it is
required for that mode and must be within the mission window. Deadline zero is
valid. Facilities and teams have distinct IDs within each collection. Missing
or empty facility/team collections generate deterministic fictional defaults via
UUID5 using the mission ID. Supplied team count must equal `team_count`; an empty
collection regenerates teams after a parameter edit.

Metadata accepts only string keys with string, boolean, finite numeric, or null
values. Lists and nested objects are rejected. There is no expression interpreter,
SQL execution, or dynamic parameter rule evaluator.

## Systems and metric formulas

There are aggregate communications, power, and equipment systems. System health
is bounded to 0–100: `operational` is health >= 75; `degraded` is 25 <= health < 75;
`offline` is health < 25. These display/recovery thresholds differ from the
connected-service threshold specified below. Facilities mirror the corresponding
aggregate system (`relay` = communications, `power` = power, `facility` =
equipment); they do not independently execute operations. Teams display
`responding` while assigned to unresolved incident indicators and otherwise
`available`. Those display assignments do not remove teams from the aggregate
recovery/delivery capability.

| Metric | Calculation | Range/unit | Supported modes |
| --- | --- | --- | --- |
| `communication_uptime_percent` | `100 * connected_time_seconds / elapsed_time_seconds` | 0–100 % | final, maintained, deadline |
| `equipment_availability_percent` | `100 * operational_units / 20` | 0–100 %, in 5-point increments | final, maintained, deadline |
| `incidents_resolved` | Number of distinct resolved incident IDs | Nonnegative integer count | final, maintained, deadline, accumulated |
| `supplies_delivered_percent` | Actual cumulative deliveries, capped at 100 | 0–100 % | final, maintained, deadline, accumulated |
| `systems_restored` | Closed legitimate recovery episodes | Nonnegative integer count | final, maintained, deadline, accumulated |
| `elapsed_time_seconds` | Actual elapsed simulation time | 0–86400 seconds, further bounded by mission duration | final, maintained, deadline, accumulated |

**Connected service** requires effective communication health >= 50 **and**
effective power health >= 50. At zero elapsed time uptime is 100 if this predicate
is true, otherwise 0. At positive time it is strictly the interval integral.
An outage at t=20 in a tick ending at t=100 yields 20 connected seconds and 20%
uptime. Recovery at a command boundary begins counting from that time. Pauses add
neither connected seconds nor elapsed seconds. Backups affect the same predicate
as all other system changes.

Equipment availability counts operational units; it is not an average sampled
health gauge. There are 20 synthetic units. Initially
`floor(20 * equipment_reliability / 100)` are operational. Each unresolved
equipment degradation removes four units, bounded at zero. Equipment health is
five times its operational-unit count.

Delivery is a supporting mechanic in Communications Recovery, not an implemented
logistics mission. Let N be team count, R be remaining resources, and D be
delivered percentage points. While D < 100:

```text
k = N / 60000
dD/dt = k * R
dR/dt = -0.1 * k * R
D(t) = D_anchor + R_anchor * (1 - exp(-0.1 * k * delta)) / 0.1
R(t) = R_anchor - 0.1 * (D(t) - D_anchor)
```

Delivery stops at 100%; resources stop draining for deliveries at that cap.
With zero resources there are no deliveries. Closed-form integration uses
`expm1` for small intervals and anchors that move only on resource-spending
commands. Sampling or splitting ticks does not change integration.

## Parameter effects and incident scheduling

W = weather_severity / 100; E = environmental_disruption / 100;
C = communication_reliability / 100; Q = equipment_reliability / 100.

| Parameter | Explicit effect |
| --- | --- |
| Weather | Increases communication and power incident rates by `0.8 * W` per hour. |
| Environmental disruption | Initial power health `100 - environmental_disruption / 2`; adds `0.8 * E` power and `0.4 * E` equipment incidents/hour. |
| Equipment reliability | Sets initial operational unit count; adds `1.6 * (1-Q)` equipment incidents/hour. |
| Communication reliability | Sets initial communication health; adds `1.5 * (1-C)` communication incidents/hour. |
| Team count | Multiplies delivery rate and divides repair costs. |
| Resource level | Initial resource budget; constrains backups, restoration, diagnostics, and deliveries. |
| Backup power enabled | Makes the backup power command available; does not activate it automatically. |
| Mission duration | Defines the clipping/completion endpoint. |
| Custom metadata | No effect. |

Per-kind rates in incidents/hour are:

```text
communications_outage: 0.2 + 0.8*W + 1.5*(1-C)
power_failure:         0.1 + 0.8*W + 0.8*E
equipment_degradation: 0.1 + 1.6*(1-Q) + 0.4*E
```

Each kind has an independent deterministic risk stream. For draw index i, hash
`commandgrid-v1:{seed}:{kind}:{i}` with SHA-256, take the high 53 bits of the first
64 bits, and map them to an interior uniform number U. The next delay is
`max(60, -log(1-U) * 3600 / rate)`. This is a simplified exponential scheduling
rule with a 60-second minimum interval per kind. Cursors and next event times
are stored in state. Simultaneous incidents use kind-name order as a tie-breaker.
Manual incidents do not consume or reschedule the random streams.
The uniform mapping is `(bits + 0.5) / 2**53`, capped at the largest representable
float below 1 to avoid a rare rounding-induced logarithm domain error.

| Kind | Unresolved impact | Recovery |
| --- | --- | --- |
| communications_outage | Subtracts 65 from communication baseline health | Restore service, or mitigate with backup communications |
| power_failure | Subtracts 70 from power baseline health | Restore service, or mitigate with enabled backup power |
| equipment_degradation | Removes 4 operational equipment units | Restore service or equipment diagnostic |

Unresolved impacts stack and are bounded at zero. Acknowledged incidents retain
their effects. Incidents remain unresolved until a recovery command resolves
them; there is no hidden wall-clock timer or automatic repair. Every incident
has a deterministic UUID, explanatory event, and actual simulated onset/resolution
time. Baseline health, effective health, remaining resources, and recovery flags
are serialized, so a resumed run follows the same future rules.

## Commands, resources, and recovery episodes

All accepted commands append a command record and command event, including
documented no-ops. They refresh metrics and historical objective evidence.
Unsupported names/payload fields, unavailable capabilities, insufficient
resources, missing incidents, and illegal transitions raise useful `ValueError`s.
Rejected commands leave input state intact.

| Command | Payload/effect |
| --- | --- |
| start | created -> running; no clock advance |
| pause | running -> paused |
| resume | paused -> running |
| trigger_incident | Required `kind`; one supported synthetic incident |
| activate_backup_communications | Costs 2 resource units; effective communication health floor 85 |
| activate_backup_power | Requires backup_power_enabled; costs 3 resources; effective power health floor 90 |
| run_equipment_diagnostic | Repairs equipment baseline to 20 operational units and resolves all equipment incidents; costs `5 / N` resources when needed |
| restore_service | Optional `incident_id`; resolves that incident and repairs its system baseline, or all unresolved incidents/impaired baselines when omitted; costs `8 * distinct repaired systems / N` resources |
| acknowledge_incident | Required `incident_id`; active -> acknowledged, without restoring service |
| finish | Ends running or paused run at the actual current time |
| terminate | Ends created, running, or paused run unsuccessfully |

Activating an already active backup, acknowledging an acknowledged/resolved
incident, restoring an already resolved incident, or requesting repair of healthy
systems is an explicit no-op with no resource charge or counter increase. An
operational baseline below 100 may be improved by a repair, but that alone cannot
increment the recovery counter.

A recovery episode opens when a system's effective health is below 75, including
initial impairments. It closes once when effective health reaches at least 75.
Only closure increments `systems_restored`; backups can legitimately close an
episode. Resolving a mitigated incident does not create a second restoration.
Later new damage below 75 opens a new episode. `system_restored` events explain
each closure. `incidents_resolved` counts unique resolved IDs separately: backup
activation mitigates service impacts but does not resolve incidents.

Diagnostics and service restoration are instantaneous simulated decisions whose
resource cost models recovery effectiveness; no travel-time model is implied.

## Run state and clock rules

```text
created --start--> running --pause--> paused --resume--> running
running/paused --finish--> completed (required objectives pass) or failed
running --duration endpoint--> completed (required objectives pass) or failed
created/running/paused --terminate--> terminated
```

Operational commands are legal only while running. Terminal states reject all
commands. `finish` is illegal before start. There is no reset command; create a
new run with a new ID and retain the previous state outside this engine.

`tick` receives **simulated seconds**. The external runner applies
`time_multiplier` once; the engine stores it but does not multiply tick deltas.
Negative/nonfinite/nonnumeric/boolean deltas are rejected even for stopped runs.
Zero deltas and ticks on created, paused, or terminal runs return independent,
unchanged copies. Advancement is clipped to mission duration. Decimal addition
of caller-supplied deltas prevents common fractional-clock drift. Events and
samples use monotonically nondecreasing simulated timestamps; multiple events
at a single command boundary may share a time.

The engine visits every incident boundary inside each tick. It integrates the
preceding interval, records its objective evidence, changes system health,
records the discrete transition, then continues. No physical rule depends on
sequence or telemetry packaging. Sequence increments per accepted command and
per advancing tick. History contains actual initial, command, incident, and tick
endpoint samples, so a different tick packaging can produce additional samples.

## Objective modes, operators, and historical evidence

`>=`, `<=`, `=`, `>`, and `<` are all supported. With absolute tolerance
epsilon = **1e-9 in the metric's units**:

```text
a >= b : a >= b - epsilon
a <= b : a <= b + epsilon
a =  b : abs(a - b) <= epsilon
a >  b : a > b + epsilon
a <  b : a < b - epsilon
```

This avoids floating-point artifacts such as `0.1 + 0.2` differing from `0.3`.
Strict inequalities exclude the equality tolerance band. Integer counters are
compared with integral thresholds, so ordinary integer comparisons are unchanged.

* **final:** Pending until a terminal endpoint; compare the actual metric there.
  Early satisfaction does not guarantee a final pass.
* **maintained:** Observe the whole simulated history, including initial t=0,
  all commands, incidents, and every continuous interval. Remember the first
  breach forever. A later recovery cannot erase it. With no breach, the result
  remains pending until the endpoint and then passes.
* **deadline:** Record the first simulated satisfaction time. Pass iff that time
  is **<= deadline_seconds**, with an inclusive boundary and no additional time
  tolerance. The first time persists if a metric later declines. If the deadline
  passes without timely achievement, status is expired; an achievement afterward
  is recorded but cannot turn the result into a pass. Exactly at the boundary,
  an unmet condition remains pending so a command at that same time may achieve it.
* **accumulated:** Compare a genuine cumulative counter/value once; do not sum
  telemetry samples. Only cumulative supplies, incident count, restoration count,
  and elapsed time support this mode. Result progress can be passed before the
  endpoint; nonmonotone conditions such as `count <= target` may later fail.

Within each interval all registered metrics are constant or monotone. The engine
finds condition entry and first breach by evaluating the analytic metric and
searching its value boundary to floating-point precision. Equality achievement
inside an interval is detected even if both telemetry endpoints fail equality.
For a strict continuous inequality the stored first time is the first
representable simulated time found beyond its tolerance boundary. Deadline
evidence is independent of sampling frequency. Discrete count changes are
observed at their exact incident/command time.

Each result contains an independent `objective` snapshot, current/final
`achieved_value`, `passed`, `status`, `first_achieved_at_seconds`, and an evidence
`reason`. A passed deadline's current achieved value may decline; its reason and
first time explain why it remains passed. Maintained reasons identify the
historical breach. Internal `objective_evidence` survives JSON serialization.

At a natural endpoint or early finish, all required objectives must pass for
`completed`; otherwise the run is `failed`. Optional failures do not prevent
completion. Finish evaluates current values/history **without** advancing time
or pretending to have reached a future deadline. An unmet future-deadline
objective fails on early finish because the run has ended. Termination evaluates
available evidence at its actual endpoint but the report is always unsuccessful.
Reports of created/running/paused/failed runs are also unsuccessful. AI cannot
alter trusted results.

## Reports, timestamps, and replay

`build_report` returns exactly `run_id`, `mission`, `success`, `status`,
`elapsed_time_seconds`, `final_metrics`, `objective_results`, `events`,
`command_history`, `telemetry`, `summary`, `ai_analysis`, and `created_at`.
The summary is computed from numerical state; `ai_analysis` is null. Events
preserve incident onset/resolution and command/recovery explanations. Telemetry
is the actual history, not a fabricated resampling. Reports are defensive copies.

Configuration creation defaults may use UTC wall time; the deterministic demo has
a fixed creation timestamp. **Once a snapshot exists**, the engine never reads
wall time. Event/command/sample/report timestamps are the mission snapshot's
`created_at + elapsed_time_seconds`, normalized to UTC. A report's created_at
therefore represents its simulated endpoint. Agent A can separately persist an
actual UTC record-creation timestamp without changing numerical outcomes.

By default only `run_id` is a fresh random UUID. Agent A should supply a new UUID
for each new persisted run/reset; pass a fixed ID when exact whole-payload replay
is desired. Incident/event identities are UUID5 from mission ID, seed, and
dedicated counters, so they do not depend on API sequence or call count.

The same snapshot, seed, and command schedule produce the same numerical state,
incident schedule, and event timeline after saving/reloading JSON. Split ticks
preserve those values; sequence and number of telemetry samples may differ.
Retain **all** serialized internal fields when persisting MissionState. Removing
RNG cursors, resource anchors, connected-time anchors, or objective evidence
invalidates the replay guarantee. IEEE floating-point representation is the
numerical precision; this is not an arbitrary-precision physical model.

## Demonstration and serialized examples

`app.data.seed.demo_mission()` produces Operation Signal Restore with fixed
mission/objective/facility/team identities and UTC dates, a 21600-second window,
four teams, severe weather 85, environmental disruption 70, equipment reliability
75, communication reliability 45, resources 70, and backup power enabled.
Required objectives are final uptime >= 90% and two restorations by t=21600;
optional equipment availability is >= 75% at completion.

Untreated baseline communications are disconnected and power is degraded.
Immediate backup communications and backup power close two real initial recovery
episodes and protect connectivity; leaving the mission unattended fails. The
tests exercise both six-hour outcomes under the actual same evaluation rules.

Full, JSON-serializable integration examples are included at:

* `backend/app/data/examples/mission.json`: complete demonstration configuration.
* `backend/app/data/examples/state.json`: complete started state after backups;
  includes every replay field and is suitable for `MissionState.model_validate_json`.
* `backend/app/data/examples/report.json`: an actual early-finish report at 120s,
  generated from that example state via tick and finish. This early example is
  distinct from the tests of full six-hour outcomes.

Regenerate them from the root with the project virtual environment once available:

```powershell
$env:PYTHONPATH = Join-Path (Get-Location) 'backend'
backend/.venv/Scripts/python.exe -m app.data.examples
```

## Validation commands and handoff

The requested command, once Agent A provides Pydantic 2 and pytest in the project
environment, is:

```powershell
backend/.venv/Scripts/python.exe -m pytest backend/tests/test_schemas.py backend/tests/test_engine.py -q
```

In this checkout that executable does not exist and the bundled runtime lacks
pytest. No dependency was installed into a global environment. The actual
verification command used with the existing Pydantic 2.13.5 / Python 3.12.14
bundled runtime is:

```powershell
$env:PYTHONDONTWRITEBYTECODE = '1'
& 'C:\Users\loter\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover -s backend/tests -p 'test_*.py' -v
```

The assigned files comprise configuration/state schemas, immutable registries,
clock/integration rules, incident scheduling, commands, historical objectives,
public engine/report functions, seed/example data, and the two focused test
suites. No frontend/API/database/runner/AI files, root manifests, lockfiles, or
startup scripts are modified. No commit or push is performed.

Changed-file inventory (20 new files):

| Directory | Files |
| --- | --- |
| `backend/app/schemas/` | `__init__.py`, `mission.py`, `simulation.py` |
| `backend/app/simulation/` | `__init__.py`, `registry.py`, `clock.py`, `metrics.py`, `incidents.py`, `objectives.py`, `commands.py`, `engine.py` |
| `backend/app/data/` | `__init__.py`, `seed.py`, `examples.py` |
| `backend/app/data/examples/` | `mission.json`, `state.json`, `report.json` |
| `backend/tests/` | `test_schemas.py`, `test_engine.py` |
| `docs/` | `objective-semantics.md` |

Verification result: **35 test methods passed**, including parameterized subtests
for all operators/modes, schema boundaries, command errors, replay/chunking,
historical objectives, and full example payload validation. The requested pytest
command remains unavailable because its project environment has not been provided.

## Known simplifications and remaining integration work

* Facilities/coordinates and support operations are fictional; there is no real
  targeting, operational dispatch, real weather, route finding, or weapon control.
* Aggregate health and 20 equipment units are a small explanatory model, not
  engineering reliability predictions. Damage stacks; recoveries are immediate
  and cost resources. Backups persist for the run and have no modeled fuel timer.
* Support delivery runs concurrently with recovery; displayed team assignments
  are indicators rather than a scheduling model. Metadata has no numerical effects.
* The engine does not provide API transport, persistence, WebSockets, HTTP
  idempotency keys, real-time scaling, or AI narratives. Those remain other agents'
  work. Accepted semantic no-ops are still recorded here.
* Dependency provisioning and the exact pytest invocation await Agent A. Shared
  contract compatibility awaits the missing API contract/parallel plan and
  coordinator review. No coordinator or Agent A chat was identified in this session.
