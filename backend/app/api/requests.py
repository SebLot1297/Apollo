from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class CreateRun(RequestModel):
    mission_id: UUID
    random_seed: Annotated[StrictInt, Field(ge=-2147483648, le=2147483647)] = 42
    time_multiplier: Annotated[float, Field(strict=True, gt=0, le=3600)] | None = None


class Command(RequestModel):
    command_type: Literal[
        "start",
        "pause",
        "resume",
        "trigger_incident",
        "activate_backup_communications",
        "activate_backup_power",
        "run_equipment_diagnostic",
        "restore_service",
        "acknowledge_incident",
        "finish",
        "terminate",
    ]
    idempotency_key: UUID
    payload: dict = Field(default_factory=dict)


class KeyRequest(RequestModel):
    idempotency_key: UUID


class Preferences(RequestModel):
    ai_provider: Literal["auto", "gemini", "qwen", "mock"] | None = None
    demo_mode: StrictBool | None = None
    simulation_speed: Annotated[float, Field(strict=True, gt=0, le=3600)] | None = None


class AIRequest(RequestModel):
    prompt: Annotated[str, Field(min_length=1, max_length=8000)] | None = None
    message: Annotated[str, Field(min_length=1, max_length=8000)] | None = None
    mission_id: UUID | None = None
    run_id: UUID | None = None
    incident_id: UUID | None = None
    provider: Literal["auto", "gemini", "qwen", "mock"] | None = None
