"""No hardcoded outcome: this scenario may succeed or fail under engine rules."""
from datetime import datetime, timezone
from uuid import UUID, uuid5

from app.schemas.mission import MissionConfiguration, MissionObjective, MissionParameters

DEMO_ID = UUID("cedab24e-0c7d-5a3b-b041-870a1f894b23")


def demo_mission() -> MissionConfiguration:
    timestamp = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
    return MissionConfiguration(
        id=DEMO_ID, name="Operation Signal Restore", duration_seconds=21600,
        description="A fictional emergency-support facility has experienced intermittent power and "
                    "communications outages. Operators must restore services while managing limited equipment availability.",
        parameters=MissionParameters(weather_severity=85, environmental_disruption=70, team_count=4,
                                     equipment_reliability=75, resource_level=70,
                                     communication_reliability=45, backup_power_enabled=True),
        objectives=[
            MissionObjective(id=uuid5(DEMO_ID, "uptime"), name="Maintain communication service",
                metric_key="communication_uptime_percent", operator=">=", target_value=90,
                evaluation_mode="final", description="At least 90% connected simulated time at completion."),
            MissionObjective(id=uuid5(DEMO_ID, "restoration"), name="Restore two systems",
                metric_key="systems_restored", operator=">=", target_value=2,
                evaluation_mode="deadline", deadline_seconds=21600,
                description="Restore two legitimate degraded system episodes within the mission window."),
            MissionObjective(id=uuid5(DEMO_ID, "equipment"), name="Preserve equipment availability",
                metric_key="equipment_availability_percent", operator=">=", target_value=75,
                required=False, evaluation_mode="final"),
        ], created_at=timestamp, updated_at=timestamp,
    )
