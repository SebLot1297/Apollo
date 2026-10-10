import asyncio
from uuid import UUID

import anyio
from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.api.requests import AIRequest, Command, CreateRun, KeyRequest, Preferences
from app.core.errors import MissingError
from app.schemas.mission import MissionConfiguration, MissionObjective

router = APIRouter(prefix="/api/v1")


def require(value, label):
    if value is None:
        raise MissingError(f"{label} not found")
    return value


async def stored(request, method, *args, **kwargs):
    return await asyncio.to_thread(getattr(request.app.state.store, method), *args, **kwargs)


def validate_mission(data):
    try:
        return MissionConfiguration.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(422, detail=exc.errors(include_context=False)) from None


@router.get("/missions")
async def missions(request: Request):
    return await stored(request, "list_missions")


@router.post("/missions", status_code=201)
async def save_mission(mission: MissionConfiguration, request: Request):
    return await stored(request, "save_mission", mission, create=True)


@router.get("/missions/{mission_id}")
async def mission(mission_id: UUID, request: Request):
    return require(await stored(request, "get_mission", str(mission_id)), "Mission")


@router.put("/missions/{mission_id}")
async def update_mission(mission_id: UUID, mission: MissionConfiguration, request: Request):
    if mission.id != mission_id:
        raise HTTPException(422, "Body ID must match route ID")
    return await stored(request, "save_mission", mission)


@router.delete("/missions/{mission_id}", status_code=204)
async def delete_mission(mission_id: UUID, request: Request):
    await stored(request, "delete_mission", str(mission_id))


@router.get("/missions/{mission_id}/objectives")
async def objectives(mission_id: UUID, request: Request):
    return (await mission(mission_id, request)).objectives


@router.post("/missions/{mission_id}/objectives", status_code=201)
async def add_objective(mission_id: UUID, objective: MissionObjective, request: Request):
    config = (await mission(mission_id, request)).model_dump(mode="json")
    config["objectives"].append(objective.model_dump(mode="json"))
    await stored(request, "save_mission", validate_mission(config))
    return objective


@router.put("/objectives/{objective_id}")
async def update_objective(objective_id: UUID, objective: MissionObjective, request: Request):
    if objective.id != objective_id:
        raise HTTPException(422, "Body ID must match route ID")
    config = require(await stored(request, "objective_mission", str(objective_id)), "Objective").model_dump(mode="json")
    config["objectives"] = [
        objective.model_dump(mode="json") if item["id"] == str(objective_id) else item for item in config["objectives"]
    ]
    await stored(request, "save_mission", validate_mission(config))
    return objective


@router.delete("/objectives/{objective_id}", status_code=204)
async def delete_objective(objective_id: UUID, request: Request):
    config = require(await stored(request, "objective_mission", str(objective_id)), "Objective").model_dump(mode="json")
    config["objectives"] = [item for item in config["objectives"] if item["id"] != str(objective_id)]
    await stored(request, "save_mission", validate_mission(config))


@router.get("/simulations")
async def simulations(request: Request):
    return await stored(request, "list_runs")


@router.post("/simulations", status_code=201)
async def create_run(body: CreateRun, request: Request):
    speed = body.time_multiplier or request.app.state.preferences["simulation_speed"]
    return await request.app.state.controller.create(str(body.mission_id), body.random_seed, speed)


@router.post("/simulations/demo", status_code=201)
async def demo_run(request: Request):
    # Declared before /simulations/{run_id} so "demo" is never parsed as a UUID.
    return await request.app.state.controller.create_demo()


@router.get("/simulations/{run_id}")
async def simulation(run_id: UUID, request: Request):
    return await request.app.state.controller.get(str(run_id))


@router.post("/simulations/{run_id}/commands")
async def command(run_id: UUID, body: Command, request: Request):
    return await request.app.state.controller.command(
        str(run_id), body.command_type, body.payload, str(body.idempotency_key)
    )


@router.post("/simulations/{run_id}/start")
@router.post("/simulations/{run_id}/pause")
@router.post("/simulations/{run_id}/resume")
@router.post("/simulations/{run_id}/finish")
async def shortcut(run_id: UUID, body: KeyRequest, request: Request):
    kind = request.url.path.rsplit("/", 1)[-1]
    return await request.app.state.controller.command(str(run_id), kind, {}, str(body.idempotency_key))


@router.post("/simulations/{run_id}/reset", status_code=201)
async def reset(run_id: UUID, body: KeyRequest, request: Request):
    return await request.app.state.controller.reset(str(run_id), str(body.idempotency_key))


@router.get("/simulations/{run_id}/recovery-plan")
async def recovery_plan(run_id: UUID, request: Request):
    return await request.app.state.controller.recovery_plan(str(run_id))


@router.get("/simulations/{run_id}/events")
async def events(run_id: UUID, request: Request):
    await simulation(run_id, request)
    return await stored(request, "events", str(run_id))


@router.get("/simulations/{run_id}/telemetry")
async def telemetry(
    run_id: UUID,
    request: Request,
    from_seconds: float | None = Query(default=None, ge=0, allow_inf_nan=False),
    to_seconds: float | None = Query(default=None, ge=0, allow_inf_nan=False),
):
    await simulation(run_id, request)
    if from_seconds is not None and to_seconds is not None and from_seconds > to_seconds:
        raise HTTPException(422, "from_seconds must not exceed to_seconds")
    return await stored(request, "telemetry", str(run_id), from_seconds, to_seconds)


@router.get("/reports")
async def reports(request: Request):
    return await stored(request, "list_reports")


@router.get("/reports/{run_id}")
async def report(run_id: UUID, request: Request):
    return require(await stored(request, "get_report", str(run_id)), "Report")


@router.get("/registry")
async def registry():
    from app.simulation.registry import get_registry

    definitions = get_registry()
    return {
        "metrics": {entry["key"]: entry for entry in definitions["metrics"]},
        "parameters": {entry["key"]: entry for entry in definitions["parameters"]},
        "categories": [
            {"key": entry["key"], "label": entry["name"], "available": entry["enabled"]}
            for entry in definitions["categories"]
        ],
    }


@router.get("/settings")
async def settings(request: Request):
    return {
        **request.app.state.preferences,
        "database": await asyncio.to_thread(request.app.state.db.readiness),
        "ai_status": await request.app.state.ai.status(),
    }


@router.put("/settings")
async def update_settings(body: Preferences, request: Request):
    async with request.app.state.settings_lock:
        value = {**request.app.state.preferences, **body.model_dump(exclude_none=True)}
        await stored(request, "save_settings", value)
        request.app.state.preferences = value
    return await settings(request)


@router.get("/ai/providers/status")
async def provider_status(request: Request):
    return await request.app.state.ai.status()


@router.post("/ai/{task}")
async def ai(task: str, body: AIRequest, request: Request):
    return await request.app.state.ai.execute(task.replace("-", "_"), body, request.app.state.preferences)


@router.websocket("/simulations/{run_id}/stream")
async def stream(socket: WebSocket, run_id: UUID):
    origin = socket.headers.get("origin")
    if origin and origin not in socket.app.state.allowed_origins:
        await socket.close(code=1008, reason="Browser origin not allowed")
        return
    controller = socket.app.state.controller
    await socket.accept()
    queue = None
    tasks = []
    try:
        state, queue = await controller.snapshot_subscription(str(run_id))
        await asyncio.wait_for(
            socket.send_json({"type": "snapshot", "sequence": state.sequence, "state": state.model_dump(mode="json")}),
            timeout=5,
        )
        receive = asyncio.create_task(socket.receive())
        update = asyncio.create_task(queue.get())
        tasks = [receive, update]
        while True:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            if receive in done:
                message = receive.result()
                if message["type"] == "websocket.disconnect":
                    break
                receive = asyncio.create_task(socket.receive())
                tasks = [receive, update]
            if update in done:
                await asyncio.wait_for(socket.send_json(update.result()), timeout=5)
                update = asyncio.create_task(queue.get())
            tasks = [receive, update]
    except MissingError:
        await socket.close(code=1008, reason="Simulation not found")
    except (WebSocketDisconnect, TimeoutError, RuntimeError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        if queue is not None:
            socket.app.state.hub.unsubscribe(str(run_id), queue)
        # A disconnect can cancel this scope while child tasks are being drained.
        # Shield that cleanup so cancellation cannot leak tasks or subscriptions.
        if tasks:
            with anyio.CancelScope(shield=True):
                await asyncio.gather(*tasks, return_exceptions=True)
