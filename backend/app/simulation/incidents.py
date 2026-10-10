"""Independent hash-based risk streams, with serialized event-time cursors."""
import hashlib
import math
from uuid import uuid5

from app.schemas.simulation import Event, Incident
from .clock import timestamp

INCIDENT_DEFINITIONS = {
    "communications_outage": ("Communication outage", "Synthetic relay service interruption; communication health reduced by 65.", 65),
    "power_failure": ("Power failure", "Synthetic power interruption; power health reduced by 70.", 70),
    "equipment_degradation": ("Equipment degradation", "Four synthetic equipment units become unavailable.", 4),
}


def rates(parameters):
    w = parameters.weather_severity / 100
    d = parameters.environmental_disruption / 100
    return {
        "communications_outage": 0.2 + 0.8 * w + 1.5 * (1 - parameters.communication_reliability / 100),
        "power_failure": 0.1 + 0.8 * w + 0.8 * d,
        "equipment_degradation": 0.1 + 1.6 * (1 - parameters.equipment_reliability / 100) + 0.4 * d,
    }


def schedule_next(state, kind, previous_time):
    index = state.rng_counters.get(kind, 0)
    material = f"commandgrid-v1:{state.random_seed}:{kind}:{index}".encode()
    bits = int.from_bytes(hashlib.sha256(material).digest()[:8], "big") >> 11
    # The maximum midpoint can round to 1.0 in binary64. Keep log1p's
    # argument strictly inside its domain even for that rare hash draw.
    uniform = min((bits + 0.5) / (2 ** 53), math.nextafter(1.0, 0.0))
    delay = max(60.0, -math.log1p(-uniform) * 3600 / rates(state.mission.parameters)[kind])
    state.rng_counters[kind] = index + 1
    state.next_incident_at[kind] = previous_time + delay


def emit(state, event_type, message, details=None):
    state.event_counter += 1
    event_id = uuid5(state.mission_id, f"event:{state.random_seed}:{state.event_counter}")
    state.events.append(Event(id=event_id, type=event_type, message=message,
                              timestamp=timestamp(state), elapsed_time_seconds=state.elapsed_time_seconds,
                              details=details or {}))


def add_incident(state, kind, *, source):
    if kind not in INCIDENT_DEFINITIONS:
        raise ValueError(f"unsupported incident kind: {kind}")
    state.incident_counter += 1
    title, description, impact = INCIDENT_DEFINITIONS[kind]
    incident = Incident(id=uuid5(state.mission_id, f"incident:{state.random_seed}:{state.incident_counter}"),
                        kind=kind, title=title, description=description,
                        started_at_seconds=state.elapsed_time_seconds, impact=impact, source=source)
    state.incidents.append(incident)
    emit(state, "incident_started", f"{title}: {description}",
         {"incident_id": str(incident.id), "kind": kind, "source": source})
    return incident


def resolve_incident(state, incident):
    if incident.status == "resolved":
        return
    incident.status = "resolved"
    incident.resolved_at_seconds = state.elapsed_time_seconds
    emit(state, "incident_resolved", f"Resolved {incident.title}.", {"incident_id": str(incident.id)})
