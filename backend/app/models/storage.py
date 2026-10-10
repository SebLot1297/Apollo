from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, mapped_column

JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


def now():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class MissionRow(Base):
    __tablename__ = "missions"
    id = mapped_column(String(36), primary_key=True)
    name = mapped_column(String(160), nullable=False)
    description = mapped_column(Text, nullable=False)
    category = mapped_column(String(64), nullable=False)
    schema_version = mapped_column(Integer, nullable=False)
    configuration = mapped_column(JSON_TYPE, nullable=False)
    created_at = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at = mapped_column(DateTime(timezone=True), nullable=False)


class ObjectiveRow(Base):
    __tablename__ = "mission_objectives"
    id = mapped_column(String(36), primary_key=True)
    mission_id = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True)
    name = mapped_column(String(160), nullable=False)
    metric_key = mapped_column(String(64), nullable=False)
    operator = mapped_column(String(2), nullable=False)
    target_value = mapped_column(Float, nullable=False)
    required = mapped_column(Boolean, nullable=False)
    evaluation_mode = mapped_column(String(24), nullable=False)
    deadline_seconds = mapped_column(Float)
    description = mapped_column(Text, nullable=False)
    configuration = mapped_column(JSON_TYPE, nullable=False)
    updated_at = mapped_column(DateTime(timezone=True), nullable=False)


class RunRow(Base):
    __tablename__ = "simulation_runs"
    id = mapped_column(String(36), primary_key=True)
    mission_id = mapped_column(ForeignKey("missions.id", ondelete="SET NULL"), index=True)
    random_seed = mapped_column(Integer, nullable=False)
    status = mapped_column(String(24), nullable=False, index=True)
    active_slot = mapped_column(Integer, unique=True)
    start_time = mapped_column(DateTime(timezone=True))
    end_time = mapped_column(DateTime(timezone=True))
    simulated_duration = mapped_column(Float, nullable=False)
    configuration_snapshot = mapped_column(JSON_TYPE, nullable=False)
    final_metrics = mapped_column(JSON_TYPE, nullable=False)
    state = mapped_column(JSON_TYPE, nullable=False)
    history_count = mapped_column(Integer, nullable=False, default=0)
    event_sequence = mapped_column(Integer, nullable=False, default=0)
    created_at = mapped_column(DateTime(timezone=True), nullable=False, default=now)
    updated_at = mapped_column(DateTime(timezone=True), nullable=False, default=now)


class CommandRow(Base):
    __tablename__ = "simulation_commands"
    id = mapped_column(String(36), primary_key=True)
    run_id = mapped_column(ForeignKey("simulation_runs.id"), nullable=False)
    idempotency_key = mapped_column(String(36), nullable=False)
    command_type = mapped_column(String(64), nullable=False)
    payload = mapped_column(JSON_TYPE, nullable=False)
    result = mapped_column(JSON_TYPE, nullable=False)
    timestamp = mapped_column(DateTime(timezone=True), nullable=False, default=now)
    __table_args__ = (UniqueConstraint("run_id", "idempotency_key"),)


class ReportRow(Base):
    __tablename__ = "mission_reports"
    id = mapped_column(String(36), primary_key=True)
    run_id = mapped_column(ForeignKey("simulation_runs.id"), nullable=False, unique=True)
    success = mapped_column(Boolean, nullable=False)
    objective_results = mapped_column(JSON_TYPE, nullable=False)
    summary = mapped_column(Text, nullable=False)
    ai_analysis = mapped_column(JSON_TYPE)
    report = mapped_column(JSON_TYPE, nullable=False)
    created_at = mapped_column(DateTime(timezone=True), nullable=False, default=now)


class TelemetryRow(Base):
    __tablename__ = "telemetry_samples"
    time = mapped_column(DateTime(timezone=True), primary_key=True)
    run_id = mapped_column(String(36), primary_key=True)
    sample_index = mapped_column(Integer, primary_key=True)
    metric_key = mapped_column(String(96), primary_key=True)
    metric_value = mapped_column(Float, nullable=False)
    simulated_time_seconds = mapped_column(Float, nullable=False)
    __table_args__ = (
        Index("ix_telemetry_run_time", "run_id", "time"),
        Index("ix_telemetry_run_simulated_time", "run_id", "simulated_time_seconds"),
    )


class EventRow(Base):
    __tablename__ = "mission_events"
    time = mapped_column(DateTime(timezone=True), primary_key=True)
    run_id = mapped_column(String(36), primary_key=True)
    sequence = mapped_column(Integer, primary_key=True)
    event_type = mapped_column(String(64), nullable=False)
    severity = mapped_column(String(16), nullable=False)
    payload = mapped_column(JSON_TYPE, nullable=False)
    simulated_time_seconds = mapped_column(Float, nullable=False)
    __table_args__ = (
        Index("ix_events_run_time", "run_id", "time"),
        Index("ix_events_run_sequence", "run_id", "sequence"),
    )


class AIRequestRow(Base):
    __tablename__ = "ai_requests"
    id = mapped_column(String(36), primary_key=True)
    provider = mapped_column(String(32), nullable=False)
    model = mapped_column(String(160), nullable=False)
    task_type = mapped_column(String(64), nullable=False)
    status = mapped_column(String(24), nullable=False)
    latency_ms = mapped_column(Float, nullable=False)
    token_usage = mapped_column(JSON_TYPE, nullable=False)
    estimated_cost = mapped_column(Float)
    created_at = mapped_column(DateTime(timezone=True), nullable=False, default=now)


class SettingsRow(Base):
    __tablename__ = "application_settings"
    id = mapped_column(Integer, primary_key=True)
    value = mapped_column(JSON_TYPE, nullable=False)
