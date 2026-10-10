"""Speed control, paused recovery, recovery plan, guided demo and AI strategy.

These exercise the shipped Part B engine through the real API/storage boundary.
"""
import asyncio
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient


class FakeAI:
    async def status(self):
        return [
            {"provider": "mock", "model": "test-only", "configured": True, "available": True, "detail": "fixture"}
        ]

    async def execute(self, task, prompt, context=None, provider=None, demo_mode=False):
        return {
            "provider": "mock",
            "model": "test-only",
            "mock": True,
            "fallback_reason": "fixture",
            "data": {"text": "Deterministic recovery strategy fixture."},
            "usage": {},
            "latency_ms": 1,
        }

    async def aclose(self):
        pass


def make_app(tmp_path, ai_service=None):
    from app.core.config import Settings
    from app.main import create_app

    return create_app(
        Settings(database_url=f"sqlite:///{tmp_path}/demo.db", data_dir=tmp_path),
        ai_service=ai_service,
        start_runner=False,
    )


def command(client, run_id, kind, payload=None, key=None):
    return client.post(
        f"/api/v1/simulations/{run_id}/commands",
        json={"command_type": kind, "payload": payload or {}, "idempotency_key": key or str(uuid4())},
    )


def seed_run(client):
    mission_id = client.get("/api/v1/missions").json()[0]["id"]
    return client.post("/api/v1/simulations", json={"mission_id": mission_id}).json()["run_id"]


def test_set_speed_validation_and_paused_recovery(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        run_id = seed_run(client)
        command(client, run_id, "start")
        assert command(client, run_id, "set_speed", {"time_multiplier": 10}).json()["time_multiplier"] == 10
        command(client, run_id, "pause")
        # Allowed while paused and returns server-confirmed speed.
        assert command(client, run_id, "set_speed", {"time_multiplier": 60}).json()["time_multiplier"] == 60
        # Reject booleans, zero, and beyond the bound.
        assert command(client, run_id, "set_speed", {"time_multiplier": True}).status_code == 409
        assert command(client, run_id, "set_speed", {"time_multiplier": 0}).status_code == 409
        assert command(client, run_id, "set_speed", {"time_multiplier": 4000}).status_code == 409
        assert command(client, run_id, "set_speed", {}).status_code == 409
        assert command(client, run_id, "set_speed", {"time_multiplier": 30}).status_code == 200
        # Synthetic incident injection is running-only, so it is rejected while paused.
        assert command(client, run_id, "trigger_incident", {"kind": "power_failure"}).status_code == 409

        before = client.get(f"/api/v1/simulations/{run_id}").json()
        assert command(client, run_id, "activate_backup_power").status_code == 200
        assert command(client, run_id, "run_equipment_diagnostic").status_code == 200
        after = client.get(f"/api/v1/simulations/{run_id}").json()
        assert after["elapsed_time_seconds"] == before["elapsed_time_seconds"]
        assert after["backup_power_active"] is True
        assert after["systems"]["resource_level"] < before["systems"]["resource_level"]


def test_paused_recovery_resolves_incident_without_advancing_time(tmp_path):
    with TestClient(make_app(tmp_path)) as client:
        run_id = seed_run(client)
        command(client, run_id, "start")
        incident = command(client, run_id, "trigger_incident", {"kind": "power_failure"}).json()["incidents"][-1]
        command(client, run_id, "pause")
        before = client.get(f"/api/v1/simulations/{run_id}").json()
        assert command(client, run_id, "acknowledge_incident", {"incident_id": incident["id"]}).status_code == 200
        assert command(client, run_id, "activate_backup_power").status_code == 200
        restored = command(client, run_id, "restore_service", {"incident_id": incident["id"]})
        assert restored.status_code == 200
        after = client.get(f"/api/v1/simulations/{run_id}").json()
        assert after["elapsed_time_seconds"] == before["elapsed_time_seconds"]
        resolved = next(i for i in after["incidents"] if i["id"] == incident["id"])
        assert resolved["status"] == "resolved"
        assert after["systems"]["power_availability"] > before["systems"]["power_availability"]


@pytest.mark.asyncio
async def test_set_speed_settles_old_speed_once(tmp_path):
    from app.core.config import Settings
    from app.data.seed import demo_mission
    from app.db.database import Database
    from app.repositories.store import Store
    from app.services.missions.controller import Controller
    from app.services.missions.engine_adapter import EngineAdapter
    from app.simulation import engine
    from app.websocket.hub import Hub

    db = Database(Settings(database_url=f"sqlite:///{tmp_path}/speed.db", data_dir=tmp_path))
    db.migrate()
    store = Store(db)
    mission = store.save_mission(demo_mission(), create=True)
    controller = Controller(store, Hub(), EngineAdapter(engine))
    moment = [100.0]
    controller.clock = lambda: moment[0]
    controller.clock_running = True
    state = await controller.create(str(mission.id), 42, 30)
    await controller.command(str(state.run_id), "start", {}, str(uuid4()))
    moment[0] += 0.5  # 15 simulated seconds at 30x
    scaled = await controller.command(str(state.run_id), "set_speed", {"time_multiplier": 10}, str(uuid4()))
    assert scaled.elapsed_time_seconds == 15
    assert scaled.time_multiplier == 10
    moment[0] += 1.0  # 10 more seconds at 10x
    paused = await controller.command(str(state.run_id), "pause", {}, str(uuid4()))
    assert paused.elapsed_time_seconds == 25
    db.close()


def test_recovery_plan_is_read_only_and_actionable(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        run_id = client.post("/api/v1/simulations/demo").json()["run_id"]
        command(client, run_id, "start")
        client.portal.call(app.state.controller.advance, 5000)  # pause at the first incident
        before = client.get(f"/api/v1/simulations/{run_id}").json()
        assert before["status"] == "paused"
        response = client.get(f"/api/v1/simulations/{run_id}/recovery-plan")
        assert response.status_code == 200
        body = response.json()
        assert body["run_id"] == run_id
        assert body["based_on_sequence"] == before["sequence"]
        assert any(step["command_type"] == "activate_backup_communications" for step in body["steps"])
        assert all("command_type" in step and "title" in step for step in body["steps"])
        assert body["objective_outlook"]["can_finish_successfully"] is False
        after = client.get(f"/api/v1/simulations/{run_id}").json()
        assert after == before  # generating a plan never mutates the run


def test_guided_demo_pauses_at_boundaries_and_can_succeed(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        created = client.post("/api/v1/simulations/demo")
        assert created.status_code == 201
        state = created.json()
        run_id = state["run_id"]
        assert state["run_profile"] == "guided_demo"
        assert state["random_seed"] == 13337
        assert state["time_multiplier"] == 5
        assert state["status"] == "created"
        assert client.post("/api/v1/simulations/demo").status_code == 409  # one active run
        command(client, run_id, "start")

        # An accelerated tick cannot skip the first boundary.
        client.portal.call(app.state.controller.advance, 5000)
        first = client.get(f"/api/v1/simulations/{run_id}").json()
        assert first["status"] == "paused"
        assert [i["kind"] for i in first["incidents"]] == ["communications_outage"]
        assert abs(first["elapsed_time_seconds"] - 229.8) < 1.0

        command(client, run_id, "activate_backup_communications")
        command(client, run_id, "restore_service", {"incident_id": first["incidents"][0]["id"]})
        command(client, run_id, "resume")
        client.portal.call(app.state.controller.advance, 5000)
        second = client.get(f"/api/v1/simulations/{run_id}").json()
        assert second["status"] == "paused"
        assert second["incidents"][-1]["kind"] == "equipment_degradation"
        command(client, run_id, "acknowledge_incident", {"incident_id": second["incidents"][-1]["id"]})
        command(client, run_id, "run_equipment_diagnostic")
        command(client, run_id, "resume")
        client.portal.call(app.state.controller.advance, 5000)
        third = client.get(f"/api/v1/simulations/{run_id}").json()
        assert third["status"] == "paused"
        assert third["incidents"][-1]["kind"] == "power_failure"
        command(client, run_id, "acknowledge_incident", {"incident_id": third["incidents"][-1]["id"]})
        command(client, run_id, "activate_backup_power")
        command(client, run_id, "restore_service", {"incident_id": third["incidents"][-1]["id"]})
        command(client, run_id, "resume")
        client.portal.call(app.state.controller.advance, 5000)
        final = client.get(f"/api/v1/simulations/{run_id}").json()
        assert final["status"] == "completed"
        assert abs(final["elapsed_time_seconds"] - 900) < 1e-6
        assert len(final["incidents"]) == 3
        report = client.get(f"/api/v1/reports/{run_id}").json()
        assert report["success"] is True
        reset = client.post(f"/api/v1/simulations/{run_id}/reset", json={"idempotency_key": str(uuid4())}).json()
        assert reset["run_profile"] == "guided_demo"
        assert reset["time_multiplier"] == 5
        assert reset["random_seed"] == 13337


def test_guided_demo_fails_when_recovery_ignored(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        run_id = client.post("/api/v1/simulations/demo").json()["run_id"]
        command(client, run_id, "start")
        terminal = {"completed", "failed", "terminated"}
        for _ in range(6):
            client.portal.call(app.state.controller.advance, 5000)
            current = client.get(f"/api/v1/simulations/{run_id}").json()
            if current["status"] in terminal:
                break
            command(client, run_id, "resume")
        final = client.get(f"/api/v1/simulations/{run_id}").json()
        assert final["status"] in terminal
        assert abs(final["elapsed_time_seconds"] - 900) < 1e-6
        report = client.get(f"/api/v1/reports/{run_id}").json()
        assert report["success"] is False


def test_ai_recovery_strategy_uses_server_guidance(tmp_path):
    app = make_app(tmp_path, ai_service=FakeAI())
    with TestClient(app) as client:
        run_id = client.post("/api/v1/simulations/demo").json()["run_id"]
        command(client, run_id, "start")
        client.portal.call(app.state.controller.advance, 5000)
        before = client.get(f"/api/v1/simulations/{run_id}").json()
        response = client.post("/api/v1/ai/generate-recovery-strategy", json={"run_id": run_id})
        assert response.status_code == 200
        envelope = response.json()
        assert envelope["mock"] is True
        assert envelope["data"]["text"]
        after = client.get(f"/api/v1/simulations/{run_id}").json()
        assert after == before  # strategy generation never changes simulation state


def test_ai_recovery_strategy_unavailable_keeps_guidance(tmp_path):
    app = make_app(tmp_path, ai_service=False)
    with TestClient(app) as client:
        run_id = client.post("/api/v1/simulations/demo").json()["run_id"]
        command(client, run_id, "start")
        client.portal.call(app.state.controller.advance, 5000)
        assert client.post("/api/v1/ai/generate-recovery-strategy", json={"run_id": run_id}).status_code == 503
        # Deterministic guidance remains available without AI.
        assert client.get(f"/api/v1/simulations/{run_id}/recovery-plan").status_code == 200
