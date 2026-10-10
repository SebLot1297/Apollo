"""Actionable recovery guidance derived from authoritative state.

Every candidate command is previewed on a deep copy through the same engine that
advances the run, so predicted effects and resource costs match real outcomes.
Generating a plan never persists, broadcasts or otherwise mutates the run.
"""
from app.schemas.recovery import (
    ObjectiveOutlook,
    ObjectiveOutlookItem,
    RecoveryPlan,
    RecoveryStep,
)

# Order for targeted restoration when resources are constrained.
_RESTORE_ORDER = ("power_failure", "communications_outage", "equipment_degradation")
_SYSTEM_KEYS = ("communication_health", "power_availability", "equipment_availability")
_IMPAIRMENT_EPSILON = 1e-6


class _Step:
    __slots__ = ("command_type", "payload", "title", "explanation")

    def __init__(self, command_type, payload, title, explanation):
        self.command_type, self.payload, self.title, self.explanation = (
            command_type,
            payload,
            title,
            explanation,
        )


def _impaired(state, kind, system_key):
    active = any(
        incident.kind == kind and incident.status != "resolved" for incident in state.incidents
    )
    return active or state.systems[system_key] < 100 - _IMPAIRMENT_EPSILON


def _candidates(state):
    steps = []
    unresolved = [incident for incident in state.incidents if incident.status != "resolved"]
    unresolved_kinds = {incident.kind for incident in unresolved}

    communications = _impaired(state, "communications_outage", "communication_health")
    power = _impaired(state, "power_failure", "power_availability")

    if communications and not state.backup_communications_active:
        steps.append(
            _Step(
                "activate_backup_communications",
                {},
                "Activate backup communications",
                "Raises effective communications health so service stays connected during the outage.",
            )
        )
    if (
        power
        and not state.backup_power_active
        and state.mission.parameters.backup_power_enabled
    ):
        steps.append(
            _Step(
                "activate_backup_power",
                {},
                "Activate backup power",
                "Raises effective power health so the facility stays connected during the power failure.",
            )
        )
    for incident in state.incidents:
        if incident.status == "active":
            steps.append(
                _Step(
                    "acknowledge_incident",
                    {"incident_id": str(incident.id)},
                    f"Acknowledge {incident.title}",
                    "Records operator awareness; service impact remains until the system is repaired.",
                )
            )
    for kind in _RESTORE_ORDER:
        for incident in unresolved:
            if incident.kind != kind:
                continue
            if kind == "equipment_degradation":
                steps.append(
                    _Step(
                        "run_equipment_diagnostic",
                        {},
                        "Diagnose and repair equipment",
                        "Restores degraded equipment units and resolves the equipment incident at the lower diagnostic cost.",
                    )
                )
            else:
                steps.append(
                    _Step(
                        "restore_service",
                        {"incident_id": str(incident.id)},
                        f"Restore {incident.title}",
                        "Repairs the affected system and resolves the underlying incident.",
                    )
                )
    # Residual baseline damage with no active incident (for example an impaired
    # system that started below full health).
    if any(_impaired(state, k, s) for k, s in (
        ("communications_outage", "communication_health"),
        ("power_failure", "power_availability"),
        ("equipment_degradation", "equipment_availability"),
    )) and not unresolved_kinds:
        steps.append(
            _Step(
                "restore_service",
                {},
                "Repair residual system damage",
                "Restores systems that are impaired without an active incident.",
            )
        )
    return steps


def _preview(working, engine, command_type, payload):
    """Preview on a copy of ``working``; return (effects, cost, error)."""
    trial = working.model_copy(deep=True)
    try:
        result = engine.apply_command(trial, command_type, payload)
    except ValueError as exc:
        return {}, None, str(exc)
    effects = {}
    for key in _SYSTEM_KEYS:
        delta = round(result.systems[key] - working.systems[key], 4)
        if abs(delta) > _IMPAIRMENT_EPSILON:
            effects[key] = delta
    cost = round(working.systems["resource_level"] - result.systems["resource_level"], 4)
    return effects, max(0.0, cost), None


def _objective_outlook(state, engine):
    if state.status not in ("running", "paused"):
        return ObjectiveOutlook(
            can_finish_successfully=False,
            note="Finish evaluation requires a running or paused run.",
        )
    trial = state.model_copy(deep=True)
    try:
        finished = engine.apply_command(trial, "finish", {})
    except ValueError as exc:
        return ObjectiveOutlook(can_finish_successfully=False, note=str(exc))
    required = [
        ObjectiveOutlookItem(
            name=result.objective.name,
            metric_key=result.objective.metric_key,
            operator=result.objective.operator,
            target_value=result.objective.target_value,
            achieved_value=result.achieved_value,
            passed=result.passed,
            status=result.status,
            reason=result.reason,
        )
        for result in finished.objective_results
        if result.objective.required
    ]
    return ObjectiveOutlook(
        can_finish_successfully=finished.status == "completed",
        note=(
            "All required objectives pass at this simulated time."
            if finished.status == "completed"
            else "At least one required objective is still unmet at this simulated time."
        ),
        required_objectives=required,
    )


def build_recovery_plan(state, engine) -> RecoveryPlan:
    steps = []
    working = state.model_copy(deep=True)
    # Read-only previews show the same real recovery costs in either mode.
    # Execution stays blocked in automatic mode at the API/engine boundary.
    working.recovery_mode = "manual"
    if working.engine_snapshot:
        working.engine_snapshot["recovery_mode"] = "manual"
    for index, step in enumerate(_candidates(state), start=1):
        effects, cost, error = _preview(working, engine, step.command_type, step.payload)
        if error is None:
            working = engine.apply_command(working, step.command_type, step.payload)
        steps.append(
            RecoveryStep(
                id=f"step-{index}",
                title=step.title,
                explanation=step.explanation,
                command_type=step.command_type,
                payload=step.payload,
                cost=cost,
                effects=effects,
                blocked_reason=error,
            )
        )
    return RecoveryPlan(
        run_id=str(state.run_id),
        based_on_sequence=state.sequence,
        profile=state.run_profile,
        steps=steps,
        objective_outlook=_objective_outlook(state, engine),
    )
