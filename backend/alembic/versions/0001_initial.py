"""Immutable initial schema snapshot and TimescaleDB hypertables."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import Text
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Initial schema snapshot.
    op.create_table(
        "ai_requests",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=160), nullable=False),
        sa.Column("task_type", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=False),
        sa.Column(
            "token_usage", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False
        ),
        sa.Column("estimated_cost", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "application_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("value", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "mission_events",
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column(
            "payload", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False
        ),
        sa.Column("simulated_time_seconds", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("time", "run_id", "sequence"),
    )
    op.create_index("ix_events_run_sequence", "mission_events", ["run_id", "sequence"], unique=False)
    op.create_index("ix_events_run_time", "mission_events", ["run_id", "time"], unique=False)
    op.create_table(
        "missions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column(
            "configuration", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "telemetry_samples",
        sa.Column("time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("sample_index", sa.Integer(), nullable=False),
        sa.Column("metric_key", sa.String(length=96), nullable=False),
        sa.Column("metric_value", sa.Float(), nullable=False),
        sa.Column("simulated_time_seconds", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("time", "run_id", "sample_index", "metric_key"),
    )
    op.create_index(
        "ix_telemetry_run_simulated_time", "telemetry_samples", ["run_id", "simulated_time_seconds"], unique=False
    )
    op.create_index("ix_telemetry_run_time", "telemetry_samples", ["run_id", "time"], unique=False)
    op.create_table(
        "mission_objectives",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("mission_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("metric_key", sa.String(length=64), nullable=False),
        sa.Column("operator", sa.String(length=2), nullable=False),
        sa.Column("target_value", sa.Float(), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("evaluation_mode", sa.String(length=24), nullable=False),
        sa.Column("deadline_seconds", sa.Float(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column(
            "configuration", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["mission_id"], ["missions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_mission_objectives_mission_id"), "mission_objectives", ["mission_id"], unique=False)
    op.create_table(
        "simulation_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("mission_id", sa.String(length=36), nullable=True),
        sa.Column("random_seed", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("active_slot", sa.Integer(), nullable=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("simulated_duration", sa.Float(), nullable=False),
        sa.Column(
            "configuration_snapshot",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column(
            "final_metrics", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False
        ),
        sa.Column("state", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False),
        sa.Column("history_count", sa.Integer(), nullable=False),
        sa.Column("event_sequence", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["mission_id"], ["missions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("active_slot"),
    )
    op.create_index(op.f("ix_simulation_runs_mission_id"), "simulation_runs", ["mission_id"], unique=False)
    op.create_index(op.f("ix_simulation_runs_status"), "simulation_runs", ["status"], unique=False)
    op.create_table(
        "mission_reports",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column(
            "objective_results",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"),
            nullable=False,
        ),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column(
            "ai_analysis", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=True
        ),
        sa.Column("report", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["simulation_runs.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id"),
    )
    op.create_table(
        "simulation_commands",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("idempotency_key", sa.String(length=36), nullable=False),
        sa.Column("command_type", sa.String(length=64), nullable=False),
        sa.Column(
            "payload", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False
        ),
        sa.Column("result", sa.JSON().with_variant(postgresql.JSONB(astext_type=Text()), "postgresql"), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["simulation_runs.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "idempotency_key"),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
        op.execute("SELECT create_hypertable('telemetry_samples', 'time', if_not_exists => TRUE)")
        op.execute("SELECT create_hypertable('mission_events', 'time', if_not_exists => TRUE)")


def downgrade():
    # Initial schema snapshot.
    op.drop_table("simulation_commands")
    op.drop_table("mission_reports")
    op.drop_index(op.f("ix_simulation_runs_status"), table_name="simulation_runs")
    op.drop_index(op.f("ix_simulation_runs_mission_id"), table_name="simulation_runs")
    op.drop_table("simulation_runs")
    op.drop_index(op.f("ix_mission_objectives_mission_id"), table_name="mission_objectives")
    op.drop_table("mission_objectives")
    op.drop_index("ix_telemetry_run_time", table_name="telemetry_samples")
    op.drop_index("ix_telemetry_run_simulated_time", table_name="telemetry_samples")
    op.drop_table("telemetry_samples")
    op.drop_table("missions")
    op.drop_index("ix_events_run_time", table_name="mission_events")
    op.drop_index("ix_events_run_sequence", table_name="mission_events")
    op.drop_table("mission_events")
    op.drop_table("application_settings")
    op.drop_table("ai_requests")
