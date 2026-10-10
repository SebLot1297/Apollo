"""Strict proposal boundary shared by live adapters and deterministic templates."""

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.mission import MissionConfiguration, MissionObjective


class ObjectiveProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    objectives: list[MissionObjective] = Field(min_length=1, max_length=20)


def schema_for(task: str) -> dict:
    model = MissionConfiguration if task == "generate_mission" else ObjectiveProposal
    return model.model_json_schema()


def strict_json(text: str) -> Any:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError("nonfinite JSON number")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant)


def validate_data(task: str, data: Any, context: Any) -> dict | list:
    if task == "generate_mission":
        mission = MissionConfiguration.model_validate(data)
        if len(mission.objectives) > 20 or len(mission.facilities) > 40:
            raise ValueError("proposal too large")
        result = mission.model_dump(mode="json")
    elif task == "generate_objectives":
        # Live structured output uses an object wrapper; the public API uses a plain array.
        proposal = ObjectiveProposal.model_validate({"objectives": data} if isinstance(data, list) else data)
        objectives = proposal.objectives
        if len({item.id for item in objectives}) != len(objectives):
            raise ValueError("duplicate objective IDs")
        if isinstance(context, dict) and context.get("mission") is not None:
            mission = MissionConfiguration.model_validate(context["mission"]).model_dump(mode="json")
            mission["objectives"] += [item.model_dump(mode="json") for item in objectives]
            MissionConfiguration.model_validate(mission)
        result = [item.model_dump(mode="json") for item in objectives]
    else:
        if not isinstance(data, dict) or set(data) != {"text"}:
            raise ValueError("invalid text envelope")
        if not isinstance(data["text"], str) or not data["text"].strip() or len(data["text"]) > 64000:
            raise ValueError("invalid text")
        return data

    # Bound domain prose even where B intentionally permits long saved descriptions.
    def bounded(value, depth=0):
        if depth > 12:
            raise ValueError("proposal nesting too deep")
        if isinstance(value, str) and len(value) > 4000:
            raise ValueError("proposal string too long")
        if isinstance(value, dict):
            for key, item in value.items():
                bounded(key, depth + 1)
                bounded(item, depth + 1)
        if isinstance(value, list):
            for item in value:
                bounded(item, depth + 1)

    bounded(result)
    if len(json.dumps(result, allow_nan=False)) > 64000:
        raise ValueError("proposal too large")
    return result
