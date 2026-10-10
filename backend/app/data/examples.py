"""Regenerate full integration payloads using only public engine interfaces.

Run with backend on PYTHONPATH: python -m app.data.examples
This optional utility writes local example files; the engine itself performs no I/O.
"""
import json
from pathlib import Path
from uuid import UUID

from app.data.seed import demo_mission
from app.simulation.engine import apply_command, build_report, create_state, tick


def example_payloads() -> dict:
    mission = demo_mission()
    state = create_state(mission, run_id=UUID("b378fd50-5cba-5d47-84b7-2bca72638932"))
    state = apply_command(state, "start")
    state = apply_command(state, "activate_backup_communications")
    state = apply_command(state, "activate_backup_power")
    report_state = apply_command(tick(state, 120), "finish")
    return {"mission": mission.model_dump(mode="json"), "state": state.model_dump(mode="json"),
            "report": build_report(report_state)}


def main():
    destination = Path(__file__).with_suffix("")
    destination.mkdir(exist_ok=True)
    for name, payload in example_payloads().items():
        path = destination / f"{name}.json"
        path.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        print(path)


if __name__ == "__main__":
    main()
