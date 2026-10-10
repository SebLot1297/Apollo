"""Bounded optional inference with truthful provenance and deterministic fallback."""

import asyncio
from collections import deque
from time import monotonic

from fastapi import HTTPException

from app.core.errors import UnavailableError
from app.schemas.mission import MissionConfiguration

from .config import AIConfig
from .context import build_context
from .mock import MockAIProvider
from .prompts import TASKS, build_prompt
from .providers import GeminiProvider, ProviderError, ProviderResult, QwenProvider
from .validation import schema_for, strict_json, validate_data

SAFE_CODES = {
    "timeout",
    "authentication_failed",
    "model_or_endpoint_not_found",
    "upstream_rate_limited",
    "upstream_unavailable",
    "connection_failed",
    "provider_request_failed",
    "not_configured",
    "empty_response",
    "response_too_large",
    "invalid_response",
    "output_token_limit",
    "invalid_output",
}


class AIService:
    def __init__(self, config=None, *, providers=None):
        self.config = AIConfig.from_config(config)
        self.providers = (
            dict(providers)
            if providers is not None
            else {
                "gemini": GeminiProvider(self.config),
                "qwen": QwenProvider(self.config),
            }
        )
        if set(self.providers) - {"gemini", "qwen"}:
            raise ValueError("Only gemini and qwen adapters can be injected")
        self.mock = MockAIProvider()
        self._semaphore = asyncio.Semaphore(self.config.ai_max_concurrency)
        self._recent = deque()
        self._health_lock = asyncio.Lock()
        self._health = None
        self._health_at = 0.0
        self._health_cache_seconds = self.config.ai_health_cache_seconds
        self._closed = False

    def _configured(self, name):
        adapter = self.providers.get(name)
        return bool(adapter and adapter.configured and (name != "qwen" or self.config.enable_qwen))

    async def execute(self, task, prompt, context=None, provider=None, demo_mode=None):
        if self._closed:
            raise UnavailableError("AI service is closed")
        if not self.config.enable_ai:
            raise UnavailableError("AI is disabled")
        if not isinstance(task, str) or task not in TASKS:
            raise HTTPException(422, "Unsupported AI task")
        if prompt is None and task in {"generate_report", "explain_incident"}:
            prompt = ""
        if (
            not isinstance(prompt, str)
            or len(prompt) > 8000
            or (task in {"generate_mission", "generate_objectives", "chat"} and not prompt.strip())
        ):
            raise HTTPException(422, "AI prompt must be nonblank and at most 8000 characters")
        if provider is not None and (
            not isinstance(provider, str) or provider not in {"auto", "gemini", "qwen", "mock"}
        ):
            raise HTTPException(422, "Unsupported AI provider")
        if demo_mode is None:
            demo_mode = self.config.demo_mode
        if not isinstance(demo_mode, bool):
            raise HTTPException(422, "demo_mode must be a boolean")
        if context is not None and not isinstance(context, dict):
            raise HTTPException(422, "AI context must be an object")
        if task == "generate_objectives" and context and context.get("mission") is not None:
            try:
                MissionConfiguration.model_validate(context["mission"])
            except Exception:
                raise HTTPException(422, "AI objective context requires a valid mission") from None
        started = monotonic()
        while self._recent and started - self._recent[0] >= 60:
            self._recent.popleft()
        if len(self._recent) >= self.config.ai_requests_per_minute:
            raise HTTPException(429, "AI request rate limit reached", headers={"Retry-After": "60"})
        self._recent.append(started)
        # Queue time is bounded; live work leaves room for validation and local fallback.
        try:
            return await asyncio.wait_for(
                self._execute(task, prompt, context, provider, demo_mode, started),
                timeout=self.config.ai_timeout_seconds * 0.9,
            )
        except TimeoutError:
            raise UnavailableError("AI service is busy or exceeded its deadline; simulation is unaffected") from None

    async def _execute(self, task, prompt, context, provider, demo_mode, started):
        async with self._semaphore:
            if self._closed:
                raise UnavailableError("AI service is closed")
            compact = build_context(context)
            system, user = build_prompt(task, prompt, compact)
            selected = provider if provider is not None else self.config.ai_primary_provider
            reasons = []
            if demo_mode:
                reasons.append("demo_mode")
            elif selected == "mock":
                reasons.append("mock_selected")
            else:
                primary = (
                    selected if selected != "auto" else ("qwen" if task in {"chat", "explain_incident"} else "gemini")
                )
                names = [primary, "qwen" if primary == "gemini" else "gemini"]
                live_deadline = started + self.config.ai_timeout_seconds * 0.8
                for index, name in enumerate(names):
                    if not self._configured(name):
                        reasons.append(f"{name}:not_configured")
                        continue
                    adapter = self.providers[name]
                    remaining = live_deadline - monotonic()
                    remaining_providers = sum(self._configured(candidate) for candidate in names[index:])
                    provider_deadline = monotonic() + max(0, remaining / remaining_providers)
                    for attempt in range(2):
                        timeout = (provider_deadline - monotonic()) / (2 - attempt)
                        if timeout <= 0:
                            reasons.append(f"{name}:timeout")
                            break
                        try:
                            if task in {"generate_mission", "generate_objectives"}:
                                call = adapter.generate_structured(
                                    system, user, schema_for(task), self.config.ai_max_output_tokens
                                )
                            else:
                                call = adapter.generate_text(system, user, self.config.ai_max_output_tokens)
                            result = await asyncio.wait_for(call, timeout=timeout)
                            data = self._validate_result(task, result, context)
                            return self._envelope(name, adapter.model, data, result.usage, reasons, started)
                        except TimeoutError:
                            error = ProviderError("timeout", retryable=True)
                        except ProviderError as exc:
                            error = exc
                        except Exception:
                            error = ProviderError("provider_request_failed")
                        code = error.code if error.code in SAFE_CODES else "provider_request_failed"
                        if error.retryable and attempt == 0 and provider_deadline - monotonic() > 0.05:
                            await asyncio.sleep(min(0.05, (provider_deadline - monotonic()) / 4))
                            continue
                        reasons.append(f"{name}:{code}")
                        break
            # Collision checks use all existing IDs, separately from the compact model context.
            existing_ids = set()
            if task == "generate_objectives" and isinstance(context, dict) and context.get("mission") is not None:
                existing_ids = {
                    str(item.id) for item in MissionConfiguration.model_validate(context["mission"]).objectives
                }
            data = validate_data(task, self.mock.generate(task, prompt, compact, existing_ids=existing_ids), context)
            return self._envelope("mock", self.mock.model, data, {}, reasons, started)

    @staticmethod
    def _validate_result(task, result, context):
        try:
            if not isinstance(result, ProviderResult) or not isinstance(result.text, str):
                raise ValueError("invalid provider result")
            if not result.text.strip() or len(result.text) > 64000:
                raise ValueError("empty or oversized output")
            data = (
                strict_json(result.text)
                if task in {"generate_mission", "generate_objectives"}
                else {
                    "text": result.text,
                }
            )
            return validate_data(task, data, context)
        except Exception:
            raise ProviderError("invalid_output") from None

    @staticmethod
    def _envelope(name, model, data, usage, reasons, started):
        return {
            "provider": name,
            "model": model,
            "mock": name == "mock",
            "fallback_reason": "; ".join(reasons) or None,
            "data": data,
            "usage": {
                key: value
                for key, value in (usage.items() if isinstance(usage, dict) else [])
                if key in {"input_tokens", "output_tokens", "total_tokens"} and type(value) is int and value >= 0
            },
            "latency_ms": (monotonic() - started) * 1000,
        }

    async def status(self):
        if self._closed:
            raise UnavailableError("AI service is closed")
        async with self._health_lock:
            now = monotonic()
            if self._health is not None and now - self._health_at < self._health_cache_seconds:
                return [dict(item) for item in self._health]

            async def check(name):
                adapter = self.providers.get(name)
                model = adapter.model if adapter else getattr(self.config, f"{name}_model")
                configured = self._configured(name)
                available = False
                detail = "not_configured"
                if not self.config.enable_ai:
                    detail = "AI disabled"
                elif configured:
                    try:
                        available = bool(
                            await asyncio.wait_for(
                                adapter.health_check(), timeout=min(3, self.config.ai_timeout_seconds * 0.4)
                            )
                        )
                        detail = (
                            "Model metadata reachable; inference unverified"
                            if available
                            else "Model metadata unavailable; inference unverified"
                        )
                    except TimeoutError:
                        detail = "Health probe failed: timeout; inference unverified"
                    except ProviderError as exc:
                        code = exc.code if exc.code in SAFE_CODES else "provider_request_failed"
                        detail = f"Health probe failed: {code}; inference unverified"
                    except Exception:
                        detail = "Health probe failed: provider_request_failed; inference unverified"
                return {
                    "provider": name,
                    "model": model,
                    "configured": configured,
                    "available": available,
                    "detail": detail,
                }

            statuses = await asyncio.gather(check("gemini"), check("qwen"))
            statuses.append(
                {
                    "provider": "mock",
                    "model": self.mock.model,
                    "configured": True,
                    "available": self.config.enable_ai,
                    "detail": "Deterministic local templates; no inference" if self.config.enable_ai else "AI disabled",
                }
            )
            # A transient metadata failure must not disable the UI for a full
            # successful-health cache period. Still coalesce concurrent probes.
            failed_probe = self.config.enable_ai and any(
                item["configured"] and not item["available"] for item in statuses[:2]
            )
            self._health_cache_seconds = (
                min(5, self.config.ai_health_cache_seconds) if failed_probe else self.config.ai_health_cache_seconds
            )
            self._health, self._health_at = statuses, monotonic()
            return [dict(item) for item in statuses]

    async def aclose(self):
        if self._closed:
            return
        self._closed = True

        # All providers get a bounded cleanup attempt even if one fails.
        async def close(adapter):
            try:
                await asyncio.wait_for(adapter.aclose(), timeout=2)
            except Exception:
                pass

        await asyncio.gather(*(close(p) for p in self.providers.values()), close(self.mock))
