"""Adapt Part B snapshots to the public API without changing numerical rules.

The complete native snapshot is persisted privately so seeded cursors and
objective evidence survive restarts. Public events have an independent sequence
because the runner also appends recovery/reset events outside the pure engine.
"""
from app.schemas.simulation import MissionState as EngineState
from app.services.missions.state import Event, HistorySample, MissionState


class EngineAdapter:
    def __init__(self, engine):
        self.engine = engine

    @staticmethod
    def _native(state):
        if not state.engine_snapshot:
            raise ValueError("Run has no numerical engine snapshot; create a new simulation")
        native = EngineState.model_validate(state.engine_snapshot)
        # Shutdown/recovery pauses are owned by the external runner.
        native.status = state.status
        return native

    @staticmethod
    def _public(native, previous=None, run_profile=None):
        profile = run_profile or (previous.run_profile if previous else "standard")
        events = [event.model_copy(deep=True) for event in previous.events] if previous else []
        history = [sample.model_copy(deep=True) for sample in previous.history] if previous else []
        prior = previous.engine_snapshot if previous else {}
        event_sequence = max((event.sequence for event in events), default=0)
        for event in native.events[len(prior.get("events", [])):]:
            event_sequence += 1
            severity = "action" if event.type == "command" else "warning" if event.type == "incident_started" else "info"
            events.append(Event(
                id=event.id, sequence=event_sequence, simulated_time_seconds=event.elapsed_time_seconds,
                event_type=event.type, severity=severity, message=event.message, payload=event.details,
            ))
        for sample in native.history[len(prior.get("history", [])):]:
            history.append(HistorySample(
                simulated_time_seconds=sample.elapsed_time_seconds, metrics=sample.metrics, systems=sample.systems,
            ))
        sequence = max(native.sequence, event_sequence, previous.sequence + 1 if previous else 0)
        return MissionState(
            run_id=native.run_id, mission_id=native.mission_id, mission=native.mission,
            status=native.status, run_profile=profile, elapsed_time_seconds=native.elapsed_time_seconds,
            random_seed=native.random_seed, time_multiplier=native.time_multiplier, sequence=sequence,
            metrics=native.metrics, systems={
                "communication_health": native.systems["communications"].health,
                "equipment_availability": native.systems["equipment"].health,
                "power_availability": native.systems["power"].health,
                "resource_level": native.resource_remaining,
            }, facilities=native.facilities, support_teams=native.support_teams,
            incidents=[incident.model_dump(include={
                "id", "kind", "title", "description", "status", "started_at_seconds", "resolved_at_seconds",
            }) for incident in native.incidents],
            events=events, history=history,
            objective_results=[result.model_dump() for result in native.objective_results],
            connected_time_seconds=native.connected_time_seconds,
            backup_communications_active=native.backup_communications_active,
            backup_power_active=native.backup_power_active,
            command_history=[{
                **command.model_dump(mode="json"), "simulated_time_seconds": command.elapsed_time_seconds,
            } for command in native.command_history],
            engine_snapshot=native.model_dump(mode="json"),
        )

    def create_state(self, mission, random_seed=42, run_id=None, time_multiplier=30, run_profile="standard"):
        return self._public(
            self.engine.create_state(
                mission, random_seed=random_seed, run_id=run_id, time_multiplier=time_multiplier,
            ),
            run_profile=run_profile,
        )

    def apply_command(self, state, command_type, payload=None):
        return self._public(self.engine.apply_command(self._native(state), command_type, payload), state)

    def tick(self, state, seconds):
        native = self._native(state)
        result = self.engine.tick(native, seconds)
        if result.sequence == native.sequence:
            return state.model_copy(deep=True)
        return self._public(result, state)

    def build_report(self, state):
        report = self.engine.build_report(self._native(state))
        report.update(
            events=[event.model_dump(mode="json") for event in state.events],
            telemetry=[sample.model_dump(mode="json") for sample in state.history],
            command_history=state.command_history,
        )
        return report
