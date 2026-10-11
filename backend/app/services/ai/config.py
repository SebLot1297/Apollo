"""Small provider configuration boundary; never serialize credentials."""

import math
import os
from dataclasses import dataclass, fields
from typing import Any

# Ordered, comma-separated Gemini fallback chain. The first model that answers wins,
# so one model's exhausted quota cannot fail the request. The order is by measured
# latency for a representative prompt (fastest responders first, hanging last), so a
# usable answer arrives before the request deadline instead of after it.
DEFAULT_GEMINI_MODELS = (
    "gemini-3.8-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-3.7-flash,"
    "gemini-3.5-flash,gemini-3.6-flash,gemini-3-flash-preview,gemini-2.5-flash,gemma-4-26b-a4b-it"
)


@dataclass(frozen=True, repr=False)
class AIConfig:
    enable_ai: bool = True
    enable_qwen: bool = False
    gemini_api_key: str = ""
    gemini_model: str = DEFAULT_GEMINI_MODELS
    qwen_base_url: str = ""
    qwen_api_key: str = ""
    qwen_model: str = "Qwen/Qwen3.8-27B"
    ai_primary_provider: str = "auto"
    ai_timeout_seconds: float = 20.0
    ai_max_output_tokens: int = 2048
    ai_max_concurrency: int = 2
    ai_requests_per_minute: int = 12
    ai_health_cache_seconds: float = 60.0
    demo_mode: bool = False

    def __post_init__(self) -> None:
        for name in ("enable_ai", "enable_qwen", "demo_mode"):
            if type(getattr(self, name)) is not bool:
                raise ValueError(f"{name} must be a boolean")
        for name in ("gemini_api_key", "qwen_api_key", "qwen_base_url"):
            if not isinstance(getattr(self, name), str):
                raise ValueError(f"{name} must be a string")
        for name in ("gemini_model", "qwen_model"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{name} must be a nonblank string")
        if len(self.qwen_model) > 160:
            raise ValueError("qwen_model must be at most 160 characters")
        chain = [segment.strip() for segment in self.gemini_model.split(",")]
        if len(chain) > 12 or any(not segment or len(segment) > 160 for segment in chain):
            raise ValueError("gemini_model must list at most 12 comma-separated models of at most 160 characters")
        for name in ("ai_max_output_tokens", "ai_max_concurrency", "ai_requests_per_minute"):
            if type(getattr(self, name)) is not int:
                raise ValueError(f"{name} must be an integer")
        if not isinstance(self.ai_primary_provider, str) or self.ai_primary_provider not in {
            "auto",
            "gemini",
            "qwen",
            "mock",
        }:
            raise ValueError("AI_PRIMARY_PROVIDER must be auto, gemini, qwen, or mock")
        for name, low, high in (
            ("ai_timeout_seconds", 0.001, 120),
            ("ai_max_output_tokens", 64, 8192),
            ("ai_max_concurrency", 1, 8),
            ("ai_requests_per_minute", 1, 120),
            ("ai_health_cache_seconds", 1, 3600),
        ):
            value = getattr(self, name)
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f"{name} must be between {low} and {high}")

    @classmethod
    def from_config(cls, config: Any = None) -> "AIConfig":
        """Accept application settings, a mapping, or environment variables."""
        if isinstance(config, cls):
            return config
        defaults = cls()
        values = {}
        for field in fields(cls):
            default = getattr(defaults, field.name)
            if config is None:
                value = os.getenv(field.name.upper(), default)
            elif isinstance(config, dict):
                value = config.get(field.name, default)
            else:
                value = getattr(config, field.name, default)
            if hasattr(value, "get_secret_value"):
                value = value.get_secret_value()
            if isinstance(default, bool) and isinstance(value, str):
                if value.lower() not in {"true", "1", "yes", "on", "false", "0", "no", "off"}:
                    raise ValueError(f"{field.name} must be a boolean")
                value = value.lower() in {"true", "1", "yes", "on"}
            elif isinstance(default, int) and not isinstance(default, bool) and isinstance(value, str):
                try:
                    value = int(value)
                except ValueError:
                    raise ValueError(f"{field.name} must be an integer") from None
            elif isinstance(default, float) and isinstance(value, str):
                try:
                    value = float(value)
                except ValueError:
                    raise ValueError(f"{field.name} must be a number") from None
            values[field.name] = value
        return cls(**values)
