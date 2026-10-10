"""Version-one configuration validation; no writable evaluation state."""
import math
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID, uuid4, uuid5

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.simulation.registry import METRIC_REGISTRY, OPERATORS

Percentage = Annotated[float, Field(strict=True, ge=0, le=100, allow_inf_nan=False)]
Nonnegative = Annotated[float, Field(strict=True, ge=0, allow_inf_nan=False)]
JSONScalar = str | bool | int | float | None


class DomainModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True, allow_inf_nan=False)

    @field_validator("timestamp", check_fields=False)
    @classmethod
    def timestamp_utc(cls, value):
        # Inherited by Event, HistorySample, and CommandRecord.
        return value.astimezone(timezone.utc)


class MissionParameters(DomainModel):
    weather_severity: Percentage = 50
    environmental_disruption: Percentage = 40
    team_count: Annotated[int, Field(strict=True, ge=1, le=10)] = 4
    equipment_reliability: Percentage = 75
    resource_level: Percentage = 70
    communication_reliability: Percentage = 45
    backup_power_enabled: Annotated[bool, Field(strict=True)] = True
    custom_metadata: dict[str, JSONScalar] = Field(default_factory=dict)

    @field_validator("custom_metadata", mode="before")
    @classmethod
    def inert_scalars(cls, value):
        if not isinstance(value, dict):
            raise ValueError("custom_metadata must be a string-keyed dictionary of JSON scalars")
        for key, scalar in value.items():
            if not isinstance(key, str) or type(scalar) not in (str, bool, int, float, type(None)):
                raise ValueError("custom_metadata accepts only string keys and JSON scalar values")
            if type(scalar) is float and not math.isfinite(scalar):
                raise ValueError("custom_metadata numbers must be finite")
        return value


class MissionObjective(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    name: str
    metric_key: str
    operator: Literal[">=", "<=", "=", ">", "<"] = ">="
    target_value: Nonnegative
    required: Annotated[bool, Field(strict=True)] = True
    deadline_seconds: Nonnegative | None = None
    evaluation_mode: Literal["final", "maintained", "deadline", "accumulated"] = "final"
    description: str = ""

    @field_validator("name")
    @classmethod
    def nonblank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("objective name cannot be blank")
        return value

    @model_validator(mode="after")
    def valid_metric(self):
        metric = METRIC_REGISTRY.get(self.metric_key)
        if metric is None:
            raise ValueError(f"unsupported metric_key: {self.metric_key}")
        if self.operator not in OPERATORS:
            raise ValueError("unsupported operator")
        if metric["maximum"] is not None and self.target_value > metric["maximum"]:
            raise ValueError(f"target exceeds {self.metric_key} maximum {metric['maximum']} {metric['unit']}")
        if metric["value_type"] == "integer" and not self.target_value.is_integer():
            raise ValueError("count thresholds must be integers")
        if self.evaluation_mode not in metric["supported_modes"]:
            raise ValueError(f"{self.evaluation_mode} is unavailable for {self.metric_key}")
        if self.evaluation_mode == "deadline" and self.deadline_seconds is None:
            raise ValueError("deadline mode requires deadline_seconds")
        if self.evaluation_mode != "deadline" and self.deadline_seconds is not None:
            raise ValueError("deadline_seconds is only accepted for deadline mode")
        return self


class Facility(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1)
    kind: Literal["relay", "facility", "power"]
    x: Percentage
    y: Percentage
    status: Literal["operational", "degraded", "offline"] = "operational"


class SupportTeam(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(min_length=1)
    x: Percentage
    y: Percentage
    status: Literal["available", "responding"] = "available"


class MissionConfiguration(DomainModel):
    id: UUID = Field(default_factory=uuid4)
    schema_version: Literal[1] = 1
    name: str
    description: str = ""
    category: Literal["communications_recovery"] = "communications_recovery"
    duration_seconds: Annotated[int, Field(strict=True, ge=60, le=86400)] = 21600
    parameters: MissionParameters = Field(default_factory=MissionParameters)
    objectives: list[MissionObjective]
    facilities: list[Facility] = Field(default_factory=list)
    support_teams: list[SupportTeam] = Field(default_factory=list)
    created_at: AwareDatetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: AwareDatetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @field_validator("schema_version", mode="before")
    @classmethod
    def version_one(cls, value):
        if type(value) is not int or value != 1:
            raise ValueError("schema_version must be integer 1")
        return value

    @field_validator("name")
    @classmethod
    def nonblank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("mission name cannot be blank")
        return value

    @field_validator("created_at", "updated_at")
    @classmethod
    def utc(cls, value):
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def valid_mission(self):
        if not self.objectives:
            raise ValueError("at least one objective is required")
        if not any(objective.required for objective in self.objectives):
            raise ValueError("at least one objective must be required")
        for objective in self.objectives:
            if objective.deadline_seconds is not None and objective.deadline_seconds > self.duration_seconds:
                raise ValueError("objective deadline exceeds mission duration")
        facilities = self.facilities or [
            Facility(id=uuid5(self.id, "relay"), name="North Haven Relay", kind="relay", x=25, y=35),
            Facility(id=uuid5(self.id, "facility"), name="Cedar Support Center", kind="facility", x=55, y=60),
            Facility(id=uuid5(self.id, "power"), name="Juniper Power Station", kind="power", x=75, y=30),
        ]
        teams = self.support_teams or [
            SupportTeam(id=uuid5(self.id, f"team:{index}"), name=f"Support Team {index + 1}",
                        x=10 + index * 8, y=75) for index in range(self.parameters.team_count)
        ]
        for name, items in [("objective", self.objectives), ("facility", facilities), ("support team", teams)]:
            if len({item.id for item in items}) != len(items):
                raise ValueError(f"duplicate {name} IDs")
        if len(teams) != self.parameters.team_count:
            raise ValueError("support_teams count must match parameters.team_count")
        # Avoid recursive assignment validation while populating derived defaults.
        object.__setattr__(self, "facilities", facilities)
        object.__setattr__(self, "support_teams", teams)
        return self
