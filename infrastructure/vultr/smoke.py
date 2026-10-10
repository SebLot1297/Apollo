#!/usr/bin/env python3
"""Authenticated vLLM checks; generation is opt-in and output never includes bodies."""

import argparse
import http.client
import ipaddress
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

MAX_RESPONSE_BYTES = 65536
MODEL = "Qwen/Qwen3.8-27B"


class SmokeFailure(Exception):
    """Only fixed local failure codes may reach the terminal."""


@dataclass(frozen=True)
class SmokeConfig:
    base_url: str
    api_key: str = field(repr=False)
    model: str = MODEL
    timeout: float = 30.0

    def __post_init__(self):
        if not self.api_key or any(not 33 <= ord(char) <= 126 for char in self.api_key):
            raise SmokeFailure("api_key_required")
        if (
            not isinstance(self.timeout, (int, float))
            or not math.isfinite(self.timeout)
            or not 0 < self.timeout <= 120
        ):
            raise SmokeFailure("timeout_invalid")
        if (
            not isinstance(self.model, str)
            or not self.model.strip()
            or len(self.model) > 256
        ):
            raise SmokeFailure("model_invalid")
        try:
            parsed = urllib.parse.urlsplit(self.base_url)
            port = parsed.port
            invalid = (
                parsed.scheme not in ("http", "https")
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.query
                or parsed.fragment
                or parsed.path.rstrip("/") != "/v1"
                or (port is not None and not 1 <= port <= 65535)
            )
            if invalid or any(
                char.isspace() or ord(char) < 32 for char in self.base_url
            ):
                raise ValueError
            if (
                parsed.scheme == "http"
                and parsed.hostname != "localhost"
                and not ipaddress.ip_address(parsed.hostname).is_loopback
            ):
                raise ValueError
        except (TypeError, ValueError):
            raise SmokeFailure("base_url_invalid") from None
        object.__setattr__(self, "base_url", self.base_url.rstrip("/"))


@dataclass(frozen=True)
class HttpReply:
    status: int
    body: bytes = field(repr=False)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _http_request(method, url, *, api_key, payload, timeout):
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    data = None
    if payload is not None:
        data = json.dumps(payload, allow_nan=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    # Avoid system proxies and never forward Authorization through a redirect.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(request, timeout=timeout) as response:
            return HttpReply(response.status, response.read(MAX_RESPONSE_BYTES + 1))
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        return HttpReply(status, b"")
    except (
        urllib.error.URLError,
        TimeoutError,
        OSError,
        http.client.HTTPException,
        ValueError,
    ):
        raise SmokeFailure("connection_failed") from None


def _strict_json(body):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError

    def finite_float(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError
        return number

    return json.loads(
        body,
        object_pairs_hook=unique_pairs,
        parse_constant=invalid_constant,
        parse_float=finite_float,
    )


def _successful_json(reply):
    if reply.status != 200:
        if reply.status in (401, 403):
            code = "auth_failed"
        elif 300 <= reply.status < 400:
            code = "redirect_rejected"
        elif reply.status == 404:
            code = "endpoint_not_found"
        elif reply.status == 429:
            code = "rate_limited"
        elif reply.status >= 500:
            code = "http_server_error"
        else:
            code = "http_status_unexpected"
        raise SmokeFailure(code)
    if len(reply.body) > MAX_RESPONSE_BYTES:
        raise SmokeFailure("response_too_large")
    try:
        parsed = _strict_json(reply.body.decode("utf-8"))
    except (UnicodeError, ValueError, RecursionError):
        raise SmokeFailure("response_invalid") from None
    if not isinstance(parsed, dict):
        raise SmokeFailure("response_invalid")
    return parsed


def _generated_content(response):
    try:
        choices = response["choices"]
        if (
            not isinstance(choices, list)
            or len(choices) != 1
            or choices[0]["finish_reason"] != "stop"
        ):
            raise ValueError
        content = choices[0]["message"]["content"]
        if not isinstance(content, str) or not content.strip() or len(content) > 8192:
            raise ValueError
        return content
    except (KeyError, TypeError, IndexError, ValueError):
        raise SmokeFailure("generation_invalid") from None


def run_checks(config, *, mode="models", allow_inference=False, request=None):
    if mode not in ("models", "text", "schema", "all"):
        raise SmokeFailure("mode_invalid")
    if mode != "models" and not allow_inference:
        raise SmokeFailure("inference_not_authorized")
    request = request or _http_request

    def send(method, path, key=config.api_key, payload=None):
        return request(
            method,
            config.base_url + path,
            api_key=key,
            payload=payload,
            timeout=config.timeout,
        )

    denied = send("GET", "/models", key="")
    if denied.status not in (401, 403):
        if 300 <= denied.status < 400:
            raise SmokeFailure("redirect_rejected")
        raise SmokeFailure("auth_not_enforced")
    models = _successful_json(send("GET", "/models"))
    data = models.get("data")
    if not isinstance(data, list) or not any(
        isinstance(item, dict) and item.get("id") == config.model for item in data
    ):
        raise SmokeFailure("model_not_listed")
    result = ["PASS auth/models (metadata only; inference not checked)"]
    for check in ("text", "schema"):
        if mode not in (check, "all"):
            continue
        payload = {
            "model": config.model,
            "messages": [
                {
                    "role": "user",
                    "content": "Reply with a short sentence confirming this test.",
                }
            ],
            "temperature": 0,
            "max_tokens": 128,
            "stream": False,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        if check == "schema":
            payload["messages"][0]["content"] = (
                'Return only this JSON object: {"status":"ok"}.'
            )
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "commandgrid_smoke",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {"status": {"type": "string", "enum": ["ok"]}},
                        "required": ["status"],
                        "additionalProperties": False,
                    },
                },
            }
        content = _generated_content(
            _successful_json(send("POST", "/chat/completions", payload=payload))
        )
        if check == "schema":
            try:
                if _strict_json(content) != {"status": "ok"}:
                    raise ValueError
            except (ValueError, RecursionError):
                raise SmokeFailure("schema_invalid") from None
        result.append("PASS " + check + " inference")
    return result


def main(argv=None, *, environ=None, request=None):
    environ = os.environ if environ is None else environ
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url", default=environ.get("QWEN_BASE_URL", "http://127.0.0.1:8001/v1")
    )
    parser.add_argument("--model", default=environ.get("QWEN_MODEL", MODEL))
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument(
        "--mode", choices=("models", "text", "schema", "all"), default="models"
    )
    parser.add_argument(
        "--allow-inference",
        action="store_true",
        help="Authorize explicit generation requests",
    )
    args = parser.parse_args(argv)
    try:
        config = SmokeConfig(
            args.base_url,
            environ.get("QWEN_API_KEY") or environ.get("VLLM_API_KEY", ""),
            args.model,
            args.timeout,
        )
        result = run_checks(
            config,
            mode=args.mode,
            allow_inference=args.allow_inference,
            request=request,
        )
    except SmokeFailure as error:
        print("FAIL " + str(error), file=sys.stderr)
        return 1
    for line in result:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
