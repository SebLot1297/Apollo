"""Select bounded, non-secret context. Text inside context remains untrusted data."""

import json
import math
from typing import Any
from uuid import UUID

from pydantic import BaseModel

METRICS = {
    "communication_uptime_percent",
    "equipment_availability_percent",
    "incidents_resolved",
    "supplies_delivered_percent",
    "systems_restored",
    "elapsed_time_seconds",
}
FIELDS = METRICS | {
    "mission",
    "run_id",
    "mission_id",
    "name",
    "description",
    "category",
    "duration_seconds",
    "parameters",
    "weather_severity",
    "environmental_disruption",
    "team_count",
    "equipment_reliability",
    "resource_level",
    "communication_reliability",
    "backup_power_enabled",
    "objectives",
    "objective",
    "id",
    "metric_key",
    "operator",
    "target_value",
    "required",
    "deadline_seconds",
    "evaluation_mode",
    "objective_results",
    "achieved_value",
    "passed",
    "status",
    "first_achieved_at_seconds",
    "reason",
    "metrics",
    "final_metrics",
    "systems",
    "communication_health",
    "equipment_availability",
    "power_availability",
    "incident",
    "incidents",
    "kind",
    "title",
    "started_at_seconds",
    "resolved_at_seconds",
    "events",
    "simulated_time_seconds",
    "event_type",
    "severity",
    "message",
    "command_history",
    "command_type",
    "success",
    "summary",
    "history",
    "telemetry",
}


def _project(value: Any, *, depth: int = 0, budget: list[int] | None = None) -> Any:
    budget = budget if budget is not None else [1500]
    budget[0] -= 1
    if depth > 7 or budget[0] < 0:
        return None
    if isinstance(value, BaseModel):
        value = {key: getattr(value, key) for key in type(value).model_fields if key in FIELDS}
    if isinstance(value, dict):
        # Lookup known fields directly, so arbitrary keys cannot inflate traversal work.
        return {
            key: _project(value[key], depth=depth + 1, budget=budget)
            for key in sorted(FIELDS)
            if key in value and budget[0] > 0
        }
    if isinstance(value, (list, tuple)):
        return [_project(item, depth=depth + 1, budget=budget) for item in value[:24] if budget[0] > 0]
    if isinstance(value, str):
        return value[:400]
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        try:
            return value if math.isfinite(value) and (not isinstance(value, int) or value.bit_length() <= 256) else None
        except OverflowError:
            return None
    if isinstance(value, UUID):
        return str(value)
    # Enums, timestamps, and UUIDs are data only; arbitrary objects are excluded.
    if hasattr(value, "value") and isinstance(value.value, str):
        return value.value
    return None


def build_context(context: Any, max_chars: int = 12000) -> dict:
    if type(max_chars) is not int or max_chars < 2:
        raise ValueError("Context budget must fit a JSON object")
    if context is None:
        return {}
    if isinstance(context, dict):
        # API callers may pass a state/report object or its top-level fields.
        nested = context.get("report", context.get("state"))
        if nested is not None:
            if isinstance(nested, BaseModel):
                nested = {key: getattr(nested, key) for key in type(nested).model_fields if key in FIELDS}
            if isinstance(nested, dict):
                context = {
                    key: context[key] if key in context else nested[key]
                    for key in FIELDS
                    if key in context or key in nested
                }
    selected = _project(context)
    if not isinstance(selected, dict):
        return {}
    for key in ("events", "command_history", "incidents"):
        original = context.get(key) if isinstance(context, dict) else getattr(context, key, None)
        if isinstance(original, (list, tuple)):
            selected[key] = _project(original[-8:])
    for key in ("history", "telemetry"):
        original = context.get(key) if isinstance(context, dict) else getattr(context, key, None)
        if isinstance(original, (list, tuple)):
            selected[key] = _project(original[-3:])
    # Keep facts, trim ancillary prose/events first. Never truncate serialized JSON.
    for key in ("history", "telemetry", "events", "command_history", "summary", "incidents", "mission"):
        if len(json.dumps(selected, ensure_ascii=True)) <= max_chars:
            return selected
        selected.pop(key, None)
    if len(json.dumps(selected, ensure_ascii=True)) > max_chars:
        selected = {
            key: selected[key]
            for key in ("status", "success", "elapsed_time_seconds", "metrics", "final_metrics", "systems")
            if key in selected
        }
    # With a smaller budget, omit whole fields rather than corrupting JSON or rounding facts.
    for key in ("systems", "metrics", "final_metrics", "status", "success", "elapsed_time_seconds"):
        if len(json.dumps(selected, ensure_ascii=True)) <= max_chars:
            break
        selected.pop(key, None)
    return selected
