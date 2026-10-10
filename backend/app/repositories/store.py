from contextlib import nullcontext
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import delete, insert, select

from app.models.storage import (
    AIRequestRow,
    CommandRow,
    EventRow,
    MissionRow,
    ObjectiveRow,
    ReportRow,
    RunRow,
    SettingsRow,
    TelemetryRow,
)
from app.schemas.mission import MissionConfiguration
from app.services.missions.state import MissionState

ACTIVE = {"created", "running", "paused"}
TERMINAL = {"completed", "failed", "terminated"}


def utcnow():
    return datetime.now(timezone.utc)


class Store:
    def __init__(self, db):
        self.db = db

    def list_missions(self):
        with self.db.sessions() as session:
            rows = session.scalars(select(MissionRow).order_by(MissionRow.updated_at.desc()))
            return [MissionConfiguration.model_validate(row.configuration) for row in rows]

    def get_mission(self, mission_id):
        with self.db.sessions() as session:
            row = session.get(MissionRow, str(mission_id))
            return MissionConfiguration.model_validate(row.configuration) if row else None

    def save_mission(self, mission, create=False):
        with self.db.sessions.begin() as session:
            row = session.get(MissionRow, str(mission.id))
            if create and row:
                raise ValueError("Mission ID already exists")
            if not create and not row:
                raise LookupError("Mission not found")
            data = mission.model_dump(mode="json")
            if row:
                data["created_at"] = row.configuration["created_at"]
            data["updated_at"] = utcnow().isoformat()
            mission = MissionConfiguration.model_validate(data)
            if row is None:
                row = MissionRow(id=str(mission.id))
                session.add(row)
            row.name, row.description, row.category = mission.name, mission.description, mission.category
            row.schema_version = mission.schema_version
            row.configuration = mission.model_dump(mode="json")
            row.created_at, row.updated_at = mission.created_at, mission.updated_at
            session.flush()
            session.execute(delete(ObjectiveRow).where(ObjectiveRow.mission_id == str(mission.id)))
            for objective in mission.objectives:
                session.add(
                    ObjectiveRow(
                        id=str(objective.id),
                        mission_id=str(mission.id),
                        name=objective.name,
                        metric_key=objective.metric_key,
                        operator=objective.operator,
                        target_value=objective.target_value,
                        required=objective.required,
                        evaluation_mode=objective.evaluation_mode,
                        deadline_seconds=objective.deadline_seconds,
                        description=objective.description,
                        configuration=objective.model_dump(mode="json"),
                        updated_at=mission.updated_at,
                    )
                )
        return mission

    def objective_mission(self, objective_id):
        with self.db.sessions() as session:
            row = session.get(ObjectiveRow, str(objective_id))
            return self.get_mission(row.mission_id) if row else None

    def delete_mission(self, mission_id):
        with self.db.sessions.begin() as session:
            row = session.get(MissionRow, str(mission_id))
            if row is None:
                raise LookupError("Mission not found")
            active = session.scalar(
                select(RunRow.id).where(RunRow.mission_id == str(mission_id), RunRow.active_slot == 1)
            )
            if active:
                raise ValueError("Finish or terminate the active run before deleting its mission")
            session.delete(row)

    def list_runs(self):
        with self.db.sessions() as session:
            return [
                MissionState.model_validate(row.state)
                for row in session.scalars(select(RunRow).order_by(RunRow.created_at.desc()))
            ]

    def get_run(self, run_id):
        with self.db.sessions() as session:
            row = session.get(RunRow, str(run_id))
            return MissionState.model_validate(row.state) if row else None

    def active_run(self):
        with self.db.sessions() as session:
            row = session.scalar(select(RunRow).where(RunRow.active_slot == 1))
            return MissionState.model_validate(row.state) if row else None

    def get_command(self, run_id, key):
        with self.db.sessions() as session:
            row = session.scalar(
                select(CommandRow).where(CommandRow.run_id == str(run_id), CommandRow.idempotency_key == str(key))
            )
            return dict(command_type=row.command_type, payload=row.payload, result=row.result) if row else None

    def persist_transition(self, state, command=None, report=None, _session=None):
        """State, appended events/history, accepted command and report commit together."""
        run_id = str(state.run_id)
        data = {**state.model_dump(mode="json"), "engine_snapshot": state.engine_snapshot}
        wall_time = utcnow()
        with self.db.sessions.begin() if _session is None else nullcontext(_session) as session:
            row = session.get(RunRow, run_id)
            if row is None:
                row = RunRow(id=run_id, mission_id=str(state.mission_id), history_count=0, event_sequence=0)
                session.add(row)
            old_history_count, old_sequence = row.history_count, row.event_sequence
            row.random_seed, row.status = state.random_seed, state.status
            row.active_slot = 1 if state.status in ACTIVE else None
            row.simulated_duration = state.elapsed_time_seconds
            row.configuration_snapshot = data["mission"]
            row.final_metrics = data["metrics"]
            row.state = data
            row.updated_at = wall_time
            if state.status == "running" and row.start_time is None:
                row.start_time = wall_time
            if state.status in TERMINAL and row.end_time is None:
                row.end_time = wall_time
            session.flush()
            samples = []
            for index, sample in enumerate(state.history[old_history_count:], start=old_history_count):
                for group in ("metrics", "systems"):
                    for key, value in getattr(sample, group).items():
                        samples.append(
                            dict(
                                time=wall_time,
                                run_id=run_id,
                                sample_index=index,
                                metric_key=f"{group}.{key}",
                                metric_value=value,
                                simulated_time_seconds=sample.simulated_time_seconds,
                            )
                        )
            batch = self.db.settings.telemetry_batch_size
            for offset in range(0, len(samples), batch):
                session.execute(insert(TelemetryRow), samples[offset : offset + batch])
            for event in state.events:
                if event.sequence > old_sequence:
                    session.add(
                        EventRow(
                            time=wall_time,
                            run_id=run_id,
                            sequence=event.sequence,
                            event_type=event.event_type,
                            severity=event.severity,
                            payload=event.model_dump(mode="json"),
                            simulated_time_seconds=event.simulated_time_seconds,
                        )
                    )
            row.history_count = len(state.history)
            row.event_sequence = max((event.sequence for event in state.events), default=old_sequence)
            if command:
                session.add(
                    CommandRow(
                        id=str(uuid4()),
                        run_id=run_id,
                        idempotency_key=str(command["idempotency_key"]),
                        command_type=command["command_type"],
                        payload=command.get("payload", {}),
                        result=data,
                    )
                )
            if report:
                existing = session.scalar(select(ReportRow).where(ReportRow.run_id == run_id))
                if existing is None:
                    session.add(
                        ReportRow(
                            id=str(uuid4()),
                            run_id=run_id,
                            success=report["success"],
                            objective_results=report["objective_results"],
                            summary=report["summary"],
                            ai_analysis=report.get("ai_analysis"),
                            report=report,
                        )
                    )

    def persist_reset(self, old, state, key):
        from app.services.missions.state import Event

        old = old.model_copy(deep=True)
        old.sequence += 1
        old.events.append(
            Event(
                id=uuid4(),
                sequence=old.sequence,
                simulated_time_seconds=old.elapsed_time_seconds,
                event_type="command",
                severity="action",
                message="Reset created a new run",
                payload={"new_run_id": str(state.run_id)},
            )
        )
        with self.db.sessions.begin() as session:
            self.persist_transition(old, _session=session)
            self.persist_transition(state, _session=session)
            session.add(
                CommandRow(
                    id=str(uuid4()),
                    run_id=str(old.run_id),
                    idempotency_key=str(key),
                    command_type="reset",
                    payload={},
                    result={"reset_run_id": str(state.run_id)},
                )
            )

    def events(self, run_id):
        with self.db.sessions() as session:
            return [
                row.payload
                for row in session.scalars(
                    select(EventRow).where(EventRow.run_id == str(run_id)).order_by(EventRow.sequence)
                )
            ]

    def telemetry(self, run_id, from_seconds=None, to_seconds=None):
        query = select(TelemetryRow).where(TelemetryRow.run_id == str(run_id))
        if from_seconds is not None:
            query = query.where(TelemetryRow.simulated_time_seconds >= from_seconds)
        if to_seconds is not None:
            query = query.where(TelemetryRow.simulated_time_seconds <= to_seconds)
        with self.db.sessions() as session:
            grouped = {}
            for row in session.scalars(query.order_by(TelemetryRow.sample_index)):
                sample = grouped.setdefault(
                    row.sample_index, dict(simulated_time_seconds=row.simulated_time_seconds, metrics={}, systems={})
                )
                group, key = row.metric_key.split(".", 1)
                sample[group][key] = row.metric_value
            return list(grouped.values())

    def list_reports(self):
        with self.db.sessions() as session:
            return [row.report for row in session.scalars(select(ReportRow).order_by(ReportRow.created_at.desc()))]

    def get_report(self, run_id):
        with self.db.sessions() as session:
            row = session.scalar(select(ReportRow).where(ReportRow.run_id == str(run_id)))
            return row.report if row else None

    def save_analysis(self, run_id, envelope):
        with self.db.sessions.begin() as session:
            row = session.scalar(select(ReportRow).where(ReportRow.run_id == str(run_id)))
            if not row:
                raise LookupError("Report not found")
            row.ai_analysis = envelope
            row.report = {**row.report, "ai_analysis": envelope}

    def settings(self):
        with self.db.sessions() as session:
            row = session.get(SettingsRow, 1)
            return dict(row.value) if row else {}

    def save_settings(self, value, state=None, report=None):
        with self.db.sessions.begin() as session:
            row = session.get(SettingsRow, 1)
            if row:
                row.value = dict(value)
            else:
                session.add(SettingsRow(id=1, value=dict(value)))
            if state is not None:
                self.persist_transition(state, report=report, _session=session)

    def audit_ai(self, task, envelope, status="success"):
        with self.db.sessions.begin() as session:
            session.add(
                AIRequestRow(
                    id=str(uuid4()),
                    task_type=task,
                    provider=envelope.get("provider", "unavailable"),
                    model=envelope.get("model", "unavailable"),
                    status=status,
                    latency_ms=envelope.get("latency_ms", 0),
                    token_usage=envelope.get("usage", {}),
                    estimated_cost=None,
                )
            )
