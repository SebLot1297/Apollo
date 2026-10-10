from uuid import uuid4

import pytest
from app.data.seed import demo_mission
from fastapi.testclient import TestClient
from test_repositories import storage as storage


@pytest.fixture
def client(tmp_path, storage):
    from app.main import create_app

    settings = storage.db.settings.model_copy(
        update={"gemini_api_key": "private-test-secret", "request_max_bytes": 8192}
    )
    with TestClient(create_app(settings, engine_api=False, ai_service=False, start_runner=False)) as client:
        yield client


def new_mission():
    data = demo_mission().model_dump(mode="json")
    data["id"] = str(uuid4())
    for objective in data["objectives"]:
        objective["id"] = str(uuid4())
    data["facilities"] = []
    data["support_teams"] = []
    return data


def test_health_registry_readiness_and_settings_have_no_secrets(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/ready").json()["database"]["engine"] in {"sqlite/local-demo", "postgresql/timescaledb"}
    assert "communication_uptime_percent" in client.get("/api/v1/registry").json()["metrics"]
    response = client.get("/api/v1/settings")
    assert response.status_code == 200
    assert "private-test-secret" not in response.text
    assert "gemini_api_key" not in response.text


def test_crud_and_objective_validation(client):
    data = new_mission()
    response = client.post("/api/v1/missions", json=data)
    assert response.status_code == 201
    mission_id = response.json()["id"]
    data["name"] = "Saved recovery exercise"
    assert client.put(f"/api/v1/missions/{mission_id}", json=data).status_code == 200
    assert client.get(f"/api/v1/missions/{mission_id}").json()["name"] == data["name"]
    assert client.post("/api/v1/missions", json=data).status_code == 409
    first, second = data["objectives"][:2]
    assert client.delete(f"/api/v1/objectives/{first['id']}").status_code == 204
    assert client.delete(f"/api/v1/objectives/{second['id']}").status_code == 422
    optional = data["objectives"][2]
    optional["target_value"] = 101
    assert client.put(f"/api/v1/objectives/{optional['id']}", json=optional).status_code == 422
    assert client.delete(f"/api/v1/missions/{mission_id}").status_code == 204
    assert client.get(f"/api/v1/missions/{mission_id}").status_code == 404


def test_missing_parts_are_explicit_and_input_is_validated(client):
    mission_id = client.get("/api/v1/missions").json()[0]["id"]
    assert client.post("/api/v1/simulations", json={"mission_id": mission_id}).status_code == 503
    assert client.post("/api/v1/simulations", json={"mission_id": "invalid"}).status_code == 422
    assert client.post("/api/v1/ai/generate-mission", json={"prompt": "Create support exercise"}).status_code == 503
    assert client.put("/api/v1/settings", json={"simulation_speed": -1}).status_code == 422
    assert client.get("/api/v1/reports/not-a-uuid").status_code == 422


def test_body_limit_and_settings_updates(client):
    assert client.post("/api/v1/missions", content="x" * 9000).status_code == 413
    response = client.put("/api/v1/settings", json={"simulation_speed": 75, "demo_mode": True, "ai_provider": "mock"})
    assert response.status_code == 200
    assert client.get("/api/v1/settings").json()["simulation_speed"] == 75
    assert client.put("/api/v1/settings", json={"gemini_api_key": "leak"}).status_code == 422
    assert client.put("/api/v1/settings", json={"simulation_speed": True}).status_code == 422
    assert client.post("/api/v1/simulations", json={
        "mission_id": str(uuid4()), "random_seed": 2 ** 40
    }).status_code == 422


def test_optional_module_allows_missing_parent_but_exposes_missing_dependency(monkeypatch):
    from app import main

    def missing_parent(name):
        raise ModuleNotFoundError("Optional package absent", name="app.services.ai")

    monkeypatch.setattr(main, "import_module", missing_parent)
    assert main.optional_module("app.services.ai.service") is None

    def broken_dependency(name):
        raise ModuleNotFoundError("Dependency absent", name="provider_dependency")

    monkeypatch.setattr(main, "import_module", broken_dependency)
    with pytest.raises(ModuleNotFoundError, match="Dependency absent"):
        main.optional_module("app.services.ai.service")
