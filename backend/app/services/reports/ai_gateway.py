import asyncio
from collections import deque
from time import monotonic
from typing import Literal

from app.core.errors import MissingError, UnavailableError
from app.schemas.mission import MissionConfiguration, MissionObjective
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    provider: Literal["gemini", "qwen", "mock"]
    model: str = Field(min_length=1, max_length=160)
    mock: StrictBool
    fallback_reason: str | None = Field(default=None, max_length=2000)
    data: dict | list
    usage: dict = Field(default_factory=dict)
    latency_ms: float = Field(ge=0)


class TextData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=64000)


class AIGateway:
    def __init__(self, store, settings, service=None):
        self.store, self.config, self.service = store, settings, service
        self.recent = deque()
        self.lock = asyncio.Lock()
        self.semaphore = asyncio.Semaphore(settings.ai_max_concurrency)

    async def status(self):
        if self.service:
            try:
                return await asyncio.wait_for(self.service.status(), timeout=self.config.ai_timeout_seconds)
            except Exception:
                pass
        return [
            {
                "provider": name,
                "model": model,
                "configured": configured,
                "available": False,
                "detail": "Part D AI service is not ready; inference availability is unverified",
            }
            for name, model, configured in [
                ("gemini", self.config.gemini_model, bool(self.config.gemini_api_key)),
                ("qwen", self.config.qwen_model, self.config.enable_qwen and bool(self.config.qwen_api_key)),
                ("mock", "deterministic-mock", False),
            ]
        ]

    async def execute(self, task, body, preferences):
        if task not in {"generate_mission", "generate_objectives", "explain_incident", "chat", "generate_report"}:
            raise HTTPException(404, "AI task not found")
        async with self.lock:
            current = monotonic()
            while self.recent and current - self.recent[0] >= 60:
                self.recent.popleft()
            if len(self.recent) >= self.config.ai_requests_per_minute:
                raise HTTPException(429, "AI request rate limit reached", headers={"Retry-After": "60"})
            self.recent.append(current)
        prompt, context = await self._context(task, body)
        started = monotonic()
        provider = body.provider or preferences["ai_provider"]
        try:
            if not self.config.enable_ai:
                raise UnavailableError("AI is disabled")
            if self.service is None:
                raise UnavailableError("Part D AI service is not installed yet")
            async with self.semaphore:
                result = await asyncio.wait_for(
                    self.service.execute(
                        task, prompt, context=context, provider=provider, demo_mode=preferences["demo_mode"]
                    ),
                    timeout=self.config.ai_timeout_seconds,
                )
            envelope = Envelope.model_validate(result).model_dump()
            if envelope["mock"] != (envelope["provider"] == "mock"):
                raise ValueError("Invalid provider provenance")
            if task == "generate_mission":
                envelope["data"] = MissionConfiguration.model_validate(envelope["data"]).model_dump(mode="json")
            elif task == "generate_objectives":
                if not isinstance(envelope["data"], list) or not 1 <= len(envelope["data"]) <= 20:
                    raise ValueError("Invalid objective proposal count")
                envelope["data"] = [
                    MissionObjective.model_validate(item).model_dump(mode="json") for item in envelope["data"]
                ]
                if body.mission_id:
                    mission = await asyncio.to_thread(self.store.get_mission, str(body.mission_id))
                    config = mission.model_dump(mode="json")
                    config["objectives"] += envelope["data"]
                    MissionConfiguration.model_validate(config)
            else:
                envelope["data"] = TextData.model_validate(envelope["data"]).model_dump()
            # Persist counts only; arbitrary provider metadata cannot enter audit logs.
            envelope["usage"] = {
                k: v
                for k, v in envelope["usage"].items()
                if k in {"input_tokens", "output_tokens", "total_tokens"} and type(v) is int and v >= 0
            }
            await asyncio.to_thread(self.store.audit_ai, task, envelope)
            if task == "generate_report":
                await asyncio.to_thread(self.store.save_analysis, str(body.run_id), envelope)
            return envelope
        except Exception as exc:
            audit = {
                "provider": provider if provider in {"gemini", "qwen", "mock"} else "unavailable",
                "model": "unavailable",
                "latency_ms": (monotonic() - started) * 1000,
                "usage": {},
            }
            await asyncio.to_thread(self.store.audit_ai, task, audit, "failed")
            if isinstance(exc, (HTTPException, MissingError, UnavailableError)):
                raise
            raise UnavailableError("AI request failed or returned invalid output; simulation is unaffected") from None

    async def _context(self, task, body):
        prompt = body.message if task == "chat" else body.prompt
        context = {}
        if task in {"generate_mission", "generate_objectives", "chat"} and (not prompt or not prompt.strip()):
            raise HTTPException(422, "A nonblank prompt or message is required")
        if task == "generate_objectives" and body.mission_id:
            mission = await asyncio.to_thread(self.store.get_mission, str(body.mission_id))
            if not mission:
                raise MissingError("Mission not found")
            context["mission"] = mission.model_dump(mode="json")
        if task in {"chat", "explain_incident", "generate_report"}:
            if body.run_id is None:
                raise HTTPException(422, "run_id is required")
            state = await asyncio.to_thread(self.store.get_run, str(body.run_id))
            if not state:
                raise MissingError("Simulation not found")
            data = state.model_dump(mode="json")
            context.update(
                mission=data["mission"],
                status=data["status"],
                elapsed_time_seconds=data["elapsed_time_seconds"],
                metrics=data["metrics"],
                systems=data["systems"],
                objective_results=data["objective_results"],
                incidents=data["incidents"][-10:],
                events=data["events"][-20:],
                command_history=data["command_history"][-10:],
                history=data["history"][-10:],
            )
            if task == "explain_incident":
                if body.incident_id is None:
                    raise HTTPException(422, "incident_id is required")
                incident = next((i for i in data["incidents"] if i["id"] == str(body.incident_id)), None)
                if not incident:
                    raise MissingError("Incident not found")
                context["incident"] = incident
                prompt = "Explain this fictional incident using the provided state."
            if task == "generate_report":
                report = await asyncio.to_thread(self.store.get_report, str(body.run_id))
                if not report:
                    raise MissingError("Report not found; complete the simulation first")
                context["report"] = {
                    key: report.get(key)
                    for key in (
                        "success",
                        "status",
                        "elapsed_time_seconds",
                        "final_metrics",
                        "objective_results",
                        "summary",
                    )
                }
                prompt = "Describe this after-action report. Keep numerical outcomes unchanged."
        return prompt, context

    async def close(self):
        if self.service and hasattr(self.service, "aclose"):
            await self.service.aclose()
