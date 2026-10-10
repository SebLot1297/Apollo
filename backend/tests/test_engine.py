"""Observable engine behavior, independent of API, persistence, and AI."""
import copy
import json
import unittest
import sys
from unittest.mock import patch
from pathlib import Path
from uuid import UUID, uuid5

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.seed import demo_mission
from app.schemas.mission import MissionConfiguration, MissionObjective
from app.schemas.simulation import MissionState
from app.simulation.engine import apply_command, build_report, create_state, tick
from app.simulation.objectives import compare


def objective(metric="elapsed_time_seconds", target=0, operator=">=", mode="final",
              required=True, deadline=None, name="Test"):
    return MissionObjective(id=uuid5(UUID(int=1), name), name=name, metric_key=metric,
                            operator=operator, target_value=target, evaluation_mode=mode,
                            required=required, deadline_seconds=deadline)


def mission(**parameters):
    data = demo_mission().model_dump(mode="json")
    data["duration_seconds"] = 600
    data["parameters"].update(dict(weather_severity=0, environmental_disruption=0,
                                   equipment_reliability=100, resource_level=100,
                                   communication_reliability=100) | parameters)
    data["support_teams"] = []
    data["objectives"] = [objective().model_dump(mode="json")]
    return MissionConfiguration.model_validate(data)


def configured(*objectives, **parameters):
    data = mission(**parameters).model_dump(mode="json")
    data["objectives"] = [item.model_dump(mode="json") for item in objectives]
    return MissionConfiguration.model_validate(data)


def running(config=None, seed=42):
    return apply_command(create_state(config or mission(), random_seed=seed), "start")


class EngineTests(unittest.TestCase):
    def test_all_operators(self):
        cases = {">=": [False, True, True], "<=": [True, True, False],
                 "=": [False, True, False], ">": [False, False, True], "<": [True, False, False]}
        for operator, expected in cases.items():
            for actual, passed in zip([9.999, 10, 10.001], expected):
                with self.subTest(operator=operator, actual=actual):
                    self.assertEqual(compare(actual, operator, 10), passed)
        self.assertTrue(compare(0.1 + 0.2, "=", 0.3))

    def test_transitions_clock_and_input_immutability(self):
        config = mission()
        original = config.model_dump_json()
        state = create_state(config, time_multiplier=500)
        before = state.model_dump_json()
        self.assertEqual(tick(state, 20).elapsed_time_seconds, 0)
        started = apply_command(state, "start")
        self.assertEqual(state.model_dump_json(), before)
        self.assertEqual(config.model_dump_json(), original)
        with self.assertRaises(ValueError):
            apply_command(started, "start")
        progressed = tick(started, 10.25)
        self.assertEqual(started.elapsed_time_seconds, 0)
        self.assertEqual(progressed.elapsed_time_seconds, 10.25)
        paused = apply_command(progressed, "pause")
        self.assertEqual(tick(paused, 100).model_dump(), paused.model_dump())
        with self.assertRaises(ValueError):
            apply_command(paused, "trigger_incident", {"kind": "power_failure"})
        resumed = apply_command(paused, "resume")
        completed = tick(resumed, 10000)
        self.assertEqual(completed.elapsed_time_seconds, 600)
        self.assertEqual(tick(completed, 100).model_dump(), completed.model_dump())
        for command in ["start", "pause", "resume", "finish", "terminate"]:
            with self.subTest(command=command), self.assertRaises(ValueError):
                apply_command(completed, command)
        for delta in [-1, float("nan"), float("inf"), True, "10"]:
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                tick(state, delta)
        for multiplier in [0, -1, True, float("inf")]:
            with self.assertRaises(ValueError):
                create_state(config, time_multiplier=multiplier)

    def test_known_uptime_intervals_pause_and_backup(self):
        state = tick(running(), 100)
        state = apply_command(state, "trigger_incident", {"kind": "communications_outage"})
        state = tick(state, 50)
        self.assertAlmostEqual(state.metrics["communication_uptime_percent"], 100 * 100 / 150)
        state = apply_command(state, "pause")
        state = tick(state, 1000)
        state = apply_command(state, "resume")
        state = apply_command(state, "activate_backup_communications")
        state = tick(state, 50)
        self.assertEqual(state.connected_time_seconds, 150)
        self.assertEqual(state.metrics["communication_uptime_percent"], 75)
        self.assertEqual(create_state(mission()).metrics["communication_uptime_percent"], 100)
        self.assertEqual(create_state(mission(communication_reliability=30)).metrics["communication_uptime_percent"], 0)

    def test_determinism_serialization_and_chunking(self):
        config = demo_mission()
        initial = running(config, 7)
        whole = tick(initial, 21600)
        split = initial
        for _ in range(216):
            split = tick(split, 100)
            split = MissionState.model_validate_json(split.model_dump_json())
        replay = tick(MissionState.model_validate_json(initial.model_dump_json()), 21600)
        for candidate in [split, replay]:
            self.assertEqual(candidate.metrics, whole.metrics)
            self.assertEqual(candidate.systems, whole.systems)
            self.assertEqual(candidate.incidents, whole.incidents)
            self.assertEqual(candidate.objective_results, whole.objective_results)
            self.assertEqual(candidate.next_incident_at, whole.next_incident_at)
            self.assertEqual(candidate.rng_counters, whole.rng_counters)
            self.assertEqual(candidate.resource_remaining, whole.resource_remaining)
            self.assertEqual(candidate.events, whole.events)
        fresh = tick(running(config, 7), 21600)
        self.assertEqual(fresh.incidents, whole.incidents)
        self.assertNotEqual(tick(running(config, 8), 21600).incidents, whole.incidents)

    def test_metadata_is_inert_and_parameter_effects(self):
        base = mission()
        data = base.model_dump(mode="json")
        data["parameters"]["custom_metadata"] = {"resource_level": 999, "code": "raise RuntimeError()"}
        other = MissionConfiguration.model_validate(data)
        a, b = tick(running(base), 600), tick(running(other), 600)
        self.assertEqual(a.metrics, b.metrics)
        self.assertEqual(a.incidents, b.incidents)
        for parameter in ["weather_severity", "environmental_disruption", "equipment_reliability", "communication_reliability"]:
            changed = mission(**{parameter: 100 if parameter in ["weather_severity", "environmental_disruption"] else 0})
            self.assertNotEqual(create_state(changed).next_incident_at, create_state(base).next_incident_at)
        self.assertLess(create_state(mission(equipment_reliability=25)).metrics["equipment_availability_percent"], 100)
        self.assertLess(create_state(mission(environmental_disruption=100)).systems["power"].health, 100)
        fast = tick(running(mission(team_count=10)), 300)
        slow = tick(running(mission(team_count=1)), 300)
        self.assertGreater(fast.metrics["supplies_delivered_percent"], slow.metrics["supplies_delivered_percent"])
        limited = tick(running(mission(resource_level=10)), 300)
        self.assertLess(limited.metrics["supplies_delivered_percent"], slow.metrics["supplies_delivered_percent"])

    def test_recovery_constraints_and_semantic_idempotence(self):
        disabled = running(mission(backup_power_enabled=False))
        with self.assertRaisesRegex(ValueError, "enabled"):
            apply_command(disabled, "activate_backup_power")
        empty = running(mission(resource_level=0))
        empty = apply_command(empty, "trigger_incident", {"kind": "power_failure"})
        for command in ["restore_service", "activate_backup_power", "run_equipment_diagnostic"]:
            if command == "run_equipment_diagnostic":
                empty = apply_command(empty, "trigger_incident", {"kind": "equipment_degradation"})
            with self.subTest(command=command), self.assertRaisesRegex(ValueError, "resources"):
                apply_command(empty, command)
        state = apply_command(running(), "trigger_incident", {"kind": "communications_outage"})
        incident_id = str(state.incidents[0].id)
        state = apply_command(state, "acknowledge_incident", {"incident_id": incident_id})
        state = apply_command(state, "acknowledge_incident", {"incident_id": incident_id})
        state = apply_command(state, "restore_service", {"incident_id": incident_id})
        counts = (state.metrics["incidents_resolved"], state.metrics["systems_restored"])
        resources = state.resource_remaining
        state = apply_command(state, "restore_service", {"incident_id": incident_id})
        state = apply_command(state, "restore_service")
        self.assertEqual(counts, (1, 1))
        self.assertEqual(counts, (state.metrics["incidents_resolved"], state.metrics["systems_restored"]))
        self.assertEqual(resources, state.resource_remaining)
        self.assertEqual(len(state.command_history), 7)
        self.assertEqual(sum(event.type == "command" for event in state.events), 7)
        self.assertIn("no-op", state.command_history[-1].effect)

    def test_command_validation(self):
        state = running()
        for name, payload in [("reset", None), ("resume", None), ("trigger_incident", {}),
                              ("trigger_incident", {"kind": "weapon"}),
                              ("trigger_incident", {"kind": []}),
                              ("trigger_incident", {"kind": {"bad": "kind"}}),
                              ("acknowledge_incident", {"incident_id": str(UUID(int=9))}),
                              ("restore_service", {"incident_id": "bad"}),
                              ("pause", {"surprise": 1})]:
            with self.subTest(name=name, payload=payload), self.assertRaises(ValueError):
                apply_command(state, name, payload)

    def test_unrepresentable_numeric_clock_arguments_are_value_errors(self):
        state = running()
        for argument in [10 ** 1000, complex(1, 0), None]:
            with self.subTest(argument_type=type(argument).__name__), self.assertRaises(ValueError):
                tick(state, argument)
            with self.assertRaises(ValueError):
                create_state(mission(), time_multiplier=argument)

    def test_operators_through_all_objective_modes(self):
        cases = {">=": [False, True, True], "<=": [True, True, False],
                 "=": [False, True, False], ">": [False, False, True], "<": [True, False, False]}
        for mode in ["final", "maintained", "deadline", "accumulated"]:
            for operator, expected in cases.items():
                for offset, passes in zip([0.001, 0, -0.001], expected):
                    # Supply delivery is cumulative and can be constant at zero;
                    # use elapsed time for accumulated comparisons at t=10.
                    metric = "elapsed_time_seconds" if mode == "accumulated" else "equipment_availability_percent"
                    actual = 10 if mode == "accumulated" else 75
                    obj = objective(metric, actual + offset, operator, mode,
                                    deadline=100 if mode == "deadline" else None)
                    state = running(configured(obj, equipment_reliability=75))
                    state = tick(state, 10)
                    state = apply_command(state, "finish")
                    with self.subTest(mode=mode, operator=operator, offset=offset):
                        self.assertEqual(state.objective_results[0].passed, passes)

    def test_continuous_objective_evidence_is_chunk_independent(self):
        config = configured(
            objective("supplies_delivered_percent", 1, mode="deadline", deadline=300, name="supplies"),
            objective(target=50, operator="=", mode="deadline", deadline=50, name="equality"),
            objective(target=50, operator="<=", mode="maintained", name="maintained"))
        whole = tick(running(config), 200)
        split = running(config)
        for _ in range(200):
            split = tick(split, 1)
        self.assertEqual(whole.objective_evidence, split.objective_evidence)
        self.assertEqual(whole.objective_results, split.objective_results)
        self.assertTrue(whole.objective_results[0].passed)
        self.assertTrue(whole.objective_results[1].passed)
        self.assertFalse(whole.objective_results[2].passed)

    def test_uptime_accounts_for_scheduled_boundaries_inside_a_tick(self):
        state = running()
        state.next_incident_at = {"communications_outage": 20.0, "power_failure": 10000.0,
                                  "equipment_degradation": 10000.0}
        state = tick(state, 100)
        self.assertEqual(state.incidents[0].started_at_seconds, 20)
        self.assertEqual(state.connected_time_seconds, 20)
        self.assertEqual(state.metrics["communication_uptime_percent"], 20)
        timestamps = [event.elapsed_time_seconds for event in state.events]
        self.assertEqual(timestamps, sorted(timestamps))

    def test_uptime_maintained_breach_survives_later_recovery(self):
        state = running(configured(objective("communication_uptime_percent", 90, mode="maintained")))
        state = tick(state, 50)
        state = apply_command(state, "trigger_incident", {"kind": "communications_outage"})
        state = tick(state, 50)
        state = apply_command(state, "activate_backup_communications")
        state = tick(state, 500)
        self.assertGreater(state.metrics["communication_uptime_percent"], 90)
        self.assertFalse(state.objective_results[0].passed)
        breach = next(iter(state.objective_evidence.values())).breach_at_seconds
        self.assertAlmostEqual(breach, 50 / 0.9, places=6)

    def test_first_deadline_achievement_remains_when_gauge_declines(self):
        state = running(configured(objective("equipment_availability_percent", 75,
                                            mode="deadline", deadline=10)))
        state = tick(state, 20)
        for _ in range(2):
            state = apply_command(state, "trigger_incident", {"kind": "equipment_degradation"})
        self.assertLess(state.metrics["equipment_availability_percent"], 75)
        self.assertTrue(state.objective_results[0].passed)
        self.assertEqual(state.objective_results[0].first_achieved_at_seconds, 0)

    def test_serialized_replay_with_commands(self):
        state = running(demo_mission(), 9)
        reloaded = MissionState.model_validate_json(state.model_dump_json())
        for operation, payload in [("tick", 123.45), ("activate_backup_communications", None),
                                   ("activate_backup_power", None), ("tick", 4000),
                                   ("restore_service", None), ("tick", 3000)]:
            if operation == "tick":
                state, reloaded = tick(state, payload), tick(reloaded, payload)
            else:
                state, reloaded = apply_command(state, operation, payload), apply_command(reloaded, operation, payload)
            reloaded = MissionState.model_validate_json(reloaded.model_dump_json())
            self.assertEqual(state.model_dump(), reloaded.model_dump())

    def test_backup_communications_needs_power_and_activations_cannot_farm(self):
        state = running()
        for kind in ["communications_outage", "power_failure"]:
            state = apply_command(state, "trigger_incident", {"kind": kind})
        state = apply_command(state, "activate_backup_communications")
        self.assertFalse(state.connected)
        state = apply_command(state, "activate_backup_power")
        self.assertTrue(state.connected)
        self.assertEqual(state.metrics["systems_restored"], 2)
        remaining = state.resource_remaining
        for _ in range(3):
            state = apply_command(state, "activate_backup_communications")
            state = apply_command(state, "activate_backup_power")
        self.assertEqual(state.metrics["systems_restored"], 2)
        self.assertEqual(state.resource_remaining, remaining)
        self.assertEqual(state.metrics["incidents_resolved"], 0)
        state = apply_command(state, "restore_service")
        self.assertEqual(state.metrics["systems_restored"], 2)
        self.assertEqual(state.metrics["incidents_resolved"], 2)

    def test_team_count_reduces_repair_cost_and_failed_command_is_immutable(self):
        resources = []
        for teams in [1, 10]:
            state = running(mission(team_count=teams))
            state = apply_command(state, "trigger_incident", {"kind": "power_failure"})
            state = apply_command(state, "restore_service")
            resources.append(state.resource_remaining)
        self.assertGreater(resources[1], resources[0])
        state = apply_command(running(mission(resource_level=1)), "trigger_incident", {"kind": "power_failure"})
        original = state.model_dump_json()
        with self.assertRaises(ValueError):
            apply_command(state, "restore_service")
        self.assertEqual(state.model_dump_json(), original)

    def test_delivery_saturation_resource_bounds_and_decimal_time(self):
        data = mission(team_count=10).model_dump(mode="json")
        data["duration_seconds"] = 86400
        state = running(MissionConfiguration.model_validate(data))
        for _ in range(10):
            state = tick(state, 0.1)
        self.assertEqual(state.elapsed_time_seconds, 1)
        state = tick(state, 9999)
        self.assertEqual(state.metrics["supplies_delivered_percent"], 100)
        self.assertEqual(state.resource_remaining, 90)
        depleted = tick(running(mission(resource_level=0)), 600)
        self.assertEqual(depleted.metrics["supplies_delivered_percent"], 0)
        self.assertEqual(depleted.resource_remaining, 0)

    def test_early_finish_deadline_and_created_termination(self):
        state = running(configured(objective(target=100, mode="deadline", deadline=100)))
        state = apply_command(tick(state, 10), "pause")
        state = apply_command(state, "finish")
        self.assertEqual(state.elapsed_time_seconds, 10)
        self.assertEqual(state.status, "failed")
        self.assertEqual(state.objective_results[0].status, "failed")
        self.assertIsNone(state.objective_results[0].first_achieved_at_seconds)
        created = create_state(mission())
        for command in ["pause", "resume", "finish", "restore_service"]:
            with self.subTest(command=command), self.assertRaises(ValueError):
                apply_command(created, command)
        terminated = apply_command(created, "terminate")
        self.assertEqual(terminated.elapsed_time_seconds, 0)
        self.assertEqual(terminated.status, "terminated")
        self.assertFalse(build_report(terminated)["success"])

    def test_seed_success_and_failure_depend_on_actions(self):
        untouched = tick(running(demo_mission()), 21600)
        restored = apply_command(running(demo_mission()), "activate_backup_communications")
        restored = apply_command(restored, "activate_backup_power")
        restored = tick(restored, 21600)
        self.assertFalse(build_report(untouched)["success"])
        self.assertTrue(build_report(restored)["success"])
        self.assertEqual(restored.metrics["communication_uptime_percent"], 100)
        self.assertEqual(restored.metrics["systems_restored"], 2)
        report = build_report(restored)
        report["mission"]["name"] = "External mutation"
        report["events"].clear()
        self.assertEqual(restored.mission.name, "Operation Signal Restore")
        self.assertTrue(restored.events)

    def test_rng_extreme_draw_is_finite(self):
        # A maximum digest rounds the midpoint mapping to 1.0 in binary64;
        # scheduler must still produce a finite future time, not log(0).
        with patch("app.simulation.incidents.hashlib.sha256") as digest:
            digest.return_value.digest.return_value = b"\xff" * 32
            state = create_state(mission())
        for boundary in state.next_incident_at.values():
            self.assertGreater(boundary, 0)
            self.assertLess(boundary, float("inf"))

    def test_full_example_payloads_validate_and_replay(self):
        from app.data.examples import example_payloads
        examples = example_payloads()
        directory = Path(__file__).resolve().parents[1] / "app" / "data" / "examples"
        for name, payload in examples.items():
            with self.subTest(name=name):
                self.assertEqual(json.loads((directory / f"{name}.json").read_text(encoding="utf-8")), payload)
        config = MissionConfiguration.model_validate(examples["mission"])
        self.assertEqual(config, demo_mission())
        state = MissionState.model_validate(examples["state"])
        self.assertEqual(build_report(apply_command(tick(state, 120), "finish")), examples["report"])

    def test_failed_status_cannot_report_success_with_passing_results(self):
        passed = apply_command(running(), "finish")
        self.assertTrue(passed.objective_results[0].passed)
        self.assertTrue(build_report(passed)["success"])
        # A persisted external failure can coexist with prior passing evidence.
        passed.status = "failed"
        self.assertFalse(build_report(passed)["success"])

    def test_final_maintained_and_first_deadline_evidence(self):
        config = configured(objective("equipment_availability_percent", 75, mode="final", name="final"),
                            objective("equipment_availability_percent", 75, mode="maintained", name="maintained"),
                            objective("equipment_availability_percent", 75, mode="deadline", deadline=50, name="deadline"))
        state = tick(running(config), 10)
        state = apply_command(state, "trigger_incident", {"kind": "equipment_degradation"})
        state = apply_command(state, "trigger_incident", {"kind": "equipment_degradation"})
        state = apply_command(state, "run_equipment_diagnostic")
        state = apply_command(state, "finish")
        final, maintained, deadline = state.objective_results
        self.assertTrue(final.passed)
        self.assertFalse(maintained.passed)
        self.assertTrue(deadline.passed)
        self.assertEqual(deadline.first_achieved_at_seconds, 0)
        self.assertFalse(build_report(state)["success"])
        self.assertIn("breach", maintained.reason)

    def test_deadline_boundary_and_late_commands(self):
        config = configured(objective("systems_restored", 1, mode="deadline", deadline=100))
        state = apply_command(running(config), "trigger_incident", {"kind": "communications_outage"})
        boundary = apply_command(tick(state, 100), "restore_service")
        self.assertTrue(boundary.objective_results[0].passed)
        self.assertEqual(boundary.objective_results[0].first_achieved_at_seconds, 100)
        late = apply_command(tick(state, 100.001), "restore_service")
        self.assertFalse(late.objective_results[0].passed)
        self.assertEqual(late.objective_results[0].status, "expired")
        self.assertEqual(late.objective_results[0].first_achieved_at_seconds, 100.001)

    def test_continuous_deadline_and_maintained_evidence_between_samples(self):
        state = running(configured(objective(target=100, mode="deadline", deadline=100)))
        state = tick(state, 150)
        self.assertTrue(state.objective_results[0].passed)
        self.assertAlmostEqual(state.objective_results[0].first_achieved_at_seconds, 100, places=7)
        state = running(configured(objective(target=100, operator="=", mode="deadline", deadline=100)))
        state = tick(state, 150)
        self.assertTrue(state.objective_results[0].passed)
        state = running(configured(objective(target=50, operator="<=", mode="maintained")))
        state = tick(state, 100)
        self.assertFalse(state.objective_results[0].passed)
        self.assertIn("breach", state.objective_results[0].reason)

    def test_accumulated_and_required_optional_success(self):
        config = configured(objective("incidents_resolved", 1, mode="accumulated", name="required"),
                            objective("equipment_availability_percent", 100, required=False, name="optional"),
                            equipment_reliability=50)
        state = apply_command(running(config), "trigger_incident", {"kind": "communications_outage"})
        state = apply_command(state, "restore_service", {"incident_id": str(state.incidents[0].id)})
        state = tick(state, 20)
        state = tick(state, 20)
        state = apply_command(state, "finish")
        self.assertEqual(state.objective_results[0].achieved_value, 1)
        self.assertTrue(build_report(state)["success"])
        self.assertFalse(state.objective_results[1].passed)
        failed = apply_command(running(config), "finish")
        self.assertEqual(failed.status, "failed")
        self.assertFalse(build_report(failed)["success"])
        terminated = apply_command(running(), "terminate")
        self.assertFalse(build_report(terminated)["success"])

    def test_reports_and_early_finish(self):
        state = tick(running(), 12.5)
        state = apply_command(state, "finish")
        before = state.model_dump_json()
        report = build_report(state)
        self.assertEqual(state.elapsed_time_seconds, 12.5)
        self.assertEqual(state.model_dump_json(), before)
        self.assertEqual(report["final_metrics"], state.metrics)
        self.assertEqual(report["telemetry"], [sample.model_dump(mode="json") for sample in state.history])
        self.assertEqual(report["command_history"], [command.model_dump(mode="json") for command in state.command_history])
        self.assertIsNone(report["ai_analysis"])
        self.assertEqual(set(report), {"run_id", "mission", "success", "status", "recovery_mode", "elapsed_time_seconds",
                                      "final_metrics", "objective_results", "events", "command_history",
                                      "telemetry", "summary", "ai_analysis", "created_at"})
        json.dumps(report, allow_nan=False)
        self.assertFalse(build_report(running())["success"])


if __name__ == "__main__":
    unittest.main()
