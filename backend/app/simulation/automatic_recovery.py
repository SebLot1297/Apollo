"""Deterministic recovery policy; deadlines use simulated seconds, never wall time."""
from .incidents import emit

RECOVERY_DELAY_SECONDS = 10.0


def schedule_recovery(state):
    if state.recovery_mode != "automatic":
        state.next_recovery_at_seconds = None
        return
    damaged = any(system.baseline_health < 100 for system in state.systems.values())
    unresolved = any(incident.status != "resolved" for incident in state.incidents)
    if not damaged and not unresolved:
        state.next_recovery_at_seconds = None
    elif state.next_recovery_at_seconds is None:
        state.next_recovery_at_seconds = state.elapsed_time_seconds + RECOVERY_DELAY_SECONDS


def recover(state, apply):
    """Apply real, resource-checked commands. A blocked attempt never forces success.

    Prefer targeted power/communications repairs, then equipment diagnostics and
    residual baseline repair. If targeted repair is unaffordable, try an eligible
    backup. Blocked work retries on the next incident or deliberate mode change,
    rather than repeatedly logging the same failure on every runner tick.
    """
    def attempt(working, command, payload=None):
        try:
            return apply(working, command, payload or {}, source="automatic"), True
        except ValueError as error:
            emit(working, "automatic_recovery_blocked", f"Automatic recovery blocked: {error}",
                 {"command_type": command, "payload": payload or {}, "source": "automatic"})
            return working, False

    def acknowledge(working, incident):
        if incident.status == "active":
            working, _ = attempt(working, "acknowledge_incident", {"incident_id": str(incident.id)})
        return working

    for kind, backup in (("power_failure", "activate_backup_power"),
                         ("communications_outage", "activate_backup_communications")):
        for incident in [i for i in state.incidents if i.kind == kind and i.status != "resolved"]:
            state = acknowledge(state, incident)
            state, repaired = attempt(state, "restore_service", {"incident_id": str(incident.id)})
            eligible = kind != "power_failure" or state.mission.parameters.backup_power_enabled
            active = state.backup_power_active if kind == "power_failure" else state.backup_communications_active
            if not repaired and eligible and not active:
                state, _ = attempt(state, backup)

    equipment = [i for i in state.incidents if i.kind == "equipment_degradation" and i.status != "resolved"]
    for incident in equipment:
        state = acknowledge(state, incident)
    if equipment or state.systems["equipment"].baseline_health < 100:
        state, _ = attempt(state, "run_equipment_diagnostic")
    # Do not repeat failed incident repairs through an untargeted command.
    if not any(i.status != "resolved" for i in state.incidents) and any(
        system.baseline_health < 100 for key, system in state.systems.items() if key != "equipment"
    ):
        state, _ = attempt(state, "restore_service")
    state.next_recovery_at_seconds = None
    return state
