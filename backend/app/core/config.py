from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.services.ai.config import DEFAULT_GEMINI_MODELS

BACKEND = Path(__file__).resolve().parents[2]
REPO = BACKEND.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO / ".env", extra="ignore")
    database_url: str = Field(default=f"sqlite:///{(BACKEND / 'data/commandgrid.db').as_posix()}", repr=False)
    data_dir: Path = BACKEND / "data"
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173"
    simulation_tick_seconds: float = Field(default=1, gt=0, le=10)
    simulation_time_multiplier: float = Field(default=30, gt=0, le=3600)
    telemetry_batch_size: int = Field(default=1000, ge=1, le=10000)
    request_max_bytes: int = Field(default=262144, ge=1024, le=1048576)
    enable_ai: bool = True
    enable_qwen: bool = False
    gemini_api_key: str = Field(default="", repr=False)
    gemini_model: str = DEFAULT_GEMINI_MODELS
    qwen_base_url: str = "http://127.0.0.1:8001/v1"
    qwen_api_key: str = Field(default="", repr=False)
    qwen_model: str = "Qwen/Qwen3.8-27B"
    ai_primary_provider: Literal["auto", "gemini", "qwen", "mock"] = "auto"
    ai_timeout_seconds: float = Field(default=20, gt=0, le=120)
    ai_max_output_tokens: int = Field(default=2048, ge=64, le=8192)
    ai_max_concurrency: int = Field(default=2, ge=1, le=8)
    ai_requests_per_minute: int = Field(default=12, ge=1, le=120)
    ai_health_cache_seconds: float = Field(default=60, ge=1, le=3600)
    demo_mode: bool = False
    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    @property
    def sqlalchemy_url(self):
        if self.database_url.startswith("postgres://"):
            return self.database_url.replace("postgres://", "postgresql+psycopg://", 1)
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.database_url
