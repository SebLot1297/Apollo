import asyncio
import logging
from contextlib import asynccontextmanager
from importlib import import_module

import portalocker
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.api.routes import router
from app.core.config import Settings
from app.core.errors import ConflictError, MissingError, UnavailableError
from app.core.logging import configure
from app.core.middleware import BodyLimitMiddleware
from app.data.seed import demo_mission
from app.db.database import Database
from app.repositories.store import Store
from app.services.missions.controller import Controller
from app.services.missions.engine_adapter import EngineAdapter
from app.services.reports.ai_gateway import AIGateway
from app.websocket.hub import Hub

logger = logging.getLogger("commandgrid")


def optional_module(name):
    try:
        return import_module(name)
    except ModuleNotFoundError as exc:
        if exc.name and (exc.name == name or name.startswith(f"{exc.name}.")):
            return None
        raise


def create_app(settings=None, *, engine_api=None, ai_service=None, start_runner=True):
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app):
        configure(settings.log_level)
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        process_lock = portalocker.Lock(str(settings.data_dir / "worker.lock"), timeout=0)
        try:
            process_lock.acquire()
        except portalocker.exceptions.LockException:
            raise RuntimeError("Another backend process owns this data directory; use one worker") from None
        db = Database(settings)
        controller = gateway = None
        try:
            if settings.app_env == "production" and db.engine.dialect.name != "postgresql":
                raise RuntimeError("Production requires PostgreSQL with TimescaleDB")
            await asyncio.to_thread(db.acquire_worker)
            await asyncio.to_thread(db.migrate)
            await asyncio.to_thread(db.readiness)
            store = Store(db)
            demo = demo_mission()
            if await asyncio.to_thread(store.get_mission, str(demo.id)) is None:
                await asyncio.to_thread(store.save_mission, demo, create=True)
            engine = (
                (engine_api if engine_api is not None else optional_module("app.simulation.engine"))
                if engine_api is not False
                else None
            )
            if engine is not None and engine_api is None:
                engine = EngineAdapter(engine)
            service = ai_service if ai_service is not False else None
            if ai_service is None:
                module = optional_module("app.services.ai.service")
                if module:
                    service = module.AIService(settings)
            hub = Hub()
            controller = Controller(store, hub, engine)
            preferences = {
                "ai_provider": settings.ai_primary_provider,
                "demo_mode": settings.demo_mode,
                "simulation_speed": settings.simulation_time_multiplier,
                **(await asyncio.to_thread(store.settings)),
            }
            gateway = AIGateway(store, settings, service, controller=controller)
            app.state.db, app.state.store, app.state.hub = db, store, hub
            app.state.controller, app.state.ai = controller, gateway
            app.state.preferences = preferences
            app.state.settings_lock = asyncio.Lock()
            await controller.recover()
            if start_runner:
                controller.start()
            logger.info(
                "backend_started",
                extra={
                    "engine_ready": engine is not None,
                    "ai_ready": service is not None,
                    "database_engine": db.engine.dialect.name,
                },
            )
            yield
        finally:
            try:
                if controller:
                    await controller.stop()
                if gateway:
                    await gateway.close()
            finally:
                await asyncio.to_thread(db.close)
                process_lock.release()

    app = FastAPI(title="CommandGrid", version="0.1.0", lifespan=lifespan)
    app.state.allowed_origins = {origin.strip() for origin in settings.cors_origins.split(",")}
    app.add_middleware(BodyLimitMiddleware, max_bytes=settings.request_max_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins.split(","),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )
    app.include_router(router)

    @app.exception_handler(MissingError)
    @app.exception_handler(LookupError)
    async def missing(request: Request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(ConflictError)
    @app.exception_handler(ValueError)
    async def conflict(request: Request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(UnavailableError)
    async def unavailable(request: Request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=503)

    @app.exception_handler(IntegrityError)
    async def integrity(request: Request, exc):
        return JSONResponse({"detail": "Storage constraint conflict; check IDs and active simulation"}, status_code=409)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc):
        logger.error("database_operation_failed", extra={"error_type": type(exc).__name__})
        return JSONResponse(
            {"detail": "Database operation unavailable; no uncommitted changes were published"}, status_code=503
        )

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/ready")
    async def ready():
        try:
            database = await asyncio.to_thread(app.state.db.readiness)
        except Exception:
            raise HTTPException(503, "Database readiness check failed") from None
        return {
            "status": "ready",
            "database": database,
            "simulation_engine_ready": app.state.controller.engine is not None,
            "ai_service_ready": app.state.ai.service is not None,
        }

    return app


app = create_app()
