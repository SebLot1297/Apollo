"""Tests runner/persistence with an injected TEST-ONLY engine; never verifies Part B."""

import asyncio
import threading
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from app.data.seed import demo_mission
from app.services.missions.state import Event, HistorySample, MissionState
from fastapi.testclient import TestClient


class TestEngine:
    __test__ = False

    @staticmethod
    def create_state(mission, random_seed=42, run_id=None, time_multiplier=30,
                     run_profile="standard", recovery_mode="manual"):
        return MissionState(
            run_id=run_id or uuid4(),
            mission_id=mission.id,
            mission=mission,
            random_seed=random_seed,
            time_multiplier=time_multiplier,
            run_profile=run_profile,
            recovery_mode=recovery_mode,
        )

    @staticmethod
    def apply_command(state, command_type, payload=None):
        state = state.model_copy(deep=True)
        transitions = {
            "start": ("created", "running"),
            "pause": ("running", "paused"),
            "resume": ("paused", "running"),
            "finish": ("running", "completed"),
            "terminate": (state.status, "terminated"),
        }
        if command_type not in transitions or state.status != transitions[command_type][0]:
            raise ValueError("Illegal transition")
        state.status = transitions[command_type][1]
        state.sequence += 1
        state.events.append(
            Event(
                id=uuid4(),
                sequence=state.sequence,
                simulated_time_seconds=state.elapsed_time_seconds,
                event_type="command",
                severity="action",
                message=command_type,
            )
        )
        return state

    @staticmethod
    def tick(state, seconds):
        state = state.model_copy(deep=True)
        if state.status == "running":
            state.elapsed_time_seconds += seconds
            state.sequence += 1
            state.metrics = {"elapsed_time_seconds": state.elapsed_time_seconds}
            state.history.append(
                HistorySample(simulated_time_seconds=state.elapsed_time_seconds, metrics=state.metrics, systems={})
            )
        return state

    @staticmethod
    def build_report(state):
        return {
            "run_id": str(state.run_id),
            "mission": state.mission.model_dump(mode="json"),
            "success": False,
            "status": state.status,
            "elapsed_time_seconds": state.elapsed_time_seconds,
            "final_metrics": state.metrics,
            "objective_results": [],
            "events": [e.model_dump(mode="json") for e in state.events],
            "command_history": [],
            "telemetry": [h.model_dump(mode="json") for h in state.history],
            "summary": "Test fixture result",
            "ai_analysis": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }


def app_for(tmp_path, ai_service=None):
    from app.core.config import Settings
    from app.main import create_app

    return create_app(
        Settings(database_url=f"sqlite:///{tmp_path}/test.db", data_dir=tmp_path),
        engine_api=TestEngine,
        ai_service=ai_service,
        start_runner=False,
    )


def send(client, run_id, command, key=None):
    return client.post(
        f"/api/v1/simulations/{run_id}/commands", json={"command_type": command, "idempotency_key": key or str(uuid4())}
    )


def test_idempotency_conflict_snapshot_report_and_reset(tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        mission_id = client.get("/api/v1/missions").json()[0]["id"]
        state = client.post("/api/v1/simulations", json={"mission_id": mission_id}).json()
        run_id = state["run_id"]
        assert client.post("/api/v1/simulations", json={"mission_id": mission_id}).status_code == 409
        key = str(uuid4())
        started = send(client, run_id, "start", key)
        assert started.status_code == 200
        assert send(client, run_id, "start", key).json() == started.json()
        assert send(client, run_id, "pause", key).status_code == 409
        with client.websocket_connect(f"/api/v1/simulations/{run_id}/stream") as socket:
            snapshot = socket.receive_json()
            assert snapshot["type"] == "snapshot"
            assert snapshot["sequence"] == started.json()["sequence"]
            completed = send(client, run_id, "finish")
            assert completed.status_code == 200
            assert socket.receive_json()["type"] == "completion"
        assert client.get(f"/api/v1/reports/{run_id}").json()["success"] is False
        assert len(client.get(f"/api/v1/simulations/{run_id}/events").json()) == 2
        reset_key = str(uuid4())
        reset = client.post(f"/api/v1/simulations/{run_id}/reset", json={"idempotency_key": reset_key})
        assert reset.status_code == 201
        assert reset.json()["run_id"] != run_id
        assert (
            client.post(f"/api/v1/simulations/{run_id}/reset", json={"idempotency_key": reset_key}).json()
            == reset.json()
        )
    with TestClient(app_for(tmp_path)) as restarted:
        assert restarted.get(f"/api/v1/reports/{run_id}").status_code == 200
        assert restarted.get("/api/v1/missions").json()[0]["id"] == mission_id


def test_shutdown_pauses_running_run_and_restart_preserves_clock(tmp_path):
    with TestClient(app_for(tmp_path)) as client:
        mission_id = client.get("/api/v1/missions").json()[0]["id"]
        run_id = client.post("/api/v1/simulations", json={"mission_id": mission_id}).json()["run_id"]
        send(client, run_id, "start")
    with TestClient(app_for(tmp_path)) as client:
        state = client.get(f"/api/v1/simulations/{run_id}").json()
        assert state["status"] == "paused"
        assert state["elapsed_time_seconds"] == 0
        assert send(client, run_id, "resume").status_code == 200


def test_websocket_rejects_untrusted_browser_origin(tmp_path):
    from starlette.websockets import WebSocketDisconnect

    with TestClient(app_for(tmp_path)) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                f"/api/v1/simulations/{uuid4()}/stream", headers={"origin": "https://untrusted.example"}
            ):
                pass


@pytest.mark.asyncio
async def test_transaction_failure_does_not_broadcast_and_paused_time_stops(tmp_path, monkeypatch):
    from app.core.config import Settings
    from app.db.database import Database
    from app.repositories.store import Store
    from app.services.missions.controller import Controller
    from app.websocket.hub import Hub

    db = Database(Settings(database_url=f"sqlite:///{tmp_path}/direct.db", data_dir=tmp_path))
    db.migrate()
    store = Store(db)
    mission = store.save_mission(demo_mission(), create=True)
    hub = Hub()
    controller = Controller(store, hub, TestEngine)
    state = await controller.create(str(mission.id), 42, 30)
    await controller.command(str(state.run_id), "start", {}, str(uuid4()))
    queue = hub.subscribe(str(state.run_id))

    def fail(*args, **kwargs):
        raise RuntimeError("Storage failed")

    with monkeypatch.context() as patch:
        patch.setattr(store, "persist_transition", fail)
        with pytest.raises(RuntimeError):
            await controller.command(str(state.run_id), "pause", {}, str(uuid4()))
        assert queue.empty()
        assert store.get_run(str(state.run_id)).status == "running"
    await controller.advance(5)
    assert store.get_run(str(state.run_id)).elapsed_time_seconds == 5
    await controller.command(str(state.run_id), "pause", {}, str(uuid4()))
    before = store.get_run(str(state.run_id)).elapsed_time_seconds
    await controller.advance(30)
    assert store.get_run(str(state.run_id)).elapsed_time_seconds == before
    hub.unsubscribe(str(state.run_id), queue)
    db.close()


class TestAI:
    async def status(self):
        return [{"provider": "mock", "model": "test-only", "configured": True, "available": True, "detail": "fixture"}]

    async def execute(self, task, prompt, context=None, provider=None, demo_mode=False):
        return {
            "provider": "mock",
            "model": "test-only",
            "mock": True,
            "fallback_reason": "test",
            "data": {"text": "Test narrative"},
            "usage": {},
            "latency_ms": 1,
        }

    async def aclose(self):
        pass


def test_ai_narrative_preserves_trusted_report(tmp_path):
    with TestClient(app_for(tmp_path, TestAI())) as client:
        mission_id = client.get("/api/v1/missions").json()[0]["id"]
        run_id = client.post("/api/v1/simulations", json={"mission_id": mission_id}).json()["run_id"]
        send(client, run_id, "start")
        send(client, run_id, "finish")
        before = client.get(f"/api/v1/reports/{run_id}").json()
        response = client.post("/api/v1/ai/generate-report", json={"run_id": run_id})
        assert response.status_code == 200
        after = client.get(f"/api/v1/reports/{run_id}").json()
        assert after["success"] == before["success"]
        assert after["final_metrics"] == before["final_metrics"]
        assert after["ai_analysis"]["mock"] is True


def test_invalid_ai_proposal_is_rejected_without_autosave(tmp_path):
    with TestClient(app_for(tmp_path, TestAI())) as client:
        before = client.get("/api/v1/missions").json()
        response = client.post("/api/v1/ai/generate-mission", json={"prompt": "Generate recovery mission"})
        assert response.status_code == 503
        assert client.get("/api/v1/missions").json() == before


def test_ai_rate_limit_counts_failed_requests(tmp_path):
    with TestClient(app_for(tmp_path, TestAI())) as client:
        client.app.state.ai.config.ai_requests_per_minute = 1
        first = client.post("/api/v1/ai/generate-mission", json={"prompt": "Generate recovery mission"})
        second = client.post("/api/v1/ai/generate-mission", json={"prompt": "Generate recovery mission"})
        assert first.status_code == 503
        assert second.status_code == 429
        assert second.headers["retry-after"] == "60"


@pytest.mark.asyncio
async def test_monotonic_clock_settles_at_pause_without_double_advance(tmp_path):
    from app.core.config import Settings
    from app.db.database import Database
    from app.repositories.store import Store
    from app.services.missions.controller import Controller
    from app.websocket.hub import Hub

    db = Database(Settings(database_url=f"sqlite:///{tmp_path}/clock.db", data_dir=tmp_path))
    db.migrate()
    store = Store(db)
    mission = store.save_mission(demo_mission(), create=True)
    controller = Controller(store, Hub(), TestEngine)
    moment = [100.0]
    controller.clock = lambda: moment[0]
    controller.clock_running = True
    state = await controller.create(str(mission.id), 42, 30)
    await controller.command(str(state.run_id), "start", {}, str(uuid4()))
    moment[0] += 0.5
    paused = await controller.command(str(state.run_id), "pause", {}, str(uuid4()))
    assert paused.elapsed_time_seconds == 15
    moment[0] += 100
    resumed = await controller.command(str(state.run_id), "resume", {}, str(uuid4()))
    assert resumed.elapsed_time_seconds == 15
    key = str(uuid4())
    moment[0] += 1
    results = await asyncio.gather(
        controller.command(str(state.run_id), "pause", {}, key),
        controller.command(str(state.run_id), "pause", {}, key),
    )
    assert results[0].model_dump() == results[1].model_dump()
    assert results[0].elapsed_time_seconds == 45
    assert len(store.events(str(state.run_id))) == 4
    db.close()


@pytest.mark.asyncio
async def test_background_runner_recovers_after_transient_storage_failure(tmp_path, monkeypatch):
    from app.core.config import Settings
    from app.db.database import Database
    from app.repositories.store import Store
    from app.services.missions.controller import Controller
    from app.websocket.hub import Hub

    db = Database(
        Settings(database_url=f"sqlite:///{tmp_path}/retry.db", data_dir=tmp_path, simulation_tick_seconds=0.01)
    )
    db.migrate()
    store = Store(db)
    mission = store.save_mission(demo_mission(), create=True)
    hub = Hub()
    controller = Controller(store, hub, TestEngine)
    state = await controller.create(str(mission.id), 42, 30)
    await controller.command(str(state.run_id), "start", {}, str(uuid4()))
    queue = hub.subscribe(str(state.run_id))
    original = store.persist_transition
    attempts = [0]

    def temporary_failure(*args, **kwargs):
        attempts[0] += 1
        if attempts[0] <= 2:
            raise RuntimeError("Temporary storage outage")
        return original(*args, **kwargs)

    monkeypatch.setattr(store, "persist_transition", temporary_failure)
    controller.start()
    try:
        update = await asyncio.wait_for(queue.get(), timeout=1)
        assert update["state"]["status"] == "paused"
        assert update["state"]["elapsed_time_seconds"] == 0
        assert not controller.task.done()
    finally:
        await controller.stop()
        db.close()


@pytest.mark.asyncio
async def test_cancelled_command_waits_for_commit_then_broadcasts(tmp_path, monkeypatch):
    from app.core.config import Settings
    from app.db.database import Database
    from app.repositories.store import Store
    from app.services.missions.controller import Controller
    from app.websocket.hub import Hub

    db = Database(Settings(database_url=f"sqlite:///{tmp_path}/cancel.db", data_dir=tmp_path))
    db.migrate()
    store = Store(db)
    mission = store.save_mission(demo_mission(), create=True)
    hub = Hub()
    controller = Controller(store, hub, TestEngine)
    state = await controller.create(str(mission.id), 42, 30)
    await controller.command(str(state.run_id), "start", {}, str(uuid4()))
    queue = hub.subscribe(str(state.run_id))
    entered, release = threading.Event(), threading.Event()
    original = store.persist_transition

    def blocked_write(*args, **kwargs):
        entered.set()
        release.wait(timeout=3)
        return original(*args, **kwargs)

    monkeypatch.setattr(store, "persist_transition", blocked_write)
    task = asyncio.create_task(controller.command(str(state.run_id), "pause", {}, str(uuid4())))
    assert await asyncio.to_thread(entered.wait, 1)
    task.cancel()
    try:
        done, _ = await asyncio.wait({task}, timeout=0.02)
        assert not done
        assert controller.lock.locked()
    finally:
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert store.get_run(str(state.run_id)).status == "paused"
    assert (await asyncio.wait_for(queue.get(), timeout=1))["state"]["status"] == "paused"
    db.close()
