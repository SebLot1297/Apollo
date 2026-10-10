import asyncio
from uuid import uuid4

import pytest
from app.data.seed import demo_mission
from app.main import create_app
from app.schemas.mission import MissionConfiguration
from app.schemas.simulation import MissionState
from app.services.missions.controller import Controller
from app.services.missions.engine_adapter import EngineAdapter
from app.simulation import engine
from app.websocket.hub import Hub
from fastapi.testclient import TestClient
from test_repositories import storage as storage


def scenario(resource_level=70):
    mission = demo_mission().model_dump(mode="json")
    mission["id"] = str(uuid4())
    mission["name"] = "Automatic recovery regression"
    mission["duration_seconds"] = 600
    mission["parameters"].update(
        weather_severity=0, environmental_disruption=0, communication_reliability=100,
        equipment_reliability=75, resource_level=resource_level,
    )
    mission["objectives"] = [
        dict(id=str(uuid4()), name="Resolve one incident", metric_key="incidents_resolved",
             operator=">=", target_value=1, required=True, evaluation_mode="final"),
        dict(id=str(uuid4()), name="Repair equipment", metric_key="equipment_availability_percent",
             operator=">=", target_value=100, required=True, evaluation_mode="final"),
    ]
    return MissionConfiguration.model_validate(mission)


def running(mission, mode="automatic", speed=30):
    return engine.apply_command(
        engine.create_state(mission, recovery_mode=mode, time_multiplier=speed), "start"
    )


def send(client, run_id, command_type, payload=None, key=None):
    return client.post(f"/api/v1/simulations/{run_id}/commands", json={
        "command_type": command_type, "payload": payload or {}, "idempotency_key": key or str(uuid4()),
    })


def test_automatic_recovery_passes_the_test2_objectives_with_real_commands_and_costs():
    state = running(scenario())
    original = state.model_dump_json()
    assert engine.tick(state, 9).metrics["equipment_availability_percent"] == 75
    repaired = engine.tick(state, 10)
    assert repaired.metrics["equipment_availability_percent"] == 100
    assert repaired.resource_remaining < engine.tick(running(state.mission, "manual"), 10).resource_remaining
    finished = engine.tick(state, 600)
    assert finished.status == "completed"
    assert finished.metrics["incidents_resolved"] == 1
    assert finished.metrics["equipment_availability_percent"] == 100
    incident = finished.incidents[0]
    assert incident.resolved_at_seconds == pytest.approx(incident.started_at_seconds + 10)
    automatic = [command for command in finished.command_history if command.source == "automatic"]
    assert [command.command_type for command in automatic] == [
        "run_equipment_diagnostic", "acknowledge_incident", "restore_service",
    ]
    assert automatic[0].elapsed_time_seconds == 10
    report = engine.build_report(finished)
    assert report["success"] is True
    assert report["recovery_mode"] == "automatic"
    assert any(event["details"].get("source") == "automatic" for event in report["events"])
    assert state.model_dump_json() == original


@pytest.mark.parametrize("speed, chunk", [(1, 1), (5, 5), (30, 30), (120, 120), (3600, 600)])
def test_automatic_recovery_is_independent_of_speed_and_tick_partition(speed, chunk):
    mission = scenario()
    reference = engine.tick(running(mission, speed=1), 600)
    state = running(mission, speed=speed)
    while state.status == "running":
        state = engine.tick(state, chunk)
    assert state.status == reference.status == "completed"
    assert state.metrics == pytest.approx(reference.metrics)
    assert state.connected_time_seconds == pytest.approx(reference.connected_time_seconds)
    assert state.resource_remaining == pytest.approx(reference.resource_remaining)
    assert state.command_history == reference.command_history
    assert state.incidents == reference.incidents


def test_manual_mode_still_requires_commands_and_can_cancel_queued_automatic_recovery():
    state = running(scenario(), "manual")
    failed = engine.tick(state, 600)
    assert failed.status == "failed"
    assert failed.metrics["equipment_availability_percent"] == 75
    assert failed.metrics["incidents_resolved"] == 0
    assert not any(command.source == "automatic" for command in failed.command_history)
    automatic = engine.apply_command(state, "set_recovery_mode", {"recovery_mode": "automatic"})
    assert automatic.next_recovery_at_seconds == 10
    manual = engine.apply_command(engine.tick(automatic, 5), "set_recovery_mode", {"recovery_mode": "manual"})
    assert manual.next_recovery_at_seconds is None
    progressed = engine.tick(manual, 10)
    assert progressed.metrics["equipment_availability_percent"] == 75
    restored = engine.apply_command(progressed, "run_equipment_diagnostic")
    assert restored.metrics["equipment_availability_percent"] == 100


def test_pause_preserves_pending_recovery_and_changing_modes_while_paused_does_not_repair():
    state = engine.apply_command(engine.tick(running(scenario()), 5), "pause")
    assert engine.tick(state, 100).model_dump() == state.model_dump()
    assert state.next_recovery_at_seconds == 10
    manual = engine.apply_command(state, "set_recovery_mode", {"recovery_mode": "manual"})
    automatic = engine.apply_command(manual, "set_recovery_mode", {"recovery_mode": "automatic"})
    assert automatic.status == "paused"
    assert automatic.elapsed_time_seconds == 5
    assert automatic.metrics["equipment_availability_percent"] == 75
    assert automatic.next_recovery_at_seconds == 15
    resumed = engine.apply_command(automatic, "resume")
    assert engine.tick(resumed, 9).metrics["equipment_availability_percent"] == 75
    assert engine.tick(resumed, 10).metrics["equipment_availability_percent"] == 100


def test_resource_exhaustion_records_blocked_attempts_without_forcing_success_or_busy_retries():
    state = running(scenario(resource_level=0))
    blocked = engine.tick(state, 10)
    assert any(event.type == "automatic_recovery_blocked" for event in blocked.events)
    assert blocked.resource_remaining == 0
    assert blocked.metrics["equipment_availability_percent"] == 75
    assert blocked.next_recovery_at_seconds is None
    assert len(engine.tick(blocked, 20).events) == len(blocked.events)
    finished = engine.tick(state, 600)
    assert finished.status == "failed"
    assert finished.metrics["incidents_resolved"] == 0
    assert finished.resource_remaining == 0
    assert any("insufficient resources" in event.message for event in finished.events)


def test_automatic_recovery_handles_multiple_incidents_baseline_damage_and_unavailable_backups():
    mission = scenario()
    mission.parameters.backup_power_enabled = False
    state = running(mission)
    for kind in ("power_failure", "communications_outage", "equipment_degradation"):
        state = engine.apply_command(state, "trigger_incident", {"kind": kind})
    repaired = engine.tick(state, 10)
    assert repaired.metrics["incidents_resolved"] == 3
    assert all(system.health == 100 for system in repaired.systems.values())
    assert not repaired.backup_power_active
    assert repaired.resource_remaining < state.resource_remaining


def test_automatic_recovery_cannot_fix_incidents_after_the_mission_endpoint():
    state = running(scenario())
    state.next_incident_at = {kind: 1000.0 for kind in state.next_incident_at}
    state.next_incident_at["communications_outage"] = 599
    finished = engine.tick(state, 600)
    assert finished.status == "failed"
    assert finished.metrics["incidents_resolved"] == 0
    assert finished.next_recovery_at_seconds is None
    assert finished.incidents[0].resolved_at_seconds is None
    assert engine.tick(finished, 100).model_dump() == finished.model_dump()


def test_recovery_due_exactly_at_the_endpoint_is_applied_before_final_evaluation():
    state = running(scenario())
    state.next_incident_at = {kind: 1000.0 for kind in state.next_incident_at}
    state.next_incident_at["communications_outage"] = 590
    finished = engine.tick(state, 600)
    assert finished.status == "completed"
    assert finished.incidents[0].resolved_at_seconds == 600


@pytest.mark.parametrize("kind, backup, health", [
    ("communications_outage", "activate_backup_communications", 85),
    ("power_failure", "activate_backup_power", 90),
])
def test_automatic_backup_fallback_obeys_real_capabilities_and_resource_costs(kind, backup, health):
    mission = scenario(resource_level=4)
    mission.parameters.equipment_reliability = 100
    mission.parameters.team_count = 1
    mission.support_teams = mission.support_teams[:1]
    state = engine.apply_command(running(mission), "trigger_incident", {"kind": kind})
    repaired = engine.tick(state, 10)
    assert repaired.metrics["incidents_resolved"] == 0  # A backup does not resolve the incident.
    system = "communications" if kind == "communications_outage" else "power"
    assert repaired.systems[system].health == health
    assert any(command.command_type == backup and command.source == "automatic"
               for command in repaired.command_history)
    assert repaired.resource_remaining < state.resource_remaining
    assert any(event.type == "automatic_recovery_blocked" for event in repaired.events)


@pytest.mark.parametrize("mode", [None, True, "AUTO", "invalid", 1])
def test_invalid_modes_are_rejected_without_mutating_input(mode):
    state = engine.create_state(scenario())
    original = state.model_dump_json()
    with pytest.raises(ValueError):
        engine.apply_command(state, "set_recovery_mode", {"recovery_mode": mode})
    assert state.model_dump_json() == original


def test_old_snapshots_load_as_manual_and_terminal_modes_are_read_only():
    state = engine.create_state(scenario())
    old = state.model_dump()
    old.pop("recovery_mode")
    old.pop("next_recovery_at_seconds")
    assert MissionState.model_validate(old).recovery_mode == "manual"
    for status in ("completed", "failed", "terminated"):
        terminal = state.model_copy(update={"status": status})
        with pytest.raises(ValueError):
            engine.apply_command(terminal, "set_recovery_mode", {"recovery_mode": "automatic"})


def test_mode_command_persistence_websocket_idempotency_report_reset_and_restart(storage):
    settings = storage.db.settings
    with TestClient(create_app(settings, start_runner=False, ai_service=False)) as client:
        mission = client.post("/api/v1/missions", json=scenario().model_dump(mode="json")).json()
        run = client.post("/api/v1/simulations", json={"mission_id": mission["id"]}).json()
        run_id = run["run_id"]
        assert run["recovery_mode"] == "manual"
        for payload in ({}, {"recovery_mode": True}, {"recovery_mode": "invalid"},
                        {"recovery_mode": "automatic", "source": "automatic"}):
            assert send(client, run_id, "set_recovery_mode", payload).status_code == 422
        key = str(uuid4())
        with client.websocket_connect(f"/api/v1/simulations/{run_id}/stream") as socket:
            socket.receive_json()
            switched = send(client, run_id, "set_recovery_mode", {"recovery_mode": "automatic"}, key)
            assert switched.status_code == 200
            assert socket.receive_json()["state"]["recovery_mode"] == "automatic"
        assert send(client, run_id, "set_recovery_mode", {"recovery_mode": "automatic"}, key).json() == switched.json()
        assert send(client, run_id, "set_recovery_mode", {"recovery_mode": "manual"}, key).status_code == 409
        assert send(client, run_id, "start").status_code == 200
        assert send(client, run_id, "run_equipment_diagnostic").status_code == 409
        client.portal.call(client.app.state.controller.advance, 5)
        assert send(client, run_id, "pause").status_code == 200
    # A paused persisted run keeps its recovery timer and requires explicit resume.
    with TestClient(create_app(settings, start_runner=False, ai_service=False)) as client:
        state = client.get(f"/api/v1/simulations/{run_id}").json()
        assert state["status"] == "paused"
        assert state["recovery_mode"] == "automatic"
        assert state["next_recovery_at_seconds"] == 10
        assert send(client, run_id, "resume").status_code == 200
        client.portal.call(client.app.state.controller.advance, 595)
        report = client.get(f"/api/v1/reports/{run_id}").json()
        assert report["success"] is True
        assert any(command["source"] == "automatic" for command in report["command_history"])
        assert send(client, run_id, "set_recovery_mode", {"recovery_mode": "manual"}).status_code == 409
        reset = client.post(f"/api/v1/simulations/{run_id}/reset", json={"idempotency_key": str(uuid4())}).json()
        assert reset["status"] == "created"
        assert reset["recovery_mode"] == "automatic"
        assert client.get(f"/api/v1/reports/{run_id}").json() == report


@pytest.mark.asyncio
async def test_automatic_transitions_roll_back_and_publish_only_after_commit(storage, monkeypatch):
    mission = storage.save_mission(scenario(), create=True)
    hub = Hub()
    controller = Controller(storage, hub, EngineAdapter(engine))
    state = await controller.create(str(mission.id), 42, 30, "automatic")
    run_id = str(state.run_id)
    await controller.command(run_id, "start", {}, str(uuid4()))
    original = storage.get_run(run_id).model_dump_json()
    queue = hub.subscribe(run_id)
    persist = storage.persist_transition

    def fail(*args, **kwargs):
        raise RuntimeError("test rollback")

    monkeypatch.setattr(storage, "persist_transition", fail)
    with pytest.raises(RuntimeError, match="test rollback"):
        await controller.advance(600)
    assert storage.get_run(run_id).model_dump_json() == original
    assert storage.get_report(run_id) is None
    assert queue.empty()
    monkeypatch.setattr(storage, "persist_transition", persist)
    await controller.advance(600)
    assert storage.get_report(run_id)["success"] is True
    assert (await asyncio.wait_for(queue.get(), timeout=1))["state"]["status"] == "completed"


@pytest.mark.asyncio
async def test_guided_demo_runs_automatically_without_manual_incident_pauses(storage):
    controller = Controller(storage, Hub(), EngineAdapter(engine))
    state = await controller.create_demo()
    run_id = str(state.run_id)
    await controller.command(run_id, "set_recovery_mode", {"recovery_mode": "automatic"}, str(uuid4()))
    await controller.command(run_id, "start", {}, str(uuid4()))
    await controller.advance(900)
    assert storage.get_run(run_id).status == "completed"
    assert storage.get_report(run_id)["success"] is True
    assert storage.get_report(run_id)["final_metrics"]["incidents_resolved"] == 3
