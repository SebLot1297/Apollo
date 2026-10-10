"""Whitelisted commands and explicit resource/capability rules."""
from uuid import UUID

from app.schemas.simulation import CommandRecord

from .clock import finite_number, timestamp
from .incidents import INCIDENT_DEFINITIONS, add_incident, emit, resolve_incident
from .metrics import KIND_SYSTEM, refresh_systems, spend_resources

COMMAND_PAYLOADS = {
    "start": set(), "pause": set(), "resume": set(), "finish": set(), "terminate": set(),
    "trigger_incident": {"kind"}, "activate_backup_communications": set(),
    "activate_backup_power": set(), "run_equipment_diagnostic": set(),
    "restore_service": {"incident_id"}, "acknowledge_incident": {"incident_id"},
    "set_speed": {"time_multiplier"},
}
COMMAND_STATUSES = {
    "start": {"created"}, "pause": {"running"}, "resume": {"paused"},
    "finish": {"running", "paused"}, "terminate": {"created", "running", "paused"},
    "set_speed": {"created", "running", "paused"},
}


def validate_command(state, command_type, payload):
    if not isinstance(command_type, str) or command_type not in COMMAND_PAYLOADS:
        raise ValueError(f"unsupported command: {command_type}")
    if payload is not None and not isinstance(payload, dict):
        raise ValueError("command payload must be a dictionary")
    payload = {} if payload is None else payload
    extra = set(payload) - COMMAND_PAYLOADS[command_type]
    if extra:
        raise ValueError(f"unexpected payload fields for {command_type}: {extra}")
    allowed = COMMAND_STATUSES.get(command_type, {"running"})
    if state.status not in allowed:
        raise ValueError(f"{command_type} is illegal while run is {state.status}; expected {sorted(allowed)}")
    if command_type == "set_speed":
        speed = finite_number(payload.get("time_multiplier"), "time_multiplier", positive=True)
        if speed > 3600:
            raise ValueError("time_multiplier must be at most 3600")
    if command_type == "trigger_incident":
        kind = payload.get("kind")
        if not isinstance(kind, str) or kind not in INCIDENT_DEFINITIONS:
            raise ValueError("trigger_incident requires a supported payload.kind")
    if command_type == "acknowledge_incident" and "incident_id" not in payload:
        raise ValueError("acknowledge_incident requires payload.incident_id")
    if "incident_id" in payload:
        find_incident(state, payload["incident_id"])
    return payload


def find_incident(state, incident_id):
    try:
        identifier = UUID(str(incident_id))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError("incident_id must be a UUID identifying an existing incident") from error
    for incident in state.incidents:
        if incident.id == identifier:
            return incident
    raise ValueError(f"incident does not exist: {incident_id}")


def _restore(state, incident_id=None, *, equipment_only=False):
    if incident_id is not None:
        incident = find_incident(state, incident_id)
        if incident.status == "resolved":
            return "no-op: incident already resolved"
        selected = [incident]
        systems = {KIND_SYSTEM[incident.kind]}
    else:
        selected = [incident for incident in state.incidents if incident.status != "resolved"
                    and (not equipment_only or incident.kind == "equipment_degradation")]
        systems = {KIND_SYSTEM[incident.kind] for incident in selected}
        systems.update(key for key, system in state.systems.items()
                       if system.baseline_health < 100 and (not equipment_only or key == "equipment"))
    if not systems:
        return "no-op: requested systems are healthy and no unresolved incident exists"
    if not state.support_teams:
        raise ValueError("recovery requires a support team capability")
    cost = (5.0 if equipment_only else 8.0) * len(systems) / len(state.support_teams)
    spend_resources(state, cost)
    for incident in selected:
        resolve_incident(state, incident)
    for key in systems:
        state.systems[key].baseline_health = 100
    refresh_systems(state)
    return f"Repaired {', '.join(sorted(systems))}; resolved {len(selected)} incident(s); spent {cost:g} resources"


def execute(state, command_type, payload):
    """Mutate only the engine's private state copy. Validation precedes execution."""
    if command_type in ("start", "pause", "resume"):
        state.status = {"start": "running", "pause": "paused", "resume": "running"}[command_type]
        effect = f"Run is {state.status} at {state.elapsed_time_seconds:g} simulated seconds"
    elif command_type == "set_speed":
        state.time_multiplier = float(payload["time_multiplier"])
        effect = f"Simulation speed changed to {state.time_multiplier:g}x"
    elif command_type == "finish":
        # The engine finalizes objective evidence before selecting completed/failed.
        effect = "Finished at the actual elapsed time without advancing the clock"
    elif command_type == "terminate":
        state.status = "terminated"
        effect = "Run terminated; it is unsuccessful regardless of objective progress"
    elif command_type == "trigger_incident":
        incident = add_incident(state, payload["kind"], source="command")
        refresh_systems(state)
        effect = f"Triggered {incident.title} ({incident.id})"
    elif command_type == "acknowledge_incident":
        incident = find_incident(state, payload["incident_id"])
        if incident.status != "active":
            effect = f"no-op: incident already {incident.status}"
        else:
            incident.status = "acknowledged"
            effect = f"Acknowledged {incident.title}; service impact remains until recovery"
    elif command_type in ("activate_backup_communications", "activate_backup_power"):
        power = command_type == "activate_backup_power"
        if power and not state.mission.parameters.backup_power_enabled:
            raise ValueError("backup power must be enabled in mission parameters before activation")
        field = "backup_power_active" if power else "backup_communications_active"
        if getattr(state, field):
            effect = "no-op: backup capability already active"
        else:
            cost = 3.0 if power else 2.0
            spend_resources(state, cost)
            setattr(state, field, True)
            refresh_systems(state)
            effect = f"Activated backup {'power' if power else 'communications'}; spent {cost:g} resources"
    elif command_type == "run_equipment_diagnostic":
        effect = _restore(state, equipment_only=True)
    else:  # restore_service, the only remaining whitelisted command
        effect = _restore(state, payload.get("incident_id"))
    state.command_history.append(CommandRecord(command_type=command_type, payload=payload.copy(),
        elapsed_time_seconds=state.elapsed_time_seconds, timestamp=timestamp(state), effect=effect))
    emit(state, "command", f"{command_type}: {effect}", {"command_type": command_type, "payload": payload.copy()})
