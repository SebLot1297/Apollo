"""Bounded physical state and analytic interval integration."""
import math

from .clock import timestamp
from .incidents import emit
from app.schemas.simulation import HistorySample

KIND_SYSTEM = {"communications_outage": "communications", "power_failure": "power",
               "equipment_degradation": "equipment"}


def health_status(health):
    return "operational" if health >= 75 else "degraded" if health >= 25 else "offline"


def resource_and_delivery_at(state, seconds):
    """Closed-form delivery ODE anchored only at resource-changing commands."""
    delta = max(0.0, seconds - state.resource_anchor_time)
    coefficient = state.mission.parameters.team_count / 60000
    delivered = state.resource_anchor * (-math.expm1(-0.1 * coefficient * delta)) / 0.1
    delivered = min(delivered, 100 - state.supplies_anchor)
    remaining = max(0.0, state.resource_anchor - 0.1 * delivered)
    return remaining, min(100.0, state.supplies_anchor + delivered)


def metric_values_at(state, seconds):
    connected = state.connected_accumulated_seconds
    if state.connected:
        connected += seconds - state.connected_interval_start
    uptime = 100.0 * connected / seconds if seconds > 0 else (100.0 if state.connected else 0.0)
    _, supplies = resource_and_delivery_at(state, seconds)
    return {
        "communication_uptime_percent": min(100.0, max(0.0, uptime)),
        "equipment_availability_percent": 100.0 * state.systems["equipment"].operational_units / 20,
        "incidents_resolved": sum(incident.status == "resolved" for incident in state.incidents),
        "supplies_delivered_percent": supplies,
        "systems_restored": state.systems_restored_count,
        "elapsed_time_seconds": seconds,
    }


def refresh_metrics(state):
    state.resource_remaining, state.supplies_delivered_percent = resource_and_delivery_at(
        state, state.elapsed_time_seconds)
    state.connected_time_seconds = state.connected_accumulated_seconds + (
        state.elapsed_time_seconds - state.connected_interval_start if state.connected else 0)
    state.metrics = metric_values_at(state, state.elapsed_time_seconds)


def refresh_systems(state, *, track_recovery=True):
    """Recompute effective availability; an open recovery episode closes exactly once."""
    for key, system in state.systems.items():
        previous_health = system.health
        damage = sum(incident.impact for incident in state.incidents
                     if incident.status != "resolved" and KIND_SYSTEM[incident.kind] == key)
        if key == "equipment":
            units = max(0, int(system.baseline_health / 5) - int(damage))
            system.operational_units = units
            health = 5.0 * units
        else:
            health = max(0.0, system.baseline_health - damage)
            if key == "communications" and state.backup_communications_active:
                health = max(85.0, health)
            if key == "power" and state.backup_power_active:
                health = max(90.0, health)
        system.health = min(100.0, health)
        system.status = health_status(health)
        if health < 75:
            state.recovery_open[key] = True
        elif state.recovery_open.get(key, False):
            if track_recovery:
                state.systems_restored_count += 1
                emit(state, "system_restored", f"{key} recovered from {previous_health:g} to {health:g} health; "
                     "closed one legitimate recovery episode.",
                     {"system": key, "systems_restored": state.systems_restored_count})
            state.recovery_open[key] = False
        else:
            state.recovery_open[key] = False
    connected = state.systems["communications"].health >= 50 and state.systems["power"].health >= 50
    if connected != state.connected:
        if state.connected:
            state.connected_accumulated_seconds += state.elapsed_time_seconds - state.connected_interval_start
        state.connected_interval_start = state.elapsed_time_seconds
        state.connected = connected
    for facility in state.facilities:
        system_key = {"relay": "communications", "power": "power", "facility": "equipment"}[facility.kind]
        facility.status = state.systems[system_key].status
    active = sum(incident.status != "resolved" for incident in state.incidents)
    for index, team in enumerate(state.support_teams):
        team.status = "responding" if index < active else "available"
    refresh_metrics(state)


def spend_resources(state, amount):
    refresh_metrics(state)
    if state.resource_remaining < amount:
        raise ValueError(f"insufficient resources: need {amount:g}, available {state.resource_remaining:g}")
    state.resource_anchor = max(0.0, state.resource_remaining - amount)
    state.resource_anchor_time = state.elapsed_time_seconds
    state.supplies_anchor = state.supplies_delivered_percent
    refresh_metrics(state)


def sample(state):
    state.history.append(HistorySample(elapsed_time_seconds=state.elapsed_time_seconds,
                                      timestamp=timestamp(state), sequence=state.sequence,
                                      metrics=dict(state.metrics), systems={
                                          "communication_health": state.systems["communications"].health,
                                          "equipment_availability": state.systems["equipment"].health,
                                          "power_availability": state.systems["power"].health,
                                          "resource_level": state.resource_remaining,
                                      }))
