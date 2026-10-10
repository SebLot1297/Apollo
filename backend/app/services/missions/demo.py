"""Canonical, repeatable Hackathon Recovery Demo configuration.

The demo is a fixed mission + seed so a presenter can rehearse the same incident
timeline every time. Outcomes still come from the real engine: only the mission
snapshot, seed and starting speed are prescribed, never the result.

With these parameters and seed 13337 the seeded schedule places the three
incidents at roughly:
    communications outage ~230s, equipment degradation ~488s, power failure ~594s
Each kind fires exactly once before the 900s endpoint, so resolving all three is
required to satisfy the "resolve three incidents" objective.
"""
from datetime import datetime, timezone
from uuid import UUID, uuid5

from app.schemas.mission import MissionConfiguration, MissionObjective, MissionParameters

# Fixed identity so the seeded mission is inserted (never overwritten) once.
GUIDED_DEMO_MISSION_ID = UUID("d3e0f00d-1337-5eed-9000-c0ffee000001")
GUIDED_DEMO_SEED = 13337
GUIDED_DEMO_SPEED = 5
GUIDED_DEMO_DURATION = 900


def guided_demo_mission() -> MissionConfiguration:
    timestamp = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
    mission_id = GUIDED_DEMO_MISSION_ID
    return MissionConfiguration(
        id=mission_id,
        name="Hackathon Recovery Demo",
        description=(
            "A calm, well-resourced fictional Communications Recovery scenario for a guided "
            "presentation. Systems start healthy; three seeded incidents degrade communications, "
            "equipment and power. Recover promptly with the guided actions to finish successfully."
        ),
        duration_seconds=GUIDED_DEMO_DURATION,
        parameters=MissionParameters(
            weather_severity=40,
            environmental_disruption=20,
            team_count=4,
            equipment_reliability=100,
            communication_reliability=100,
            resource_level=90,
            backup_power_enabled=True,
        ),
        objectives=[
            MissionObjective(
                id=uuid5(mission_id, "uptime"),
                name="Protect communication uptime",
                metric_key="communication_uptime_percent",
                operator=">=",
                target_value=90,
                required=True,
                evaluation_mode="final",
                description="At least 90% connected simulated time at completion.",
            ),
            MissionObjective(
                id=uuid5(mission_id, "incidents"),
                name="Resolve three incidents",
                metric_key="incidents_resolved",
                operator=">=",
                target_value=3,
                required=True,
                evaluation_mode="deadline",
                deadline_seconds=GUIDED_DEMO_DURATION,
                description="Resolve all three seeded incidents within the mission window.",
            ),
            MissionObjective(
                id=uuid5(mission_id, "equipment"),
                name="Preserve equipment availability",
                metric_key="equipment_availability_percent",
                operator=">=",
                target_value=90,
                required=True,
                evaluation_mode="final",
                description="Final operational equipment availability of at least 90%.",
            ),
            MissionObjective(
                id=uuid5(mission_id, "elapsed"),
                name="Run the full window",
                metric_key="elapsed_time_seconds",
                operator=">=",
                target_value=GUIDED_DEMO_DURATION,
                required=True,
                evaluation_mode="final",
                description="Complete the full 900 simulated seconds rather than finishing early.",
            ),
        ],
        created_at=timestamp,
        updated_at=timestamp,
    )
