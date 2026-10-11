"""Offline provider contracts and actual Part A/B integration for Part D."""

import asyncio
import copy
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text
from test_real_engine_integration import command
from test_repositories import storage as storage

from app.core.errors import UnavailableError
from app.data.seed import demo_mission
from app.main import create_app
from app.schemas.mission import MissionConfiguration
from app.services.ai.config import AIConfig
from app.services.ai.context import build_context
from app.services.ai.providers import GeminiProvider, ProviderError, ProviderResult, QwenProvider, valid_endpoint
from app.services.ai.service import AIService


class FakeProvider:
    configured = True

    def __init__(self, name, results=None):
        self.name = name
        self.model = f"test-{name}"
        self.results = list(results or [ProviderResult("Observed state.")])
        self.calls = []
        self.health_calls = 0
        self.closed = False

    async def generate_text(self, system, prompt, max_tokens):
        self.calls.append((system, prompt, max_tokens))
        result = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        if isinstance(result, Exception):
            raise result
        return result

    async def generate_structured(self, system, prompt, schema, max_tokens):
        return await self.generate_text(system, prompt, max_tokens)

    async def health_check(self):
        self.health_calls += 1
        await asyncio.sleep(0)
        return True

    async def aclose(self):
        self.closed = True


def service(*providers, **config):
    return AIService(AIConfig(enable_qwen=True, **config), providers={p.name: p for p in providers})


@pytest.mark.parametrize(
    "task,primary",
    [
        ("generate_mission", "gemini"),
        ("generate_objectives", "gemini"),
        ("generate_report", "gemini"),
        ("chat", "qwen"),
        ("explain_incident", "qwen"),
    ],
)
async def test_routing_and_validated_envelope(task, primary):
    mission = demo_mission().model_dump(mode="json")
    data = mission if task == "generate_mission" else {"objectives": mission["objectives"]}
    result = ProviderResult(
        json.dumps(data) if task.startswith("generate_") and task != "generate_report" else "Observed state.",
        {"input_tokens": 7, "total_tokens": 12, "secret": "hidden"},
    )
    gemini, qwen = FakeProvider("gemini", [result]), FakeProvider("qwen", [result])
    output = await service(gemini, qwen).execute(task, "Explain recorded conditions")
    assert output["provider"] == primary
    assert output["mock"] is False
    assert output["fallback_reason"] is None
    assert output["usage"] == {"input_tokens": 7, "total_tokens": 12}
    assert len(gemini.calls) + len(qwen.calls) == 1
    if task == "generate_mission":
        MissionConfiguration.model_validate(output["data"])
    if task == "generate_objectives":
        assert isinstance(output["data"], list)


async def test_invalid_json_and_auth_failure_fall_back_without_secrets():
    gemini = FakeProvider("gemini", [ProviderResult('{"secret":"private-test-secret"}')])
    qwen = FakeProvider("qwen", [ProviderError("authentication_failed")])
    result = await service(gemini, qwen).execute("generate_mission", "Create an exercise")
    assert result["provider"] == "mock" and result["mock"] is True
    assert "invalid_output" in result["fallback_reason"]
    assert "authentication_failed" in result["fallback_reason"]
    assert "private-test-secret" not in json.dumps(result)
    assert len(gemini.calls) == len(qwen.calls) == 1
    MissionConfiguration.model_validate(result["data"])


async def test_demo_and_explicit_mock_never_call_live_providers():
    gemini, qwen = FakeProvider("gemini"), FakeProvider("qwen")
    ai = service(gemini, qwen)
    first = await ai.execute("generate_mission", "Recovery", demo_mode=True)
    second = await ai.execute("generate_mission", "Recovery", provider="mock")
    assert first["data"] == second["data"]
    assert first["fallback_reason"] == "demo_mode"
    assert second["fallback_reason"] == "mock_selected"
    assert not gemini.calls and not qwen.calls
    assert gemini.health_calls == qwen.health_calls == 0


async def test_disabled_and_rate_limits_are_explicit():
    with pytest.raises(UnavailableError, match="disabled"):
        await service(enable_ai=False).execute("chat", "hello", demo_mode=True)
    ai = service(ai_requests_per_minute=1)
    await ai.execute("chat", "hello", provider="mock")
    with pytest.raises(HTTPException) as failure:
        await ai.execute("chat", "again", provider="mock")
    assert failure.value.status_code == 429


async def test_transient_retry_then_alternate():
    gemini = FakeProvider("gemini", [ProviderError("upstream_unavailable", retryable=True)])
    qwen = FakeProvider("qwen")
    result = await service(gemini, qwen).execute("generate_report", "Explain report")
    assert result["provider"] == "qwen"
    assert len(gemini.calls) == 2 and len(qwen.calls) == 1


async def test_only_configured_provider_gets_full_live_deadline():
    class SlowProvider(FakeProvider):
        async def generate_text(self, system, prompt, max_tokens):
            await asyncio.sleep(0.25)
            return await super().generate_text(system, prompt, max_tokens)

    gemini = SlowProvider("gemini")
    ai = service(gemini, ai_timeout_seconds=1)
    result = await ai.execute("generate_report", "Explain recorded metrics", provider="gemini")
    assert result["provider"] == "gemini"
    assert result["mock"] is False
    assert result["fallback_reason"] is None
    await ai.aclose()


async def test_cached_health_and_cleanup():
    gemini, qwen = FakeProvider("gemini"), FakeProvider("qwen")
    ai = service(gemini, qwen)
    first, second = await asyncio.gather(ai.status(), ai.status())
    assert first == second
    assert gemini.health_calls == qwen.health_calls == 1
    assert all(item["available"] for item in first)
    assert "inference unverified" in first[0]["detail"]
    await ai.aclose()
    assert gemini.closed and qwen.closed
    with pytest.raises(UnavailableError, match="closed"):
        await ai.execute("chat", "hi")


async def test_failed_health_recovers_without_waiting_for_success_cache(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("app.services.ai.service.monotonic", lambda: clock[0])

    class RecoveringProvider(FakeProvider):
        async def health_check(self):
            self.health_calls += 1
            if self.health_calls == 1:
                raise ProviderError("timeout", retryable=True)
            return True

    gemini = RecoveringProvider("gemini")
    ai = service(gemini, ai_health_cache_seconds=60)
    assert (await ai.status())[0]["available"] is False
    clock[0] += 1
    assert (await ai.status())[0]["available"] is False
    assert gemini.health_calls == 1
    clock[0] += 5
    assert (await ai.status())[0]["available"] is True
    assert gemini.health_calls == 2
    clock[0] += 6
    assert (await ai.status())[0]["available"] is True
    assert gemini.health_calls == 2
    await ai.aclose()


@pytest.mark.parametrize("code", ["timeout", "authentication_failed", "model_or_endpoint_not_found"])
async def test_health_status_reports_safe_provider_error_codes(code):
    class BrokenProvider(FakeProvider):
        async def health_check(self):
            raise ProviderError(code)

    ai = service(BrokenProvider("gemini"))
    status = (await ai.status())[0]
    assert status["available"] is False
    assert code in status["detail"]
    await ai.aclose()


async def test_health_status_does_not_expose_arbitrary_exceptions():
    class BrokenProvider(FakeProvider):
        async def health_check(self):
            raise RuntimeError("private-secret")

    ai = service(BrokenProvider("gemini"))
    status = (await ai.status())[0]
    assert "provider_request_failed" in status["detail"]
    assert "private-secret" not in json.dumps(status)
    await ai.aclose()


def test_context_is_bounded_and_input_unchanged():
    context = {
        "metrics": {"communication_uptime_percent": 83.125},
        "events": [{"message": str(i) + "x" * 10000, "api_key": "secret"} for i in range(200)],
        "custom_metadata": {"secret": "secret"},
        "native_snapshot": "secret",
    }
    before = copy.deepcopy(context)
    result = build_context(context)
    assert len(json.dumps(result, ensure_ascii=True)) <= 12000
    assert result["metrics"]["communication_uptime_percent"] == 83.125
    assert "secret" not in json.dumps(result)
    assert context == before
    assert result["events"][-1]["message"].startswith("199")


@pytest.mark.parametrize(
    "config",
    [
        {"ai_timeout_seconds": float("nan")},
        {"ai_max_concurrency": True},
        {"ai_requests_per_minute": 1.5},
        {"enable_ai": "maybe"},
        {"gemini_model": ""},
    ],
)
def test_invalid_config(config):
    with pytest.raises(ValueError):
        AIConfig.from_config(config)


def test_context_total_budget_nonfinite_and_huge_integers():
    result = build_context(
        {
            "metrics": {"systems_restored": 10**1000, "communication_uptime_percent": float("inf")},
            "systems": {"power_availability": 92.75},
            "mission": demo_mission(),
        },
        max_chars=100,
    )
    assert len(json.dumps(result, ensure_ascii=True)) <= 100
    assert "Infinity" not in json.dumps(result)


@pytest.mark.parametrize(
    "url",
    [
        "http://public.example/v1",
        "https://key:secret@host/v1",
        "https://host:bad/v1",
        "http://127.0.0.1:70000/v1",
        "https://host/v1?key=secret",
        "file:///tmp/api",
    ],
)
def test_unsafe_endpoint(url):
    assert valid_endpoint(url) is False


@pytest.mark.parametrize(
    "url", ["http://127.0.0.1:8001/v1", "http://10.0.0.2/v1", "http://[::1]:8001/v1", "https://inference.example/v1"]
)
def test_safe_endpoint(url):
    assert valid_endpoint(url) is True


@pytest.mark.parametrize(
    "bad",
    [
        '{"objectives":[],"objectives":[]}',
        '{"objectives":[NaN]}',
        "[]",
        "not JSON",
        '{"objectives":[{"name":"Goal","metric_key":"arbitrary_expression","target_value":5}]}',
    ],
)
async def test_structured_output_rejected(bad):
    gemini = FakeProvider("gemini", [ProviderResult(bad)])
    result = await service(gemini).execute("generate_objectives", "Recovery")
    assert result["provider"] == "mock"
    assert len(gemini.calls) == 1


async def test_objectives_merge_checks_deadline_and_duplicate_ids():
    mission = demo_mission().model_dump(mode="json")
    gemini = FakeProvider("gemini", [ProviderResult(json.dumps({"objectives": mission["objectives"]}))])
    ai = service(gemini)
    result = await ai.execute("generate_objectives", "Goals", context={"mission": mission})
    assert result["mock"] is True
    ids = {item["id"] for item in mission["objectives"]}
    assert not ids.intersection(item["id"] for item in result["data"])
    mission["objectives"] += result["data"]
    MissionConfiguration.model_validate(mission)
    again = await ai.execute("generate_objectives", "Goals", context={"mission": mission})
    mission["objectives"] += again["data"]
    MissionConfiguration.model_validate(mission)


async def test_primary_override_and_disabled_qwen():
    gemini, qwen = FakeProvider("gemini"), FakeProvider("qwen")
    ai = service(gemini, qwen, ai_primary_provider="gemini")
    assert (await ai.execute("chat", "hi"))["provider"] == "gemini"
    assert (await ai.execute("chat", "hi", provider="qwen"))["provider"] == "qwen"
    ai = AIService(AIConfig(enable_qwen=False), providers={"gemini": gemini, "qwen": qwen})
    assert (await ai.execute("chat", "hi"))["provider"] == "gemini"
    assert len(qwen.calls) == 1


async def test_mock_additions_work_after_twenty_four_existing_objectives():
    mission = demo_mission().model_dump(mode="json")
    mission["objectives"] = [dict(mission["objectives"][0], id=str(uuid4())) for _ in range(24)]
    ai = service()
    for _ in range(2):
        result = await ai.execute("generate_objectives", "Same goals", context={"mission": mission}, provider="mock")
        assert result["mock"] is True
        mission["objectives"] += result["data"]
        MissionConfiguration.model_validate(mission)


async def test_timeout_fallback_and_concurrency():
    class Slow(FakeProvider):
        active = 0
        maximum = 0
        cancellations = 0

        async def generate_text(self, *args):
            self.active += 1
            self.maximum = max(self.maximum, self.active)
            try:
                await asyncio.sleep(20)
            finally:
                self.active -= 1
                self.cancellations += 1

    slow = Slow("qwen")
    ai = service(slow, ai_timeout_seconds=0.4, ai_max_concurrency=1)
    outcomes = await asyncio.gather(*(ai.execute("chat", "hi") for _ in range(3)), return_exceptions=True)
    assert outcomes[0]["mock"] is True
    assert "timeout" in outcomes[0]["fallback_reason"]
    assert slow.maximum == 1 and slow.active == 0 and slow.cancellations >= 2
    assert all(isinstance(item, (dict, UnavailableError)) for item in outcomes)


async def test_gateway_deadline_includes_its_concurrency_queue():
    from time import monotonic

    from app.api.requests import AIRequest
    from app.services.reports.ai_gateway import AIGateway

    class Slow(FakeProvider):
        async def generate_text(self, *args):
            await asyncio.sleep(5)

    class Store:
        def audit_ai(self, *args):
            pass

    config = AIConfig(enable_qwen=True, ai_timeout_seconds=0.2, ai_max_concurrency=1)
    gateway = AIGateway(Store(), config, AIService(config, providers={"qwen": Slow("qwen")}))

    async def context(task, body):
        return "Explain", {}

    gateway._context = context
    started = monotonic()
    results = await asyncio.gather(
        *(
            gateway.execute("chat", AIRequest(message="hi"), {"ai_provider": "auto", "demo_mode": False})
            for _ in range(8)
        ),
        return_exceptions=True,
    )
    assert monotonic() - started < 0.35
    assert any(isinstance(item, UnavailableError) for item in results)
    await gateway.close()


@pytest.mark.parametrize(
    "status,code,retryable",
    [
        (401, "authentication_failed", False),
        (403, "authentication_failed", False),
        (404, "model_or_endpoint_not_found", False),
        (429, "upstream_rate_limited", True),
        (503, "upstream_unavailable", True),
        (302, "provider_request_failed", False),
    ],
)
async def test_qwen_errors_are_fixed_and_secret_free(status, code, retryable):
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(status, text="private-secret", headers={"Location": "https://other/v1"})
        )
    )
    adapter = QwenProvider(
        AIConfig(enable_qwen=True, qwen_api_key="private-secret", qwen_base_url="http://127.0.0.1:8001"), client=client
    )
    with pytest.raises(ProviderError) as failure:
        await adapter.generate_text("system", "user", 64)
    assert failure.value.code == code and failure.value.retryable is retryable
    assert "private-secret" not in str(failure.value)
    await adapter.aclose()


async def test_qwen_request_schema_health_and_usage():
    requests = []

    def handler(request):
        requests.append(request)
        assert request.headers["Authorization"] == "Bearer private-secret"
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "Qwen/Qwen3.8-27B"}]})
        return httpx.Response(
            200,
            json={
                "choices": [{"finish_reason": "stop", "message": {"content": '{"a":1}'}}],
                "usage": {"prompt_tokens": 2, "completion_tokens": True, "total_tokens": 4},
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    adapter = QwenProvider(
        AIConfig(enable_qwen=True, qwen_api_key="private-secret", qwen_base_url="http://127.0.0.1:8001/v1"),
        client=client,
    )
    assert await adapter.health_check()
    result = await adapter.generate_structured("system", "user", {"type": "object"}, 100)
    payload = json.loads(requests[-1].content)
    assert payload["response_format"]["json_schema"]["schema"] == {"type": "object"}
    assert payload["chat_template_kwargs"] == {"enable_thinking": False}
    assert payload["max_tokens"] == 100
    assert result.usage == {"input_tokens": 2, "total_tokens": 4}
    await adapter.aclose()
    assert client.is_closed


@pytest.mark.parametrize(
    "body,code",
    [
        ({"choices": []}, "invalid_response"),
        ({"choices": [{"message": {"content": ""}}]}, "empty_response"),
        ({"choices": [{"message": {"content": "partial"}, "finish_reason": "length"}]}, "output_token_limit"),
        ({"choices": ["invalid"]}, "invalid_response"),
        ({"choices": [{"message": []}]}, "invalid_response"),
    ],
)
async def test_qwen_invalid_empty_truncated(body, code):
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body)))
    adapter = QwenProvider(
        AIConfig(enable_qwen=True, qwen_api_key="x", qwen_base_url="http://127.0.0.1:8001/v1"), client=client
    )
    with pytest.raises(ProviderError, match=code):
        await adapter.generate_text("system", "user", 64)
    await adapter.aclose()


async def test_gemini_sdk_contract_and_cleanup():
    class Models:
        calls = []

        async def generate_content(self, **kwargs):
            self.calls.append(kwargs)
            return SimpleNamespace(
                text='{"a":1}',
                usage_metadata=SimpleNamespace(prompt_token_count=3, candidates_token_count=2, total_token_count=5),
                candidates=[],
            )

        async def get(self, **kwargs):
            return SimpleNamespace(name=kwargs["model"])

    class Client:
        closed = False

        async def aclose(self):
            self.closed = True

    client = Client()
    client.aio = client
    client.models = Models()
    adapter = GeminiProvider(AIConfig(gemini_api_key="private-secret"), client=client)
    assert await adapter.health_check()
    result = await adapter.generate_structured("system", "user", {"type": "object"}, 100)
    from google.genai.types import GenerateContentConfig, HttpOptions, HttpRetryOptions

    parsed = GenerateContentConfig.model_validate(client.models.calls[0]["config"])
    assert parsed.response_json_schema == {"type": "object"}
    assert HttpOptions(timeout=100, retry_options=HttpRetryOptions(attempts=1)).timeout == 100
    assert result.usage == {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}
    await adapter.aclose()
    assert client.closed


async def test_gemini_model_chain_falls_through_on_rate_limit():
    calls = []

    class Models:
        async def generate_content(self, **kwargs):
            calls.append(kwargs["model"])
            if kwargs["model"] == "first-model":
                raise httpx.HTTPStatusError(
                    "rate limited",
                    request=httpx.Request("POST", "https://example.invalid"),
                    response=httpx.Response(429),
                )
            return SimpleNamespace(
                text="live answer", candidates=[SimpleNamespace(finish_reason="STOP")], usage_metadata=None
            )

    adapter = GeminiProvider(
        AIConfig(gemini_api_key="x", gemini_model="first-model,second-model"),
        client=SimpleNamespace(aio=SimpleNamespace(models=Models())),
    )
    result = await adapter.generate_text("system", "user", 64)
    assert calls == ["first-model", "second-model"]
    assert result.model == "second-model"
    assert result.text == "live answer"


async def test_gemini_model_chain_reports_rate_limit_only_when_every_model_fails():
    class Models:
        async def generate_content(self, **kwargs):
            raise httpx.HTTPStatusError(
                "rate limited",
                request=httpx.Request("POST", "https://example.invalid"),
                response=httpx.Response(429),
            )

    adapter = GeminiProvider(
        AIConfig(gemini_api_key="x", gemini_model="first-model,second-model"),
        client=SimpleNamespace(aio=SimpleNamespace(models=Models())),
    )
    with pytest.raises(ProviderError) as failure:
        await adapter.generate_text("system", "user", 64)
    assert failure.value.code == "upstream_rate_limited"
    assert failure.value.retryable is True


async def test_gemini_chain_stops_early_when_the_key_itself_is_rate_limited():
    class Models:
        calls = []

        async def generate_content(self, **kwargs):
            self.calls.append(kwargs["model"])
            raise ProviderError("upstream_rate_limited", retryable=True)

    models = Models()
    adapter = GeminiProvider(
        AIConfig(gemini_api_key="x", gemini_model="m1,m2,m3,m4,m5"),
        client=SimpleNamespace(aio=SimpleNamespace(models=models)),
    )
    with pytest.raises(ProviderError, match="upstream_rate_limited"):
        await adapter.generate_text("system", "user", 64)
    assert models.calls == ["m1", "m2", "m3"]  # a limited key is not walked to the end


async def test_gemini_chain_advances_past_a_hanging_model():
    class Models:
        async def generate_content(self, **kwargs):
            if kwargs["model"] == "slow-model":
                await asyncio.sleep(5)
            return SimpleNamespace(text="ok", candidates=[], usage_metadata=None)

    adapter = GeminiProvider(
        AIConfig(gemini_api_key="x", gemini_model="slow-model,fast-model", ai_timeout_seconds=2.0),
        client=SimpleNamespace(aio=SimpleNamespace(models=Models())),
    )
    result = await adapter.generate_text("system", "user", 64)
    assert result.model == "fast-model"


async def test_gemini_chain_advances_when_a_model_ignores_cancellation():
    class Models:
        async def generate_content(self, **kwargs):
            if kwargs["model"] == "stubborn-model":
                try:
                    await asyncio.sleep(3)
                except asyncio.CancelledError:
                    # A model that swallows cancellation must not stall the chain.
                    await asyncio.sleep(0.2)
                    raise
            return SimpleNamespace(text="ok", candidates=[], usage_metadata=None)

    adapter = GeminiProvider(
        AIConfig(gemini_api_key="x", gemini_model="stubborn-model,fast-model", ai_timeout_seconds=0.5),
        client=SimpleNamespace(aio=SimpleNamespace(models=Models())),
    )
    result = await adapter.generate_text("system", "user", 64)
    await asyncio.sleep(0.3)  # let the abandoned call unwind before the loop closes
    assert result.model == "fast-model"


def test_plain_text_reduces_markdown_and_latex_to_prose():
    from app.services.ai.validation import plain_text

    raw = (
        "**Operation Signal Restore**\n\n"
        "This run measures:\n"
        "* Maintaining communication service (target $\\ge 90\\%$, achieved $\\approx$ 93.71%)\n"
        "* Restoring two systems\n\n"
        "### Notes\n"
        "Use `communication_uptime_percent` for the key, and *only* recorded facts."
    )
    result = plain_text(raw)
    for symbol in ("**", "$", "`", "\\ge", "\\approx", "#", "*"):
        assert symbol not in result
    assert "Operation Signal Restore" in result
    assert "- Maintaining communication service (target >= 90%, achieved ~ 93.71%)" in result
    assert "- Restoring two systems" in result
    assert "Notes" in result
    assert "communication_uptime_percent" in result  # metric keys keep their underscores
    assert "only recorded facts" in result
    assert plain_text(result) == result  # normalization is idempotent


async def test_service_returns_plain_prose_for_narrative_tasks():
    provider = FakeProvider("gemini", [ProviderResult("**Status**\n* uptime $\\ge$ 90\\%")])
    ai = service(provider)
    envelope = await ai.execute("chat", "How is the run doing?", provider="gemini")
    assert envelope["data"]["text"] == "Status\n- uptime >= 90%"


def test_default_gemini_chain_keeps_gemma_last():
    chain = [segment.strip() for segment in AIConfig().gemini_model.split(",")]
    assert chain[0] == "gemini-3.8-flash"
    assert chain[-1].startswith("gemma-4")
    assert len(chain) >= 5


@pytest.mark.parametrize(
    "text_value,finish,code",
    [
        ("", "STOP", "empty_response"),
        ("partial", "MAX_TOKENS", "output_token_limit"),
        ("x" * 64001, "STOP", "response_too_large"),
    ],
    ids=["empty", "truncated", "oversized"],
)
async def test_gemini_bad_output(text_value, finish, code):
    class Models:
        async def generate_content(self, **kwargs):
            return SimpleNamespace(text=text_value, candidates=[SimpleNamespace(finish_reason=finish)])

    client = SimpleNamespace(aio=SimpleNamespace(models=Models()))
    adapter = GeminiProvider(AIConfig(gemini_api_key="x"), client=client)
    with pytest.raises(ProviderError, match=code):
        await adapter.generate_text("system", "user", 64)


@pytest.mark.parametrize("kind", ["oversized", "timeout", "invalid_json", "connection"])
async def test_qwen_transport_bounds(kind):
    def handler(request):
        if kind == "timeout":
            raise httpx.ReadTimeout("private-secret", request=request)
        if kind == "connection":
            raise httpx.ConnectError("private-secret", request=request)
        return httpx.Response(200, content=b"x" * 262145 if kind == "oversized" else b"not JSON")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    adapter = QwenProvider(
        AIConfig(enable_qwen=True, qwen_api_key="x", qwen_base_url="http://127.0.0.1:8001/v1"), client=client
    )
    with pytest.raises(ProviderError) as failure:
        await adapter.generate_text("system", "user", 64)
    assert "private-secret" not in str(failure.value)
    assert (
        failure.value.code
        == {
            "oversized": "response_too_large",
            "timeout": "timeout",
            "invalid_json": "provider_request_failed",
            "connection": "connection_failed",
        }[kind]
    )
    await adapter.aclose()


async def test_invalid_input_secret_failure_and_cleanup_continues():
    broken = FakeProvider("gemini", [RuntimeError("private-secret")])
    ai = service(broken)
    for task, prompt, provider in [
        ("unknown", "hi", None),
        ("chat", " ", None),
        ("chat", "x" * 8001, None),
        ("chat", "hi", "evil"),
    ]:
        with pytest.raises(HTTPException) as failure:
            await ai.execute(task, prompt, provider=provider)
        assert failure.value.status_code == 422
    result = await ai.execute("generate_report", "hi")
    assert "private-secret" not in json.dumps(result)
    assert "provider_request_failed" in result["fallback_reason"]
    healthy = FakeProvider("qwen")

    async def failing_close():
        raise RuntimeError("private-secret")

    broken.aclose = failing_close
    ai.providers["qwen"] = healthy
    await ai.aclose()
    assert healthy.closed


async def test_mock_preserves_fractional_metrics_in_narrative():
    result = await service().execute(
        "generate_report",
        "Explain",
        provider="mock",
        context={
            "report": {"success": False, "final_metrics": {"communication_uptime_percent": 89.9999999}},
        },
    )
    assert "89.9999999" in result["data"]["text"]
    assert "unsuccessful" in result["data"]["text"]


async def test_unhashable_task_and_provider_are_validation_errors():
    ai = service()
    for task, provider in [([], None), ("chat", [])]:
        with pytest.raises(HTTPException) as failure:
            await ai.execute(task, "hello", provider=provider)
        assert failure.value.status_code == 422


async def test_malformed_direct_context_is_bounded_or_rejected():
    ai = service()
    result = await ai.execute("chat", "hi", provider="mock", context={"objective_results": [None, {"objective": None}]})
    assert result["mock"] is True
    result = await ai.execute("chat", "hi", provider="mock", context={"incident": {"kind": []}})
    assert result["mock"] is True
    with pytest.raises(HTTPException) as failure:
        await ai.execute("generate_objectives", "Goals", provider="mock", context={"mission": {"secret": "private"}})
    assert failure.value.status_code == 422
    assert "private" not in str(failure.value)


async def test_mock_adapter_protocol_and_config_demo_default():
    from app.services.ai.mock import MockAIProvider
    from app.services.ai.prompts import build_prompt
    from app.services.ai.validation import schema_for

    adapter = MockAIProvider()
    system, prompt = build_prompt("generate_mission", "Exercise", {})
    result = await adapter.generate_structured(system, prompt, schema_for("generate_mission"), 2048)
    MissionConfiguration.model_validate(json.loads(result.text))
    ai = service(FakeProvider("gemini"), demo_mode=True)
    assert (await ai.execute("generate_mission", "Exercise"))["fallback_reason"] == "demo_mode"


async def test_websocket_cancellation_during_update_drains_replacement_receive():
    from contextlib import suppress

    from app.api.routes import stream
    from app.websocket.hub import Hub

    hub = Hub()
    run_id = uuid4()
    sending = asyncio.Event()
    replacement_closed = asyncio.Event()
    receivers = []

    class Controller:
        async def snapshot_subscription(self, identity):
            queue = hub.subscribe(identity)
            queue.put_nowait({"type": "update"})
            return SimpleNamespace(sequence=1, model_dump=lambda **kwargs: {}), queue

    class Socket:
        headers = {}
        app = SimpleNamespace(state=SimpleNamespace(controller=Controller(), hub=hub))
        count = 0

        async def accept(self):
            pass

        async def receive(self):
            self.count += 1
            if self.count == 1:
                return {"type": "websocket.receive", "text": "ping"}
            receivers.append(asyncio.current_task())
            try:
                await asyncio.sleep(20)
            finally:
                replacement_closed.set()

        async def send_json(self, data):
            if data["type"] == "update":
                sending.set()
                await asyncio.sleep(20)

    task = asyncio.create_task(stream(Socket(), run_id))
    try:
        await asyncio.wait_for(sending.wait(), timeout=2)
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        assert replacement_closed.is_set()
        assert not hub.subscribers
    finally:
        task.cancel()
        for receiver in receivers:
            receiver.cancel()
        await asyncio.gather(task, *receivers, return_exceptions=True)


def test_actual_api_autoloads_service_proposals_require_explicit_save(storage):
    settings = storage.db.settings.model_copy(update={"gemini_api_key": "", "enable_qwen": False})
    with TestClient(create_app(settings, start_runner=False)) as client:
        assert client.get("/ready").json()["ai_service_ready"] is True
        statuses = client.get("/api/v1/ai/providers/status").json()
        assert statuses[-1]["provider"] == "mock" and statuses[-1]["available"] is True
        assert all(item["available"] is False for item in statuses[:2])
        before = client.get("/api/v1/missions").json()
        response = client.post("/api/v1/ai/generate-mission", json={"prompt": "Recovery exercise"})
        assert response.status_code == 200, response.text
        envelope = response.json()
        assert envelope["provider"] == "mock"
        assert envelope["fallback_reason"] == "gemini:not_configured; qwen:not_configured"
        assert client.get("/api/v1/missions").json() == before
        mission = envelope["data"]
        assert client.post("/api/v1/missions", json=mission).status_code == 201
        before = client.get(f"/api/v1/missions/{mission['id']}").json()
        response = client.post(
            "/api/v1/ai/generate-objectives",
            json={
                "prompt": "More goals",
                "mission_id": mission["id"],
                "provider": "mock",
            },
        )
        assert response.status_code == 200, response.text
        assert client.get(f"/api/v1/missions/{mission['id']}").json() == before
        with storage.db.engine.connect() as connection:
            audits = connection.execute(text("SELECT provider, status, estimated_cost FROM ai_requests")).all()
        assert [(row.provider, row.status, row.estimated_cost) for row in audits] == [
            ("mock", "success", None),
            ("mock", "success", None),
        ]


def test_actual_api_narrative_cannot_change_report_or_commands(storage):
    # An inaccurate narrative still cannot overwrite the separate deterministic report fields.
    gemini = FakeProvider("gemini", [ProviderResult("Model text says success=true and uptime=100.")])
    ai = AIService(storage.db.settings, providers={"gemini": gemini})
    app = create_app(storage.db.settings, ai_service=ai, start_runner=False)
    with TestClient(app) as client:
        mission_id = client.get("/api/v1/missions").json()[0]["id"]
        state = client.post("/api/v1/simulations", json={"mission_id": mission_id}).json()
        run_id = state["run_id"]
        command(client, run_id, "start")
        incident = command(client, run_id, "trigger_incident", {"kind": "power_failure"})["incidents"][-1]
        for endpoint, body in [
            ("explain-incident", {"run_id": run_id, "incident_id": incident["id"], "provider": "mock"}),
            ("chat", {"run_id": run_id, "message": "Explain conditions", "provider": "mock"}),
        ]:
            before = client.get(f"/api/v1/simulations/{run_id}").json()
            response = client.post(f"/api/v1/ai/{endpoint}", json=body)
            assert response.status_code == 200, response.text
            assert response.json()["mock"] is True
            assert client.get(f"/api/v1/simulations/{run_id}").json() == before
        command(client, run_id, "terminate")
        before = client.get(f"/api/v1/reports/{run_id}").json()
        response = client.post("/api/v1/ai/generate-report", json={"run_id": run_id})
        assert response.status_code == 200, response.text
        assert response.json()["provider"] == "gemini"
        after = client.get(f"/api/v1/reports/{run_id}").json()
        assert after["success"] is False
        assert {k: v for k, v in after.items() if k != "ai_analysis"} == {
            k: v for k, v in before.items() if k != "ai_analysis"
        }
        assert after["ai_analysis"] == response.json()
        prompt_context = json.loads(gemini.calls[0][1])["recorded_context"]
        assert prompt_context["final_metrics"] == before["final_metrics"]
        assert prompt_context["success"] is False


def test_actual_api_disabled_request_is_audited(storage):
    settings = storage.db.settings.model_copy(update={"enable_ai": False})
    with TestClient(create_app(settings, start_runner=False)) as client:
        response = client.post("/api/v1/ai/generate-mission", json={"prompt": "Recovery", "provider": "mock"})
        assert response.status_code == 503
        with storage.db.engine.connect() as connection:
            assert connection.execute(text("SELECT status FROM ai_requests")).scalar_one() == "failed"


def test_ai_ready_app_websocket_reconnects_release_subscriptions(storage):
    app = create_app(storage.db.settings, start_runner=False)
    with TestClient(app) as client:
        mission_id = client.get("/api/v1/missions").json()[0]["id"]
        run_id = client.post("/api/v1/simulations", json={"mission_id": mission_id}).json()["run_id"]
        for _ in range(20):
            with client.websocket_connect(f"/api/v1/simulations/{run_id}/stream") as socket:
                assert socket.receive_json()["type"] == "snapshot"
            assert not app.state.hub.subscribers
