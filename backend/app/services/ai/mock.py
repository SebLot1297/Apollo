"""Explicitly labeled deterministic templates and observations; no inference."""

import json
from uuid import NAMESPACE_URL, uuid5

from .context import METRICS
from .providers import ProviderResult

_METRIC_LABELS = {
    "communication_uptime_percent": ("communication uptime", "%"),
    "equipment_availability_percent": ("equipment availability", "%"),
    "incidents_resolved": ("incidents resolved", ""),
    "supplies_delivered_percent": ("supplies delivered", "%"),
    "systems_restored": ("systems restored", ""),
    "elapsed_time_seconds": ("elapsed time", " s"),
}


def _format_number(value):
    """Render a metric faithfully: whole numbers stay integral, fractions keep full precision."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        if float(value).is_integer():
            return str(int(value))
    except (OverflowError, ValueError):
        return None
    return str(value)


def _metric_sentence(metrics):
    if not isinstance(metrics, dict):
        return None
    parts = []
    for key in sorted(METRICS):
        if key not in metrics:
            continue
        number = _format_number(metrics[key])
        if number is None:
            continue
        label, unit = _METRIC_LABELS.get(key, (key.replace("_", " "), ""))
        parts.append(f"{label} {number}{unit}")
    if not parts:
        return None
    return "Recorded metrics:\n" + "\n".join(f"- {part}" for part in parts)


def _objective_lines(results):
    lines = []
    for result in results[:12] if isinstance(results, list) else []:
        if not isinstance(result, dict):
            continue
        objective = result.get("objective")
        if not isinstance(objective, dict):
            continue
        name = objective.get("name") or "Objective"
        state = result.get("status", "pending")
        achieved = _format_number(result.get("achieved_value"))
        target = _format_number(objective.get("target_value"))
        comparator = objective.get("operator", ">=")
        if achieved is not None and target is not None:
            lines.append(f"- {name}: {state} (observed {achieved}, target {comparator} {target})")
        else:
            lines.append(f"- {name}: {state}")
    return lines


def _recovery_sections(plan):
    """Summarise guidance once per reason instead of repeating every blocked step."""
    sections = []
    if not isinstance(plan, dict):
        return sections
    steps = plan.get("steps")
    steps = steps if isinstance(steps, list) else []
    available, blocked = [], {}
    for step in steps:
        if not isinstance(step, dict):
            continue
        title = step.get("title")
        if not isinstance(title, str) or not title:
            continue
        reason = step.get("blocked_reason")
        if not reason:
            if title not in available:
                available.append(title)
            continue
        blocked.setdefault(str(reason), []).append(title)
    if available:
        sections.append("Suggested next actions: " + ", ".join(available[:6]) + ".")
    for reason, titles in list(blocked.items())[:3]:
        unique = list(dict.fromkeys(titles))
        shown = ", ".join(unique[:4])
        if len(unique) > 4:
            shown += f", and {len(unique) - 4} more"
        sections.append(f"Not available right now: {shown} ({reason}).")
    outlook = plan.get("objective_outlook")
    if isinstance(outlook, dict):
        verdict = "would" if outlook.get("can_finish_successfully") else "would not yet"
        sections.append(f"Finishing the run now {verdict} satisfy every required objective.")
    return sections


class MockAIProvider:
    name = "mock"
    model = "deterministic-demo-v1"
    configured = True

    def generate(self, task: str, prompt: str, context: dict, *, existing_ids=None):
        from app.schemas.mission import MissionConfiguration, MissionObjective

        # Include existing IDs in the seed so repeated additions remain deterministic and distinct.
        seed = prompt + json.dumps(context.get("mission", {}), sort_keys=True)
        existing_ids = set(existing_ids or [])

        def objective(name: str, metric: str, target: float) -> dict:
            salt = 0
            identifier = str(uuid5(NAMESPACE_URL, f"commandgrid:{seed}:{metric}:{salt}"))
            while identifier in existing_ids:
                salt += 1
                identifier = str(uuid5(NAMESPACE_URL, f"commandgrid:{seed}:{metric}:{salt}"))
            existing_ids.add(identifier)
            return MissionObjective(
                id=identifier,
                name=name,
                metric_key=metric,
                operator=">=",
                target_value=target,
                required=True,
                evaluation_mode="final",
                deadline_seconds=None,
                description="Deterministic example; does not interpret the prompt. Review and edit before saving.",
            ).model_dump(mode="json")

        objectives = [
            objective("Communication uptime at mission end", "communication_uptime_percent", 90),
            objective("Restore two infrastructure systems", "systems_restored", 2),
        ]
        if task == "generate_objectives":
            return objectives
        if task == "generate_mission":
            return MissionConfiguration.model_validate(
                {
                    "id": str(uuid5(NAMESPACE_URL, f"commandgrid:mission:{prompt}")),
                    "schema_version": 1,
                    "name": "Signal Restore — demo proposal",
                    "description": "Deterministic mock template for a fictional support facility. "
                    "This template does not interpret the request; edit it before saving.",
                    "category": "communications_recovery",
                    "duration_seconds": 21600,
                    "parameters": {
                        "weather_severity": 70,
                        "environmental_disruption": 40,
                        "team_count": 4,
                        "equipment_reliability": 75,
                        "resource_level": 80,
                        "communication_reliability": 70,
                        "backup_power_enabled": True,
                        "custom_metadata": {},
                    },
                    "objectives": objectives,
                    "created_at": "2026-01-01T00:00:00Z",
                    "updated_at": "2026-01-01T00:00:00Z",
                }
            ).model_dump(mode="json")
        return {"text": self.explain(context)}

    @staticmethod
    def explain(context: dict) -> str:
        """Readable deterministic prose: no inference, no repetition, no float noise."""
        sections = ["Deterministic demo explanation (no live AI model)."]
        status = context.get("status")
        outcome = context.get("success")
        if status is not None:
            if isinstance(outcome, bool):
                verdict = "successful" if outcome else "unsuccessful"
                sections.append(f"The recorded run is {status}, and the evaluator marked it {verdict}.")
            else:
                sections.append(f"The recorded run status is {status}.")
        elif isinstance(outcome, bool):
            sections.append("The evaluator marked the run " + ("successful." if outcome else "unsuccessful."))
        sentence = _metric_sentence(context.get("final_metrics", context.get("metrics", {})))
        if sentence:
            sections.append(sentence)
        lines = _objective_lines(context.get("objective_results", []))
        if lines:
            sections.append("Objective outcomes:\n" + "\n".join(lines))
        sections.extend(_recovery_sections(context.get("recovery_plan")))
        incident = context.get("incident")
        if isinstance(incident, dict):
            kind = incident.get("kind")
            label = kind if isinstance(kind, str) else "record"
            sections.append(f"Selected incident {label}: {incident.get('status', 'unknown')}.")
            hints = {
                "communications_outage": "Review communication health; the backup communications command may help.",
                "power_failure": "Review power availability; the backup power command may help.",
                "equipment_degradation": "Review equipment availability; an equipment diagnostic may help.",
            }
            hint = hints.get(kind) if isinstance(kind, str) else None
            if hint:
                sections.append(hint)
        if len(sections) == 1:
            sections.append("No simulation metrics were supplied. Select a run to explain its recorded conditions.")
        sections.append("No success probability is calculated; commands require an explicit operator action.")
        return "\n\n".join(sections)

    async def generate_structured(self, system: str, prompt: str, schema: dict, max_tokens: int) -> ProviderResult:
        data = json.loads(prompt)
        task = "generate_objectives" if set(schema.get("properties", {})) == {"objectives"} else "generate_mission"
        proposal = self.generate(task, data.get("user_input", ""), data.get("recorded_context", {}))
        if task == "generate_objectives":
            proposal = {"objectives": proposal}
        return ProviderResult(json.dumps(proposal, allow_nan=False))

    async def generate_text(self, system: str, prompt: str, max_tokens: int) -> ProviderResult:
        data = json.loads(prompt)
        return ProviderResult(self.explain(data.get("recorded_context", {})))

    async def health_check(self) -> bool:
        return True

    async def aclose(self) -> None:
        return None
