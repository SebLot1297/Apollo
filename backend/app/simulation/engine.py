"""Public, immutable engine boundary. No I/O or wall-clock scheduling."""
from copy import deepcopy
from uuid import UUID, uuid4

from app.schemas.mission import MissionConfiguration
from app.schemas.simulation import MissionState, SystemState
from .clock import TERMINAL_STATUSES, end_time, finite_number, timestamp
from .commands import execute, validate_command
from .incidents import INCIDENT_DEFINITIONS, add_incident, emit, schedule_next
from .metrics import health_status, refresh_metrics, refresh_systems, sample
from .objectives import evaluate, required_pass


def create_state(
    mission: MissionConfiguration,
    random_seed: int = 42,
    run_id=None,
    time_multiplier: float = 30,
) -> MissionState:
    multiplier = finite_number(time_multiplier, "time_multiplier", positive=True)
    if type(random_seed) is not int:
        raise ValueError("random_seed must be an integer")
    try:
        identifier = uuid4() if run_id is None else UUID(str(run_id))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError("run_id must be a UUID") from error
    # Revalidate snapshots: model_copy(update=...) deliberately bypasses Pydantic
    # validation, and consumers may otherwise pass an invalid configuration.
    snapshot = MissionConfiguration.model_validate(mission.model_dump())
    parameters = snapshot.parameters
    healths = {"communications": parameters.communication_reliability,
               "power": 100.0 - parameters.environmental_disruption / 2,
               "equipment": 5.0 * int(20 * parameters.equipment_reliability / 100)}
    systems = {key: SystemState(health=value, baseline_health=value, status=health_status(value),
                              operational_units=int(value / 5) if key == "equipment" else None,
                              total_units=20 if key == "equipment" else None)
               for key, value in healths.items()}
    state = MissionState(run_id=identifier, mission_id=snapshot.id, mission=snapshot,
        random_seed=random_seed, time_multiplier=multiplier, systems=systems,
        facilities=deepcopy(snapshot.facilities), support_teams=deepcopy(snapshot.support_teams),
        resource_remaining=parameters.resource_level, resource_anchor=parameters.resource_level)
    for kind in INCIDENT_DEFINITIONS:
        schedule_next(state, kind, 0)
    refresh_systems(state, track_recovery=False)
    evaluate(state)
    emit(state, "state_created", "Created fictional Communications Recovery run; clock is stopped.")
    sample(state)
    return state


def _complete(state):
    evaluate(state, finalize=True)
    state.status = "completed" if required_pass(state) else "failed"
    emit(state, "run_completed", f"Run {state.status} at {state.elapsed_time_seconds:g}s; "
         "success requires every required objective to pass.")


def apply_command(
    state: MissionState,
    command_type: str,
    payload: dict | None = None,
) -> MissionState:
    validated = validate_command(state, command_type, payload)
    result = state.model_copy(deep=True)
    result.sequence += 1
    execute(result, command_type, deepcopy(validated))
    refresh_metrics(result)
    evaluate(result)
    if command_type == "finish":
        _complete(result)
    elif command_type == "terminate":
        evaluate(result, finalize=True)
    sample(result)
    return result


def _advance(state, endpoint):
    start = state.elapsed_time_seconds
    state.elapsed_time_seconds = endpoint
    refresh_metrics(state)
    evaluate(state, interval_start=start)


def tick(
    state: MissionState,
    seconds: float,
) -> MissionState:
    endpoint = end_time(state, seconds)  # Validate even if the clock is stopped.
    result = state.model_copy(deep=True)
    if state.status != "running" or endpoint == state.elapsed_time_seconds:
        return result
    result.sequence += 1
    while True:
        # Kind is a stable tie-breaker if two scheduled incidents coincide.
        kind, boundary = min(result.next_incident_at.items(), key=lambda item: (item[1], item[0]))
        if boundary > endpoint:
            break
        _advance(result, boundary)
        add_incident(result, kind, source="scheduled")
        refresh_systems(result)
        evaluate(result)
        sample(result)
        schedule_next(result, kind, boundary)
    _advance(result, endpoint)
    if endpoint == result.mission.duration_seconds:
        _complete(result)
    sample(result)
    return result


def build_report(
    state: MissionState,
) -> dict:
    """JSON-ready evidence snapshot; reporting never alters the original run."""
    snapshot = state.model_copy(deep=True)
    refresh_metrics(snapshot)
    evaluate(snapshot)
    success = snapshot.status == "completed" and required_pass(snapshot)
    passed = sum(result.passed for result in snapshot.objective_results)
    return {
        "run_id": str(snapshot.run_id),
        "mission": snapshot.mission.model_dump(mode="json"),
        "success": success,
        "status": snapshot.status,
        "elapsed_time_seconds": snapshot.elapsed_time_seconds,
        "final_metrics": dict(snapshot.metrics),
        "objective_results": [result.model_dump(mode="json") for result in snapshot.objective_results],
        "events": [event.model_dump(mode="json") for event in snapshot.events],
        "command_history": [command.model_dump(mode="json") for command in snapshot.command_history],
        "telemetry": [entry.model_dump(mode="json") for entry in snapshot.history],
        "summary": (f"{snapshot.mission.name}: {snapshot.status} after {snapshot.elapsed_time_seconds:g} simulated seconds. "
                    f"{passed}/{len(snapshot.objective_results)} objectives passed; "
                    f"communication uptime {snapshot.metrics['communication_uptime_percent']:.2f}%; "
                    f"{snapshot.metrics['incidents_resolved']} incidents resolved, "
                    f"{snapshot.metrics['systems_restored']} systems restored; "
                    f"remaining resources {snapshot.resource_remaining:.2f}."),
        "ai_analysis": None,
        "created_at": timestamp(snapshot).isoformat().replace("+00:00", "Z"),
    }
