import asyncio
import threading
from uuid import uuid4

import pytest
from app.data.seed import demo_mission
from app.main import create_app
from app.services.missions.controller import Controller
from app.services.missions.engine_adapter import EngineAdapter
from app.simulation import engine
from app.websocket.hub import Hub
from fastapi.testclient import TestClient
from test_repositories import storage as storage


@pytest.mark.parametrize("status", ["created", "running", "paused"])
def test_engine_speed_changes_are_immutable_and_do_not_advance_simulated_time(status):
    state = engine.create_state(demo_mission(), time_multiplier=1)
    if status != "created":
        state = engine.apply_command(state, "start")
    if status == "paused":
        state = engine.apply_command(state, "pause")
    original = state.model_dump_json()
    changed = engine.apply_command(state, "set_speed", {"time_multiplier": 2.5})
    assert changed.time_multiplier == 2.5
    assert changed.status == state.status
    assert changed.elapsed_time_seconds == state.elapsed_time_seconds
    assert changed.systems == state.systems
    assert changed.mission == state.mission
    assert changed.command_history[-1].payload == {"time_multiplier": 2.5}
    assert state.model_dump_json() == original


@pytest.mark.parametrize("payload", [
    {}, {"time_multiplier": 0}, {"time_multiplier": -1}, {"time_multiplier": True},
    {"time_multiplier": "2"}, {"time_multiplier": float("nan")}, {"time_multiplier": float("inf")},
    {"time_multiplier": 3601}, {"time_multiplier": 2, "unexpected": 1},
])
def test_invalid_speed_commands_never_change_state(payload):
    state = engine.create_state(demo_mission())
    original = state.model_dump_json()
    with pytest.raises(ValueError):
        engine.apply_command(state, "set_speed", payload)
    assert state.model_dump_json() == original


@pytest.mark.parametrize("status", ["completed", "failed", "terminated"])
def test_terminal_speeds_are_read_only(status):
    state = engine.create_state(demo_mission()).model_copy(update={"status": status})
    with pytest.raises(ValueError):
        engine.apply_command(state, "set_speed", {"time_multiplier": 2})


def send(client, run_id, kind, payload=None, key=None):
    return client.post(f"/api/v1/simulations/{run_id}/commands", json={
        "command_type": kind, "payload": payload or {}, "idempotency_key": key or str(uuid4()),
    })


def test_default_and_run_speeds_persist_across_missions_reset_and_restart(storage):
    settings = storage.db.settings
    with TestClient(create_app(settings, start_runner=False, ai_service=False)) as client:
        mission_id = client.get("/api/v1/missions").json()[0]["id"]
        run = client.post("/api/v1/simulations", json={"mission_id": mission_id, "time_multiplier": 9}).json()
        run_id = run["run_id"]
        with client.websocket_connect(f"/api/v1/simulations/{run_id}/stream") as socket:
            socket.receive_json()
            assert client.put("/api/v1/settings", json={"simulation_speed": 3}).status_code == 200
            update = socket.receive_json()["state"]
            assert update["time_multiplier"] == 3
            assert update["status"] == "created"
            assert update["sequence"] > run["sequence"]
        key = str(uuid4())
        chosen = send(client, run_id, "set_speed", {"time_multiplier": 5}, key)
        assert chosen.status_code == 200
        assert send(client, run_id, "set_speed", {"time_multiplier": 5}, key).json() == chosen.json()
        assert send(client, run_id, "set_speed", {"time_multiplier": 6}, key).status_code == 409
        assert client.get("/api/v1/settings").json()["simulation_speed"] == 3
        assert storage.get_run(run_id).engine_snapshot["time_multiplier"] == 5
        assert send(client, run_id, "start").status_code == 200
        assert send(client, run_id, "pause").status_code == 200
        assert client.put("/api/v1/settings", json={"simulation_speed": 7}).status_code == 200
        paused = client.get(f"/api/v1/simulations/{run_id}").json()
        assert paused["time_multiplier"] == 7
        assert paused["status"] == "paused"
        assert client.put("/api/v1/settings", json={"simulation_speed": 0}).status_code == 422
        assert send(client, run_id, "set_speed", {"time_multiplier": True}).status_code == 422
        assert send(client, run_id, "finish").status_code == 200
        report = client.get(f"/api/v1/reports/{run_id}").json()
        terminal = client.get(f"/api/v1/simulations/{run_id}").json()
        assert client.put("/api/v1/settings", json={"simulation_speed": 11}).status_code == 200
        assert client.get(f"/api/v1/simulations/{run_id}").json() == terminal
        assert client.get(f"/api/v1/reports/{run_id}").json() == report
        assert send(client, run_id, "set_speed", {"time_multiplier": 12}).status_code == 409
        reset = client.post(f"/api/v1/simulations/{run_id}/reset", json={"idempotency_key": str(uuid4())}).json()
        assert reset["time_multiplier"] == 11
        assert send(client, reset["run_id"], "terminate").status_code == 200
        other = demo_mission().model_dump(mode="json")
        other["id"] = str(uuid4())
        for objective in other["objectives"]:
            objective["id"] = str(uuid4())
        assert client.post("/api/v1/missions", json=other).status_code == 201
        next_run = client.post("/api/v1/simulations", json={"mission_id": other["id"]}).json()
        assert next_run["time_multiplier"] == 11
    with TestClient(create_app(settings, start_runner=False, ai_service=False)) as client:
        assert client.get("/api/v1/settings").json()["simulation_speed"] == 11
        assert client.get(f"/api/v1/simulations/{next_run['run_id']}").json()["time_multiplier"] == 11


@pytest.mark.asyncio
async def test_running_speed_changes_account_for_wall_time_at_the_previous_speed(storage):
    mission = storage.save_mission(demo_mission(), create=True)
    storage.save_settings({"simulation_speed": 1})
    controller = Controller(storage, Hub(), EngineAdapter(engine))
    moment = [0.0]
    controller.clock = lambda: moment[0]
    controller.last_tick = 0
    controller.clock_running = True
    state = await controller.create(str(mission.id), 42)
    run_id = str(state.run_id)
    await controller.command(run_id, "start", {}, str(uuid4()))
    preferences = {"simulation_speed": 1}
    moment[0] = 2
    await controller.update_preferences(preferences, {"simulation_speed": 4})
    assert storage.get_run(run_id).elapsed_time_seconds == 2
    moment[0] = 3
    changed = await controller.command(run_id, "set_speed", {"time_multiplier": 2}, str(uuid4()))
    assert changed.elapsed_time_seconds == 6
    moment[0] = 4
    await controller.command(run_id, "pause", {}, str(uuid4()))
    moment[0] = 100
    await controller.update_preferences(preferences, {"simulation_speed": 5})
    paused = storage.get_run(run_id)
    assert paused.elapsed_time_seconds == 8
    assert paused.status == "paused"
    assert paused.time_multiplier == 5


@pytest.mark.asyncio
async def test_default_and_active_speed_roll_back_together_without_broadcast(storage, monkeypatch):
    mission = storage.save_mission(demo_mission(), create=True)
    storage.save_settings({"simulation_speed": 1})
    hub = Hub()
    controller = Controller(storage, hub, EngineAdapter(engine))
    state = await controller.create(str(mission.id), 42)
    run_id = str(state.run_id)
    queue = hub.subscribe(run_id)
    original = storage.persist_transition
    preferences = {"simulation_speed": 1}

    def fail(*args, **kwargs):
        raise RuntimeError("Forced transaction failure")

    monkeypatch.setattr(storage, "persist_transition", fail)
    with pytest.raises(RuntimeError):
        await controller.update_preferences(preferences, {"simulation_speed": 4})
    assert storage.settings()["simulation_speed"] == 1
    assert preferences["simulation_speed"] == 1
    assert storage.get_run(run_id).model_dump() == state.model_dump()
    assert queue.empty()
    monkeypatch.setattr(storage, "persist_transition", original)
    await controller.update_preferences(preferences, {"simulation_speed": 4})
    assert storage.settings()["simulation_speed"] == 4
    assert queue.get_nowait()["state"]["time_multiplier"] == 4


@pytest.mark.asyncio
async def test_cancelled_default_save_still_publishes_and_updates_memory_after_commit(storage, monkeypatch):
    mission = storage.save_mission(demo_mission(), create=True)
    storage.save_settings({"simulation_speed": 1})
    hub = Hub()
    controller = Controller(storage, hub, EngineAdapter(engine))
    state = await controller.create(str(mission.id), 42)
    queue = hub.subscribe(str(state.run_id))
    started, release = threading.Event(), threading.Event()
    original = storage.save_settings

    def delayed(*args, **kwargs):
        started.set()
        assert release.wait(3)
        original(*args, **kwargs)

    monkeypatch.setattr(storage, "save_settings", delayed)
    preferences = {"simulation_speed": 1}
    task = asyncio.create_task(controller.update_preferences(preferences, {"simulation_speed": 3}))
    try:
        assert await asyncio.to_thread(started.wait, 2)
        task.cancel()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert preferences["simulation_speed"] == 3
    assert storage.settings()["simulation_speed"] == 3
    assert storage.get_run(str(state.run_id)).time_multiplier == 3
    assert queue.get_nowait()["state"]["time_multiplier"] == 3
    assert not controller.lock.locked()


@pytest.mark.asyncio
async def test_launch_waits_for_the_default_transaction_and_uses_its_committed_value(storage, monkeypatch):
    mission = storage.save_mission(demo_mission(), create=True)
    storage.save_settings({"simulation_speed": 1})
    controller = Controller(storage, Hub(), EngineAdapter(engine))
    started, release = threading.Event(), threading.Event()
    original = storage.save_settings

    def delayed(*args, **kwargs):
        started.set()
        assert release.wait(3)
        original(*args, **kwargs)

    monkeypatch.setattr(storage, "save_settings", delayed)
    task = asyncio.create_task(controller.update_preferences({"simulation_speed": 1}, {"simulation_speed": 4}))
    try:
        assert await asyncio.to_thread(started.wait, 2)
        launch = asyncio.create_task(controller.create(str(mission.id), 42))
        assert not launch.done()
    finally:
        release.set()
    await task
    state = await launch
    assert state.time_multiplier == 4
