"""Domain contract tests; collected by pytest or Python's unittest runner."""
import copy
import json
import unittest
import sys
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.seed import demo_mission
from app.schemas.mission import MissionConfiguration, MissionObjective, MissionParameters
from app.simulation.registry import get_registry


class SchemaTests(unittest.TestCase):
    def test_demo_and_defaults(self):
        mission = demo_mission()
        self.assertEqual(mission.name, "Operation Signal Restore")
        self.assertEqual(mission.duration_seconds, 21600)
        self.assertEqual(len(mission.support_teams), 4)
        self.assertTrue(mission.facilities)
        self.assertEqual(mission, MissionConfiguration.model_validate_json(mission.model_dump_json()))
        data = mission.model_dump(mode="json")
        data["facilities"] = []
        data["support_teams"] = []
        data["parameters"]["team_count"] = 7
        regenerated = MissionConfiguration.model_validate(data)
        self.assertEqual(len(regenerated.support_teams), 7)
        self.assertTrue(regenerated.facilities)

    def test_parameter_boundaries_and_finite_types(self):
        fields = ["weather_severity", "environmental_disruption", "equipment_reliability",
                  "resource_level", "communication_reliability"]
        for field in fields:
            for value in [0, 100]:
                with self.subTest(field=field, value=value):
                    self.assertEqual(getattr(MissionParameters(**{field: value}), field), value)
            for value in [-0.1, 100.1, float("nan"), float("inf"), -float("inf"), True, "20"]:
                with self.subTest(field=field, value=value), self.assertRaises(ValidationError):
                    MissionParameters(**{field: value})
        for value in [0, 11, 1.5, True, "4"]:
            with self.subTest(team_count=value), self.assertRaises(ValidationError):
                MissionParameters(team_count=value)
        for value in [1, "true"]:
            with self.assertRaises(ValidationError):
                MissionParameters(backup_power_enabled=value)

    def test_mission_validation(self):
        data = demo_mission().model_dump(mode="json")
        patches = [{"duration_seconds": value} for value in [59, 86401, 60.5, True, float("inf")]]
        patches += [{"schema_version": 2}, {"schema_version": True}, {"name": "  "},
                    {"category": "humanitarian_logistics"}, {"objectives": []}, {"surprise": 1}]
        for patch in patches:
            with self.subTest(patch=patch), self.assertRaises(ValidationError):
                MissionConfiguration.model_validate(data | patch)
        for duration in [60, 86400]:
            valid = copy.deepcopy(data)
            valid["duration_seconds"] = duration
            valid["objectives"][1]["deadline_seconds"] = duration
            self.assertEqual(MissionConfiguration.model_validate(valid).duration_seconds, duration)
        for count in [1, 10]:
            self.assertEqual(MissionParameters(team_count=count).team_count, count)
        optional = copy.deepcopy(data)
        for objective in optional["objectives"]:
            objective["required"] = False
        with self.assertRaises(ValidationError):
            MissionConfiguration.model_validate(optional)
        for key in ["objectives", "facilities", "support_teams"]:
            duplicate = copy.deepcopy(data)
            duplicate[key].append(copy.deepcopy(duplicate[key][0]))
            with self.subTest(key=key), self.assertRaises(ValidationError):
                MissionConfiguration.model_validate(duplicate)
        with self.assertRaises(ValidationError):
            MissionConfiguration.model_validate(data | {"support_teams": data["support_teams"][:1]})

    def test_objective_validation(self):
        valid = dict(id=uuid4(), name="Restore", metric_key="systems_restored", operator=">=",
                     target_value=2, required=True, evaluation_mode="deadline", deadline_seconds=60)
        patches = [{"target_value": value} for value in [2.5, True, float("nan"), float("inf"), -1]]
        patches += [{"name": ""}, {"metric_key": "arbitrary"}, {"operator": "!="},
                    {"evaluation_mode": "arbitrary"}, {"deadline_seconds": None},
                    {"deadline_seconds": True}, {"status": "passed"},
                    {"evaluation_mode": "final", "deadline_seconds": 60},
                    {"metric_key": "equipment_availability_percent", "evaluation_mode": "accumulated"},
                    {"metric_key": "equipment_availability_percent", "target_value": 101}]
        for patch in patches:
            with self.subTest(patch=patch), self.assertRaises(ValidationError):
                MissionObjective(**(valid | patch))
        data = demo_mission().model_dump(mode="json")
        data["objectives"][1]["deadline_seconds"] = data["duration_seconds"] + 1
        with self.assertRaises(ValidationError):
            MissionConfiguration.model_validate(data)

    def test_metadata_and_coordinates(self):
        metadata = {"sql": "DROP TABLE missions", "expression": "resource_level=100",
                    "flag": True, "number": 4.2, "nothing": None}
        self.assertEqual(MissionParameters(custom_metadata=metadata).custom_metadata, metadata)
        for value in [[1], {"nested": 1}, float("inf"), float("nan")]:
            with self.assertRaises(ValidationError):
                MissionParameters(custom_metadata={"bad": value})
        with self.assertRaises(ValidationError):
            MissionParameters(custom_metadata={1: "bad"})
        data = demo_mission().model_dump(mode="json")
        for value in [-1, 101, float("nan"), True]:
            bad = copy.deepcopy(data)
            bad["facilities"][0]["x"] = value
            with self.subTest(value=value), self.assertRaises(ValidationError):
                MissionConfiguration.model_validate(bad)

    def test_timestamps_are_utc_and_aware(self):
        data = demo_mission().model_dump(mode="json")
        data["created_at"] = "2026-10-10T08:00:00-04:00"
        mission = MissionConfiguration.model_validate(data)
        self.assertEqual(mission.created_at, datetime(2026, 10, 10, 12, tzinfo=timezone.utc))
        for value in ["2026-10-10T12:00:00", "garbage"]:
            with self.assertRaises(ValidationError):
                MissionConfiguration.model_validate(data | {"created_at": value})
        from app.schemas.simulation import Event
        event = Event(id=uuid4(), type="test", message="UTC normalization",
                      timestamp="2026-10-10T08:00:00-04:00", elapsed_time_seconds=0)
        self.assertEqual(event.timestamp.utcoffset().total_seconds(), 0)

    def test_registry_is_serializable_and_defensive(self):
        registry = get_registry()
        json.dumps(registry, allow_nan=False)
        self.assertEqual(len(registry["metrics"]), 6)
        self.assertIn("mission_duration", {entry["key"] for entry in registry["parameters"]})
        registry["metrics"][0]["supported_modes"].clear()
        self.assertTrue(get_registry()["metrics"][0]["supported_modes"])
        categories = get_registry()["categories"]
        self.assertEqual([entry["key"] for entry in categories if entry["enabled"]], ["communications_recovery"])
        self.assertEqual(len([entry for entry in categories if not entry["enabled"]]), 4)

    def test_registries_match_schema_defaults_and_metric_bounds(self):
        from app.simulation.registry import METRIC_REGISTRY, PARAMETER_REGISTRY
        defaults = MissionParameters().model_dump()
        for definition in get_registry()["parameters"]:
            if definition["key"] == "mission_duration":
                continue
            self.assertEqual(definition["default"], defaults[definition["key"]])
            self.assertTrue(definition["effects"])
        with self.assertRaises(TypeError):
            METRIC_REGISTRY["new"] = {}
        with self.assertRaises(TypeError):
            PARAMETER_REGISTRY["team_count"]["maximum"] = 100
        for key, metric in METRIC_REGISTRY.items():
            if metric["maximum"] is not None:
                with self.subTest(key=key), self.assertRaises(ValidationError):
                    MissionObjective(name="Too high", metric_key=key, target_value=metric["maximum"] + 1)


if __name__ == "__main__":
    unittest.main()
