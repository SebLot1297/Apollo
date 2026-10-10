import os
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from app.data.seed import demo_mission
from app.schemas.mission import MissionConfiguration
from app.services.missions.state import Event, HistorySample, MissionState
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError


@pytest.fixture
def storage(tmp_path):
    from app.core.config import Settings
    from app.db.database import Database
    from app.repositories.store import Store

    url = os.getenv("TEST_DATABASE_URL")
    schema = None
    admin = None
    if url:
        parsed = make_url(url)
        if not parsed.database or not parsed.database.endswith("_test"):
            pytest.fail("TEST_DATABASE_URL must target a dedicated database ending in _test")
        admin = create_engine(url)
        schema = f"test_{uuid4().hex}"
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        url = parsed.update_query_dict({"options": f"-csearch_path={schema},public"}).render_as_string(
            hide_password=False
        )
    db = Database(Settings(database_url=url or f"sqlite:///{tmp_path}/test.db", data_dir=tmp_path))
    try:
        db.migrate()
        yield Store(db)
    finally:
        db.close()
        if admin:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin.dispose()


def test_mission_roundtrip_and_edit_survive_new_store(storage):
    from app.repositories.store import Store

    mission = demo_mission()
    storage.save_mission(mission, create=True)
    data = mission.model_dump(mode="json")
    data["name"] = "Edited support exercise"
    storage.save_mission(MissionConfiguration.model_validate(data))
    loaded = Store(storage.db).get_mission(str(mission.id))
    assert loaded.name == "Edited support exercise"
    assert loaded.created_at == mission.created_at
    assert len(loaded.objectives) == 3
    storage.delete_mission(str(mission.id))
    assert storage.list_missions() == []


def test_atomic_transition_writes_normalized_history_events_command_and_report(storage):
    mission = demo_mission()
    storage.save_mission(mission, create=True)
    state = MissionState(run_id=uuid4(), mission_id=mission.id, mission=mission)
    storage.persist_transition(state)
    state.status = "completed"
    state.sequence = 2
    state.elapsed_time_seconds = 60
    state.history = [
        HistorySample(simulated_time_seconds=30, metrics={"incidents_resolved": 1}, systems={"power_availability": 60}),
        HistorySample(simulated_time_seconds=60, metrics={"incidents_resolved": 2}, systems={"power_availability": 90}),
    ]
    state.events = [
        Event(
            id=uuid4(),
            sequence=2,
            simulated_time_seconds=60,
            event_type="command",
            severity="action",
            message="Finished",
        )
    ]
    key = str(uuid4())
    command = {"idempotency_key": key, "command_type": "finish", "payload": {}}
    report = {
        "run_id": str(state.run_id),
        "success": True,
        "objective_results": [],
        "summary": "Done",
        "ai_analysis": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    storage.persist_transition(state, command=command, report=report)
    assert storage.get_run(str(state.run_id)).elapsed_time_seconds == 60
    assert storage.get_command(str(state.run_id), key)["result"]["sequence"] == 2
    assert storage.get_report(str(state.run_id))["success"] is True
    assert len(storage.events(str(state.run_id))) == 1
    samples = storage.telemetry(str(state.run_id), 40, 60)
    assert len(samples) == 1
    assert samples[0]["metrics"]["incidents_resolved"] == 2
    assert samples[0]["systems"]["power_availability"] == 90
    storage.delete_mission(str(mission.id))
    assert storage.get_run(str(state.run_id)).mission.name == mission.name


def test_failed_command_insert_rolls_back_state_and_events(storage):
    mission = demo_mission()
    storage.save_mission(mission, create=True)
    state = MissionState(run_id=uuid4(), mission_id=mission.id, mission=mission)
    command = {"idempotency_key": str(uuid4()), "command_type": "start", "payload": {}}
    storage.persist_transition(state, command=command)
    state.sequence = 9
    with pytest.raises(IntegrityError):
        storage.persist_transition(state, command=command)
    assert storage.get_run(str(state.run_id)).sequence == 0


def test_single_active_run_constraint(storage):
    mission = demo_mission()
    storage.save_mission(mission, create=True)
    storage.persist_transition(MissionState(run_id=uuid4(), mission_id=mission.id, mission=mission))
    with pytest.raises(IntegrityError):
        storage.persist_transition(MissionState(run_id=uuid4(), mission_id=mission.id, mission=mission))


def test_settings_persist(storage):
    storage.save_settings({"demo_mode": True, "simulation_speed": 90, "ai_provider": "mock"})
    assert storage.settings()["simulation_speed"] == 90


@pytest.mark.postgres
def test_real_timescale_hypertables(storage):
    if storage.db.engine.dialect.name != "postgresql":
        pytest.skip("Set TEST_DATABASE_URL for Timescale verification")
    assert storage.db.readiness()["timescale_version"]
    with storage.db.engine.connect() as connection:
        schema = connection.execute(text("SELECT current_schema()")).scalar()
        names = (
            connection.execute(
                text("SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_schema=:schema"),
                {"schema": schema},
            )
            .scalars()
            .all()
        )
    assert set(names) == {"telemetry_samples", "mission_events"}


@pytest.mark.postgres
def test_database_worker_lock(storage):
    if storage.db.engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL advisory lock check")
    from app.db.database import Database

    storage.db.acquire_worker()
    second = Database(storage.db.settings)
    try:
        with pytest.raises(RuntimeError, match="already owns"):
            second.acquire_worker()
    finally:
        second.close()
