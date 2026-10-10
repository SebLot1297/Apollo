import asyncio
import logging
import time
from uuid import uuid4

from app.core.errors import ConflictError, MissingError, UnavailableError
from app.repositories.store import TERMINAL
from app.services.missions.demo import (
    GUIDED_DEMO_SEED,
    guided_demo_mission,
)
from app.services.missions.state import Event

logger = logging.getLogger("commandgrid.runner")


class Controller:
    """Single-process runner. Persistence commits before clients see a transition."""

    def __init__(self, store, hub, engine_api=None):
        self.store, self.hub, self.engine = store, hub, engine_api
        self.lock = asyncio.Lock()
        self.task = None
        self.clock = time.monotonic
        self.clock_running = False
        self.recovery_pending = False
        self.last_tick = self.clock()

    def require_engine(self):
        if self.engine is None:
            raise UnavailableError("Part B simulation engine is not installed yet; mission editing is available")

    def _guided_exit(self, state, seconds):
        """Clamp a running guided-demo tick to the next incident boundary.

        Returns (seconds, hit_boundary). Boundaries are read from the private
        native snapshot so they cannot be skipped even at high speed.
        """
        if (state.run_profile != "guided_demo" or state.recovery_mode == "automatic"
                or state.status != "running" or seconds <= 0):
            return seconds, False
        boundaries = (state.engine_snapshot or {}).get("next_incident_at") or {}
        elapsed = state.elapsed_time_seconds
        upcoming = [value for value in boundaries.values() if value > elapsed]
        if not upcoming:
            return seconds, False
        boundary = min(upcoming)
        if elapsed + seconds < boundary:
            return seconds, False
        return boundary - elapsed, True

    def _guided_tick(self, state, seconds):
        """Tick one step; when a guided boundary is reached, record it and auto-pause."""
        seconds, boundary_hit = self._guided_exit(state, seconds)
        updated = self.engine.tick(state, seconds)
        if boundary_hit:
            updated = self.engine.apply_command(updated, "pause", {})
        return updated, boundary_hit

    async def _store(self, method, *args, **kwargs):
        operation = asyncio.create_task(asyncio.to_thread(getattr(self.store, method), *args, **kwargs))
        try:
            return await asyncio.shield(operation)
        except asyncio.CancelledError:
            # Threaded transactions cannot be cancelled. Hold the controller lock
            # until commit/rollback finishes, including during server shutdown.
            await operation
            raise

    async def get(self, run_id):
        state = await self._store("get_run", run_id)
        if state is None:
            raise MissingError("Simulation not found")
        return state

    async def create(self, mission_id, seed, speed=None, recovery_mode="manual"):
        self.require_engine()
        async with self.lock:
            if await self._store("active_run"):
                raise ConflictError("An active simulation already exists")
            mission = await self._store("get_mission", mission_id)
            if mission is None:
                raise MissingError("Mission not found")
            if speed is None:
                speed = (await self._store("settings")).get(
                    "simulation_speed", self.store.db.settings.simulation_time_multiplier
                )
            state = self.engine.create_state(
                mission, random_seed=seed, time_multiplier=speed, recovery_mode=recovery_mode
            )
            await self._commit(state)
            return state

    async def update_preferences(self, preferences, changes):
        """Persist the global default and active run together, under the runner lock."""
        async with self.lock:
            value = {**preferences, **changes}
            state = report = None
            current = self.clock()
            if "simulation_speed" in changes:
                state = await self._store("active_run")
                if state is not None:
                    self.require_engine()
                    if self.clock_running and state.status == "running" and current > self.last_tick:
                        state = self._guided_tick(state, (current - self.last_tick) * state.time_multiplier)[0]
                    if state.status not in TERMINAL and state.time_multiplier != value["simulation_speed"]:
                        state = self.engine.apply_command(
                            state, "set_speed", {"time_multiplier": value["simulation_speed"]}
                        )
                    if state.status in TERMINAL:
                        report = self.engine.build_report(state)

            def committed():
                preferences.update(value)
                if state is not None:
                    self.last_tick = current
                    self.hub.publish(state)

            try:
                await self._store("save_settings", value, state=state, report=report)
            except asyncio.CancelledError:
                committed()
                raise
            committed()
            return value

    async def create_demo(self):
        """Create a stopped guided-demo run from the canonical mission snapshot."""
        self.require_engine()
        async with self.lock:
            if await self._store("active_run"):
                raise ConflictError("An active simulation already exists")
            mission = guided_demo_mission()
            if await self._store("get_mission", str(mission.id)) is None:
                await self._store("save_mission", mission, create=True)
            state = self.engine.create_state(
                mission,
                random_seed=GUIDED_DEMO_SEED,
                time_multiplier=(await self._store("settings")).get(
                    "simulation_speed", self.store.db.settings.simulation_time_multiplier
                ),
                run_profile="guided_demo",
            )
            await self._commit(state)
            return state

    async def _commit(self, state, command=None):
        report = self.engine.build_report(state) if state.status in TERMINAL and self.engine else None
        try:
            await self._store("persist_transition", state, command=command, report=report)
        except asyncio.CancelledError:
            # The shielded transaction completed; connected clients still need
            # its committed state even if the HTTP caller disconnected.
            self.hub.publish(state)
            raise
        self.hub.publish(state)

    async def command(self, run_id, command_type, payload, key):
        self.require_engine()
        async with self.lock:
            state = await self.get(run_id)
            previous = await self._store("get_command", run_id, key)
            if previous:
                if previous["command_type"] != command_type or previous["payload"] != payload:
                    raise ConflictError("Idempotency key was already used for another command")
                from app.services.missions.state import MissionState

                return MissionState.model_validate(previous["result"])
            current = self.clock()
            boundary_hit = False
            if self.clock_running and state.status == "running" and current > self.last_tick:
                state, boundary_hit = self._guided_tick(
                    state, (current - self.last_tick) * state.time_multiplier
                )
            if boundary_hit and command_type == "pause":
                # A guided boundary already paused the run; the operator's pause is satisfied.
                await self._commit(state, dict(idempotency_key=key, command_type=command_type, payload=payload))
                self.last_tick = current
                return state
            state = self.engine.apply_command(state, command_type, payload)
            try:
                await self._commit(state, dict(idempotency_key=key, command_type=command_type, payload=payload))
            except asyncio.CancelledError:
                self.last_tick = current
                raise
            self.last_tick = current
            return state

    async def reset(self, run_id, key):
        self.require_engine()
        async with self.lock:
            old = await self.get(run_id)
            previous = await self._store("get_command", run_id, key)
            if previous:
                if previous["command_type"] != "reset" or previous["payload"] != {}:
                    raise ConflictError("Idempotency key was already used for another command")
                new_id = previous["result"].get("reset_run_id")
                return await self.get(new_id)
            if old.status not in TERMINAL:
                raise ConflictError("Finish or terminate this run before resetting")
            if await self._store("active_run"):
                raise ConflictError("Another active simulation already exists")
            state = self.engine.create_state(
                old.mission,
                random_seed=old.random_seed,
                time_multiplier=(await self._store("settings")).get(
                    "simulation_speed", self.store.db.settings.simulation_time_multiplier
                ),
                run_profile=old.run_profile,
                recovery_mode=old.recovery_mode,
            )
            await self._store("persist_reset", old, state, key)
            self.hub.publish(state)
            return state

    async def advance(self, seconds):
        self.require_engine()
        async with self.lock:
            active = await self._store("active_run")
            if active and active.status == "running":
                updated = self._guided_tick(active, seconds)[0]
                await self._commit(updated)

    async def recovery_plan(self, run_id):
        """Build guidance from a copy; never persists or broadcasts."""
        self.require_engine()
        async with self.lock:
            state = await self.get(run_id)
            from app.services.missions.recovery import build_recovery_plan

            return build_recovery_plan(state, self.engine)

    async def recover(self):
        async with self.lock:
            state = await self._store("active_run")
            if state and state.status == "running":
                state = state.model_copy(deep=True)
                state.status = "paused"
                state.sequence += 1
                state.events.append(
                    Event(
                        id=uuid4(),
                        sequence=state.sequence,
                        simulated_time_seconds=state.elapsed_time_seconds,
                        event_type="system",
                        severity="warning",
                        message="Backend stopped or restarted; explicit resume required",
                    )
                )
                await self._store("persist_transition", state)
                self.hub.publish(state)

    async def snapshot_subscription(self, run_id):
        async with self.lock:
            state = await self.get(run_id)
            queue = self.hub.subscribe(run_id)
            return state, queue

    def start(self):
        if self.engine and self.task is None:
            self.clock_running = True
            self.last_tick = self.clock()
            self.task = asyncio.create_task(self._run(), name="commandgrid-single-runner")

    async def _run(self):
        while True:
            await asyncio.sleep(self.store.db.settings.simulation_tick_seconds)
            if self.recovery_pending:
                try:
                    await self.recover()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.error("runner_recovery_pending", extra={"error_type": type(exc).__name__})
                else:
                    self.recovery_pending = False
                    self.last_tick = self.clock()
                continue
            try:
                async with self.lock:
                    current = self.clock()
                    delta = current - self.last_tick
                    state = await self._store("active_run")
                    if state and state.status == "running" and delta > 0:
                        updated = self._guided_tick(state, delta * state.time_multiplier)[0]
                        await self._commit(updated)
                    self.last_tick = current
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # Never log exception text: SQL/provider errors can contain credentials.
                logger.error("runner_tick_failed", extra={"error_type": type(exc).__name__})
                self.recovery_pending = True

    async def stop(self):
        self.clock_running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None
        await self.recover()
