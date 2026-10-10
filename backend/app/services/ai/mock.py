"""Explicitly labeled deterministic templates and observations; no inference."""

import json
from uuid import NAMESPACE_URL, uuid5

from .context import METRICS
from .providers import ProviderResult


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
        pieces = ["Deterministic demo explanation (no live AI model)."]
        if "status" in context:
            pieces.append(f"Recorded simulation status: {context['status']}.")
        if isinstance(context.get("success"), bool):
            pieces.append("Evaluator result: " + ("successful." if context["success"] else "unsuccessful."))
        metrics = context.get("final_metrics", context.get("metrics", {}))
        if isinstance(metrics, dict):
            values = [
                f"{key}: {metrics[key]}"
                for key in sorted(METRICS & metrics.keys())
                if isinstance(metrics[key], (int, float)) and not isinstance(metrics[key], bool)
            ]
            if values:
                pieces.append("Recorded metrics: " + "; ".join(values) + ".")
        results = context.get("objective_results", [])
        for result in results[:12] if isinstance(results, list) else []:
            if not isinstance(result, dict):
                continue
            objective = result.get("objective")
            if not isinstance(objective, dict):
                continue
            name = objective.get("name", "Objective")
            state = result.get("status", "pending")
            achieved = result.get("achieved_value")
            target = objective.get("target_value")
            comparator = objective.get("operator", ">=")
            pieces.append(f"{name}: {state}; observed {achieved}, target {comparator} {target}.")
        incident = context.get("incident")
        if isinstance(incident, dict):
            pieces.append(f"Incident {incident.get('kind', 'record')}: {incident.get('status', 'unknown')}.")
            hints = {
                "communications_outage": "Review communication health and consider the backup communications command.",
                "power_failure": "Review power availability and consider the backup power command.",
                "equipment_degradation": "Review equipment availability and consider an equipment diagnostic.",
            }
            kind = incident.get("kind")
            if isinstance(kind, str) and kind in hints:
                pieces.append(hints[kind])
        strategy = context.get("recovery_plan")
        if isinstance(strategy, dict):
            steps = strategy.get("steps", [])
            if isinstance(steps, list):
                available = [
                    step.get("title")
                    for step in steps
                    if isinstance(step, dict) and step.get("blocked_reason") is None and step.get("title")
                ]
                if available:
                    pieces.append("Deterministic strategy: prioritise " + "; ".join(available[:6]) + ".")
                for step in steps[:6]:
                    if isinstance(step, dict) and step.get("blocked_reason"):
                        pieces.append(
                            f"Blocked: {step.get('title', 'step')} — {step['blocked_reason']}."
                        )
            outlook = strategy.get("objective_outlook")
            if isinstance(outlook, dict):
                verdict = "would" if outlook.get("can_finish_successfully") else "would not yet"
                pieces.append(f"Finishing now {verdict} satisfy all required objectives.")
        if len(pieces) == 1:
            pieces.append("No simulation metrics were supplied. Select a run to explain recorded conditions.")
        pieces.append("No success probability is calculated. Commands require an explicit operator action.")
        return " ".join(pieces)

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
