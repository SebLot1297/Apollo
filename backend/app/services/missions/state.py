from typing import Annotated, Any, Literal
from uuid import UUID

from app.schemas.mission import DomainModel, Facility, MissionConfiguration, MissionObjective, Percentage, SupportTeam
from pydantic import Field

RunStatus = Literal['created', 'running', 'paused', 'completed', 'failed', 'terminated']
IncidentKind = Literal['communications_outage', 'power_failure', 'equipment_degradation']


class Incident(DomainModel):
    id: UUID
    kind: IncidentKind
    title: str
    description: str
    status: Literal['active', 'acknowledged', 'resolved'] = 'active'
    started_at_seconds: Annotated[float, Field(ge=0)]
    resolved_at_seconds: Annotated[float, Field(ge=0)] | None = None


class Event(DomainModel):
    id: UUID
    sequence: Annotated[int, Field(ge=1)]
    simulated_time_seconds: Annotated[float, Field(ge=0)]
    event_type: str
    severity: Literal['info', 'warning', 'critical', 'action']
    message: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ObjectiveResult(DomainModel):
    objective: MissionObjective
    achieved_value: float
    passed: bool = False
    status: Literal['pending', 'passed', 'failed', 'expired'] = 'pending'
    first_achieved_at_seconds: float | None = None
    reason: str = ''


class HistorySample(DomainModel):
    simulated_time_seconds: float
    metrics: dict[str, float]
    systems: dict[str, float]


class MissionState(DomainModel):
    # Durable numerical snapshot stays private at the HTTP/WebSocket boundary.
    engine_snapshot: dict[str, Any] = Field(default_factory=dict, exclude=True)
    run_id: UUID
    mission_id: UUID
    mission: MissionConfiguration
    status: RunStatus = 'created'
    recovery_mode: Literal['manual', 'automatic'] = 'manual'
    next_recovery_at_seconds: Annotated[float, Field(ge=0)] | None = None
    run_profile: Literal['standard', 'guided_demo'] = 'standard'
    elapsed_time_seconds: Annotated[float, Field(ge=0)] = 0
    random_seed: int = 42
    time_multiplier: Annotated[float, Field(gt=0, le=3600)] = 30
    sequence: Annotated[int, Field(ge=0)] = 0
    metrics: dict[str, float] = Field(default_factory=dict)
    systems: dict[str, Percentage] = Field(default_factory=dict)
    facilities: list[Facility] = Field(default_factory=list)
    support_teams: list[SupportTeam] = Field(default_factory=list)
    incidents: list[Incident] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)
    objective_results: list[ObjectiveResult] = Field(default_factory=list)
    history: list[HistorySample] = Field(default_factory=list)
    connected_time_seconds: Annotated[float, Field(ge=0)] = 0
    next_hazard_at_seconds: Annotated[float, Field(gt=0)] = 60
    next_sample_at_seconds: Annotated[float, Field(gt=0)] = 60
    hazard_index: Annotated[int, Field(ge=0)] = 0
    backup_communications_active: bool = False
    backup_power_active: bool = False
    maintained_breaches: dict[str, float] = Field(default_factory=dict)
    command_history: list[dict[str, Any]] = Field(default_factory=list)
