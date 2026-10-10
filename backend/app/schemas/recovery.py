"""Typed recovery-plan response. Guidance is derived from engine state only."""
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class RecoveryStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    title: str
    explanation: str
    command_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    cost: float | None = None
    effects: dict[str, float] = Field(default_factory=dict)
    blocked_reason: str | None = None


class ObjectiveOutlookItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    metric_key: str
    operator: str
    target_value: float
    achieved_value: float
    passed: bool
    status: str
    reason: str


class ObjectiveOutlook(BaseModel):
    model_config = ConfigDict(extra="forbid")
    can_finish_successfully: bool
    note: str | None = None
    required_objectives: list[ObjectiveOutlookItem] = Field(default_factory=list)


class RecoveryPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str
    based_on_sequence: int
    profile: str
    steps: list[RecoveryStep] = Field(default_factory=list)
    objective_outlook: ObjectiveOutlook
