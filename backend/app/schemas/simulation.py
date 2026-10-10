"""Serializable run snapshot, including historical evidence and deterministic cursors."""
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field

from .mission import DomainModel, Facility, MissionConfiguration, MissionObjective, Nonnegative, Percentage, SupportTeam

RunStatus = Literal["created", "running", "paused", "completed", "failed", "terminated"]
IncidentKind = Literal["communications_outage", "power_failure", "equipment_degradation"]


class SystemState(DomainModel):
    health: Percentage
    baseline_health: Percentage
    status: Literal["operational", "degraded", "offline"]
    operational_units: Annotated[int, Field(strict=True, ge=0, le=20)] | None = None
    total_units: Annotated[int, Field(strict=True, ge=1)] | None = None


class Incident(DomainModel):
    id: UUID
    kind: IncidentKind
    title: str
    description: str
    status: Literal["active", "acknowledged", "resolved"] = "active"
    started_at_seconds: Nonnegative
    resolved_at_seconds: Nonnegative | None = None
    impact: Nonnegative
    source: Literal["scheduled", "command"] = "scheduled"


class Event(DomainModel):
    id: UUID
    type: str
    message: str
    timestamp: AwareDatetime
    elapsed_time_seconds: Nonnegative
    details: dict = Field(default_factory=dict)


class ObjectiveEvidence(DomainModel):
    breached: bool = False
    breach_at_seconds: Nonnegative | None = None
    first_achieved_at_seconds: Nonnegative | None = None


class ObjectiveResult(DomainModel):
    objective: MissionObjective
    achieved_value: Nonnegative
    passed: bool
    status: Literal["pending", "passed", "failed", "expired"]
    first_achieved_at_seconds: Nonnegative | None = None
    reason: str


class HistorySample(DomainModel):
    elapsed_time_seconds: Nonnegative
    timestamp: AwareDatetime
    sequence: Annotated[int, Field(strict=True, ge=0)]
    metrics: dict[str, float | int]
    systems: dict[str, float] = Field(default_factory=dict)


class CommandRecord(DomainModel):
    command_type: str
    source: Literal["manual", "automatic"] = "manual"
    payload: dict
    elapsed_time_seconds: Nonnegative
    timestamp: AwareDatetime
    effect: str


class MissionState(DomainModel):
    run_id: UUID
    mission_id: UUID
    mission: MissionConfiguration
    status: RunStatus = "created"
    recovery_mode: Literal["manual", "automatic"] = "manual"
    next_recovery_at_seconds: Nonnegative | None = None
    elapsed_time_seconds: Nonnegative = 0
    random_seed: Annotated[int, Field(strict=True)] = 42
    time_multiplier: Annotated[float, Field(strict=True, gt=0, allow_inf_nan=False)] = 30
    sequence: Annotated[int, Field(strict=True, ge=0)] = 0
    metrics: dict[str, float | int] = Field(default_factory=dict)
    systems: dict[str, SystemState]
    facilities: list[Facility]
    support_teams: list[SupportTeam]
    incidents: list[Incident] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)
    objective_results: list[ObjectiveResult] = Field(default_factory=list)
    history: list[HistorySample] = Field(default_factory=list)
    connected_time_seconds: Nonnegative = 0
    connected_accumulated_seconds: Nonnegative = 0
    connected_interval_start: Nonnegative = 0
    connected: bool = False
    next_incident_at: dict[str, float] = Field(default_factory=dict)
    rng_counters: dict[str, int] = Field(default_factory=dict)
    event_counter: int = 0
    incident_counter: int = 0
    resource_remaining: Percentage
    resource_anchor: Percentage
    resource_anchor_time: Nonnegative = 0
    supplies_anchor: Percentage = 0
    supplies_delivered_percent: Percentage = 0
    recovery_open: dict[str, bool] = Field(default_factory=dict)
    systems_restored_count: Annotated[int, Field(strict=True, ge=0)] = 0
    backup_communications_active: bool = False
    backup_power_active: bool = False
    objective_evidence: dict[str, ObjectiveEvidence] = Field(default_factory=dict)
    command_history: list[CommandRecord] = Field(default_factory=list)
