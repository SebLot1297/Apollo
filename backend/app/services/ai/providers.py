"""Async inference adapters. Neither adapter has access to simulator commands."""

import asyncio
import ipaddress
import json
from dataclasses import dataclass, field
from time import monotonic
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx

from .config import DEFAULT_GEMINI_MODELS, AIConfig


class ProviderError(Exception):
    """Only fixed error codes cross the provider boundary, never response bodies."""

    def __init__(self, code: str, *, retryable: bool = False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


@dataclass
class ProviderResult:
    text: str
    usage: dict[str, int] = field(default_factory=dict)
    model: str | None = None


class AIProvider(Protocol):
    name: str
    model: str
    configured: bool

    async def generate_structured(self, system: str, prompt: str, schema: dict, max_tokens: int) -> ProviderResult: ...
    async def generate_text(self, system: str, prompt: str, max_tokens: int) -> ProviderResult: ...
    async def health_check(self) -> bool: ...
    async def aclose(self) -> None: ...


def _import_genai() -> tuple[Any, Any]:
    from google import genai
    from google.genai import types

    return genai, types


def _discard(task: asyncio.Future) -> None:
    """Retrieve the outcome of an abandoned call so it never surfaces as a warning."""
    if not task.cancelled():
        task.exception()


def _safe_error(exc: Exception) -> ProviderError:
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
        return ProviderError("timeout", retryable=True)
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
    else:
        status = getattr(exc, "code", None)
    if status in {401, 403}:
        return ProviderError("authentication_failed")
    if status == 404:
        return ProviderError("model_or_endpoint_not_found")
    if status == 429:
        return ProviderError("upstream_rate_limited", retryable=True)
    if isinstance(status, int) and status >= 500:
        return ProviderError("upstream_unavailable", retryable=True)
    if isinstance(exc, httpx.TransportError):
        return ProviderError("connection_failed", retryable=True)
    return ProviderError("provider_request_failed")


def token_usage(raw: Any, *, gemini: bool = False) -> dict[str, int]:
    fields = {
        "input_tokens": "prompt_token_count" if gemini else "prompt_tokens",
        "output_tokens": "candidates_token_count" if gemini else "completion_tokens",
        "total_tokens": "total_token_count" if gemini else "total_tokens",
    }
    usage = {}
    for target, source in fields.items():
        value = raw.get(source) if isinstance(raw, dict) else getattr(raw, source, None)
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            usage[target] = value
    return usage


class GeminiProvider:
    name = "gemini"

    def __init__(self, config: AIConfig, *, client: Any = None):
        # Ordered fallback chain: the first model that answers wins, so one model
        # running out of quota does not fail the request.
        chain = [segment.strip() for segment in str(config.gemini_model).split(",")]
        self.models = [segment for segment in chain if segment] or [DEFAULT_GEMINI_MODELS.split(",")[0]]
        self.model = self.models[0]
        self.configured = bool(config.gemini_api_key)
        self._config = config
        self._client = client
        # The SDK import is synchronous, so it is done once at construction (app
        # startup) rather than inside a request, where it would block the event
        # loop and silently consume the whole inference budget.
        self._sdk: tuple[Any, Any] | None = None
        if client is None and self.configured:
            try:
                self._sdk = _import_genai()
            except Exception:
                self._sdk = None

    def _get_client(self):
        if self._client is None:
            genai, types = self._sdk or _import_genai()

            self._client = genai.Client(
                api_key=self._config.gemini_api_key,
                http_options=types.HttpOptions(
                    timeout=int(self._config.ai_timeout_seconds * 1000),
                    retry_options=types.HttpRetryOptions(attempts=1),
                ),
            )
        return self._client

    async def _generate(self, system: str, prompt: str, max_tokens: int, schema: dict | None = None) -> ProviderResult:
        """Walk the model chain so one exhausted, slow or unsupported model cannot fail the request."""
        if not self.configured:
            raise ProviderError("not_configured")
        # Stay well inside the caller's first attempt window: a chain that is cut
        # off from outside cannot report why it failed, and would look like a
        # timeout even when the real cause is an exhausted key.
        budget = self._config.ai_timeout_seconds * 0.35
        # No single model may spend more than half the budget (capped at 3s), so a
        # slow or hanging model cannot use up the turn of the models behind it.
        model_allowance = max(0.05, min(3.0, budget * 0.5))
        deadline = monotonic() + budget
        codes: list[str] = []
        for model in self.models:
            remaining = deadline - monotonic()
            if remaining <= 0:
                codes.append("timeout")
                break
            slice_seconds = min(remaining, model_allowance)
            call = asyncio.ensure_future(
                self._generate_with_model(model, system, prompt, max_tokens, schema)
            )
            done, _ = await asyncio.wait({call}, timeout=slice_seconds)
            if not done:
                # Advance without awaiting the cancel: a model that suppresses
                # cancellation must not be able to stall the rest of the chain.
                call.cancel()
                call.add_done_callback(_discard)
                codes.append("timeout")
                continue
            try:
                return call.result()
            except ProviderError as exc:
                codes.append(exc.code)
                if exc.code == "authentication_failed":
                    break
                # A rate limit applies to the key, not just one model, so once a
                # few models in a row are limited the rest will be too.
                if len(codes) >= 3 and all(code == "upstream_rate_limited" for code in codes):
                    break
        if codes and all(code == "upstream_rate_limited" for code in codes):
            raise ProviderError("upstream_rate_limited", retryable=True)
        code = codes[-1] if codes else "provider_request_failed"
        raise ProviderError(
            code, retryable=code in {"upstream_rate_limited", "timeout", "upstream_unavailable", "connection_failed"}
        )

    async def _generate_with_model(
        self, model: str, system: str, prompt: str, max_tokens: int, schema: dict | None = None
    ) -> ProviderResult:
        config: dict[str, Any] = {"system_instruction": system, "max_output_tokens": max_tokens, "temperature": 0.3}
        if schema is not None:
            config.update(response_mime_type="application/json", response_json_schema=schema)
        try:
            response = await self._get_client().aio.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )
            if any(
                str(getattr(item.finish_reason, "value", item.finish_reason)) == "MAX_TOKENS"
                for item in (getattr(response, "candidates", None) or [])
            ):
                raise ProviderError("output_token_limit")
            if not isinstance(response.text, str) or not response.text.strip():
                raise ProviderError("empty_response")
            if len(response.text) > 64000:
                raise ProviderError("response_too_large")
            return ProviderResult(
                response.text,
                token_usage(getattr(response, "usage_metadata", None), gemini=True),
                model=model,
            )
        except ProviderError:
            raise
        except Exception as exc:
            raise _safe_error(exc) from None

    async def generate_structured(self, system: str, prompt: str, schema: dict, max_tokens: int) -> ProviderResult:
        return await self._generate(system, prompt, max_tokens, schema)

    async def generate_text(self, system: str, prompt: str, max_tokens: int) -> ProviderResult:
        return await self._generate(system, prompt, max_tokens)

    async def health_check(self) -> bool:
        if not self.configured:
            return False
        try:
            await self._get_client().aio.models.get(model=self.model)
            return True
        except Exception as exc:
            raise _safe_error(exc) from None

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aio.aclose()


def valid_endpoint(url: str) -> bool:
    """Allow TLS or literal private/loopback HTTP; credentials stay in headers."""
    try:
        parsed = urlsplit(url)
        # Accessing port validates both numeric form and the legal range.
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            return False
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            return False
        if parsed.scheme == "https":
            return True
        if parsed.scheme != "http":
            return False
        if parsed.hostname in {"localhost", "host.docker.internal"}:
            return True
        address = ipaddress.ip_address(parsed.hostname)
        return (
            address.is_loopback
            or address in ipaddress.ip_network("10.0.0.0/8")
            or (
                address in ipaddress.ip_network("172.16.0.0/12")
                or address in ipaddress.ip_network("192.168.0.0/16")
                or address in ipaddress.ip_network("fc00::/7")
            )
        )
    except ValueError:
        return False


class QwenProvider:
    name = "qwen"

    def __init__(self, config: AIConfig, *, client: httpx.AsyncClient | None = None):
        self.model = config.qwen_model
        self.configured = bool(config.enable_qwen and config.qwen_api_key and valid_endpoint(config.qwen_base_url))
        self._base_url = config.qwen_base_url.rstrip("/")
        if not self._base_url.endswith("/v1"):
            self._base_url += "/v1"
        self._key = config.qwen_api_key
        self._client = client
        self._timeout = config.ai_timeout_seconds

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout, follow_redirects=False)
        return self._client

    async def _request(self, method: str, path: str, payload: dict | None = None) -> dict:
        if not self.configured:
            raise ProviderError("not_configured")
        try:
            # Bound both wire time and response size; refuse redirects carrying credentials.
            async with self._get_client().stream(
                method,
                self._base_url + path,
                json=payload,
                headers={"Authorization": f"Bearer {self._key}"},
                timeout=self._timeout,
            ) as response:
                response.raise_for_status()
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 262144:
                        raise ProviderError("response_too_large")
                data = json.loads(content)
                if not isinstance(data, dict):
                    raise ProviderError("invalid_response")
                return data
        except ProviderError:
            raise
        except Exception as exc:
            raise _safe_error(exc) from None

    async def _generate(self, system: str, prompt: str, max_tokens: int, schema: dict | None = None) -> ProviderResult:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": 0.7,
            "top_p": 0.8,
            "stream": False,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        if schema is not None:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "commandgrid_proposal",
                    "strict": True,
                    "schema": schema,
                },
            }
        data = await self._request("POST", "/chat/completions", payload)
        try:
            choice = data["choices"][0]
            if not isinstance(choice, dict) or not isinstance(choice.get("message"), dict):
                raise ProviderError("invalid_response")
            if choice.get("finish_reason") == "length":
                raise ProviderError("output_token_limit")
            text = choice["message"]["content"]
            if not isinstance(text, str) or not text.strip():
                raise ProviderError("empty_response")
            if len(text) > 64000:
                raise ProviderError("response_too_large")
            return ProviderResult(text, token_usage(data.get("usage", {})), model=self.model)
        except (KeyError, IndexError, TypeError):
            raise ProviderError("invalid_response") from None

    async def generate_structured(self, system: str, prompt: str, schema: dict, max_tokens: int) -> ProviderResult:
        return await self._generate(system, prompt, max_tokens, schema)

    async def generate_text(self, system: str, prompt: str, max_tokens: int) -> ProviderResult:
        return await self._generate(system, prompt, max_tokens)

    async def health_check(self) -> bool:
        if not self.configured:
            return False
        data = await self._request("GET", "/models")
        if not isinstance(data.get("data"), list):
            raise ProviderError("invalid_response")
        return any(isinstance(item, dict) and item.get("id") == self.model for item in data.get("data", []))

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
