"""Exercise the shipped Part B engine through Part A's actual API and storage."""
import asyncio
from uuid import uuid4

import pytest
from app.data.seed import demo_mission
from app.main import create_app
from fastapi.testclient import TestClient
from test_repositories import storage as storage


def command(client, run_id, kind, payload=None, key=None):
    response = client.post(f"/api/v1/simulations/{run_id}/commands", json={
        "command_type": kind, "payload": payload or {}, "idempotency_key": key or str(uuid4()),
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_real_engine_commands_stream_telemetry_report_reset_and_restart(storage):
    settings = storage.db.settings
    app = create_app(settings, ai_service=False, start_runner=False)
    with TestClient(app) as client:
        assert client.get("/ready").json()["simulation_engine_ready"] is True
        registry = client.get("/api/v1/registry").json()
        assert registry["metrics"]["communication_uptime_percent"]["unit"] == "%"
        assert any(c["available"] for c in registry["categories"])
        config = demo_mission().model_dump(mode="json")
        config["id"] = str(uuid4())
        config["duration_seconds"] = 60
        config["objectives"] = [{
            "id": str(uuid4()), "name": "Complete one minute", "metric_key": "elapsed_time_seconds",
            "operator": ">=", "target_value": 60, "required": True, "evaluation_mode": "final",
        }, {
            "id": str(uuid4()), "name": "Optional equipment goal", "metric_key": "equipment_availability_percent",
            "operator": ">=", "target_value": 100, "required": False, "evaluation_mode": "final",
        }]
        config["parameters"].update(weather_severity=0, environmental_disruption=0, communication_reliability=100)
        saved = client.post("/api/v1/missions", json=config)
        assert saved.status_code == 201, saved.text
        response = client.post("/api/v1/simulations", json={"mission_id": config["id"]})
        assert response.status_code == 201, response.text
        state = response.json()
        assert "engine_snapshot" not in state
        run_id = state["run_id"]
        key = str(uuid4())
        started = command(client, run_id, "start", key=key)
        assert command(client, run_id, "start", key=key) == started
        with client.websocket_connect(f"/api/v1/simulations/{run_id}/stream") as socket:
            assert socket.receive_json()["state"] == started
            client.portal.call(app.state.controller.advance, 10)
            update = socket.receive_json()
            assert update["sequence"] > started["sequence"]
            assert update["state"]["elapsed_time_seconds"] == 10
        incident = command(client, run_id, "trigger_incident", {"kind": "power_failure"})["incidents"][-1]
        command(client, run_id, "acknowledge_incident", {"incident_id": incident["id"]})
        command(client, run_id, "restore_service", {"incident_id": incident["id"]})
        paused = command(client, run_id, "pause")
        client.portal.call(app.state.controller.advance, 100)
        assert client.get(f"/api/v1/simulations/{run_id}").json() == paused
        command(client, run_id, "resume")
        client.portal.call(app.state.controller.advance, 100)
        final = client.get(f"/api/v1/simulations/{run_id}").json()
        assert final["status"] == "completed"
        assert final["elapsed_time_seconds"] == 60
        report = client.get(f"/api/v1/reports/{run_id}").json()
        assert report["success"] is True
        assert report["objective_results"][1]["passed"] is False
        assert report["final_metrics"] == final["metrics"]
        assert report["events"] == final["events"]
        assert report["telemetry"] == final["history"]
        events = client.get(f"/api/v1/simulations/{run_id}/events").json()
        assert events == final["events"]
        assert [e["sequence"] for e in events] == sorted({e["sequence"] for e in events})
        samples = client.get(f"/api/v1/simulations/{run_id}/telemetry?from_seconds=10&to_seconds=60").json()
        assert samples == [h for h in final["history"] if 10 <= h["simulated_time_seconds"] <= 60]
        assert samples[-1]["systems"]["power_availability"] == 100
        reset_key = str(uuid4())
        reset_body = {"idempotency_key": reset_key}
        reset = client.post(f"/api/v1/simulations/{run_id}/reset", json=reset_body)
        assert reset.status_code == 201, reset.text
        new_id = reset.json()["run_id"]
        assert new_id != run_id
        assert client.post(f"/api/v1/simulations/{run_id}/reset", json=reset_body).json() == reset.json()
        assert client.get(f"/api/v1/reports/{run_id}").json() == report
        command(client, new_id, "start")
        client.portal.call(app.state.controller.advance, 5)
    with TestClient(create_app(settings, ai_service=False, start_runner=False)) as client:
        state = client.get(f"/api/v1/simulations/{new_id}").json()
        assert state["status"] == "paused"
        assert state["elapsed_time_seconds"] == 5
        command(client, new_id, "resume")
        command(client, new_id, "finish")
        failed = client.get(f"/api/v1/reports/{new_id}").json()
        assert failed["success"] is False
        assert failed["status"] == "failed"
        assert failed["elapsed_time_seconds"] == 5
        assert client.get(f"/api/v1/simulations/{new_id}/events").json() == failed["events"]


def test_real_engine_terminated_run_keeps_unsuccessful_report(storage):
    with TestClient(create_app(storage.db.settings, ai_service=False, start_runner=False)) as client:
        mission_id = client.get("/api/v1/missions").json()[0]["id"]
        response = client.post("/api/v1/simulations", json={"mission_id": mission_id})
        assert response.status_code == 201, response.text
        run_id = response.json()["run_id"]
        command(client, run_id, "start")
        command(client, run_id, "terminate")
        report = client.get(f"/api/v1/reports/{run_id}").json()
        assert report["status"] == "terminated"
        assert report["success"] is False
        assert report["ai_analysis"] is None


@pytest.mark.asyncio
async def test_real_engine_background_runner_scales_wall_time_once(storage):
    from app.services.missions.controller import Controller
    from app.services.missions.engine_adapter import EngineAdapter
    from app.simulation import engine
    from app.websocket.hub import Hub

    storage.db.settings.simulation_tick_seconds = 0.01
    mission = storage.save_mission(demo_mission(), create=True)
    hub = Hub()
    controller = Controller(storage, hub, EngineAdapter(engine))
    moment = [100.0]
    controller.clock = lambda: moment[0]
    controller.start()
    try:
        state = await controller.create(str(mission.id), 42, 30)
        run_id = str(state.run_id)
        await controller.command(run_id, "start", {}, str(uuid4()))
        queue = hub.subscribe(run_id)
        moment[0] += 0.25
        update = await asyncio.wait_for(queue.get(), timeout=2)
        assert update["state"]["elapsed_time_seconds"] == 7.5
        assert storage.get_run(run_id).engine_snapshot["elapsed_time_seconds"] == 7.5
        paused = await controller.command(run_id, "pause", {}, str(uuid4()))
        moment[0] += 100
        await controller.advance(10)
        assert storage.get_run(run_id).elapsed_time_seconds == paused.elapsed_time_seconds
    finally:
        await controller.stop()
