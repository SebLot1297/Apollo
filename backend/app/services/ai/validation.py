"""Strict proposal boundary shared by live adapters and deterministic templates."""

import json
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.mission import MissionConfiguration, MissionObjective

# Narrative answers are shown as plain text in the console, so provider Markdown and
# LaTeX are reduced to the same prose style the deterministic templates use.
_MATH_SYMBOLS = (
    ("\\geq", ">="),
    ("\\ge", ">="),
    ("\\leq", "<="),
    ("\\le", "<="),
    ("\\neq", "!="),
    ("\\approx", "~"),
    ("\\times", "x"),
    ("\\pm", "+/-"),
    ("\\%", "%"),
    ("\\$", "$"),
    ("\\&", "&"),
)
_EMPHASIS = re.compile(r"\*\*(.+?)\*\*|__(.+?)__|`([^`\n]+)`", re.DOTALL)
_ITALIC = re.compile(r"(?<![\w*])\*([^*\n]{1,120}?)\*(?![\w*])")
_TEXT_WRAPPER = re.compile(r"\\(?:text|textbf|textit|emph|mathrm|mathbf|mathit)\{([^{}]*)\}")
_LATEX_COMMAND = re.compile(r"\\([a-zA-Z]+)")
_MATH_SPAN = re.compile(r"\$([^$\n]{1,200})\$")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s*")
_BULLET = re.compile(r"^(\s*)[*+]\s+")
_TABLE_SEPARATOR_CELL = re.compile(r":?-{2,}:?")


def _table_cells(line: str) -> list[str] | None:
    """Return the cells of a pasted table row, or None when the line is ordinary text."""
    stripped = line.strip()
    if len(stripped) < 2 or not stripped.startswith("|") or not stripped.endswith("|"):
        return None
    return [cell.strip() for cell in stripped[1:-1].split("|")]


def plain_text(text: str) -> str:
    """Strip Markdown emphasis, code spans, headings, tables and LaTeX from narrative text."""
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = _EMPHASIS.sub(lambda match: next(group for group in match.groups() if group), cleaned)
    cleaned = _TEXT_WRAPPER.sub(r"\1", cleaned)
    for latex, plain in _MATH_SYMBOLS:
        cleaned = cleaned.replace(latex, plain)
    cleaned = _MATH_SPAN.sub(lambda match: match.group(1), cleaned)
    cleaned = _LATEX_COMMAND.sub(r"\1", cleaned)  # keep the word, drop any unknown command
    lines = []
    in_table = False
    for line in cleaned.split("\n"):
        line = _BULLET.sub(r"\1- ", _HEADING.sub("", line))
        cells = _table_cells(line)
        if cells is None:
            in_table = False
        else:
            # Drop the '|---|---|' alignment row; it carries no content.
            if not any(cells) or all(_TABLE_SEPARATOR_CELL.fullmatch(cell) for cell in cells):
                continue
            joined = " · ".join(cell for cell in cells if cell)
            line = f"- {joined}" if in_table else joined  # first row of a table is its header
            in_table = True
        lines.append(_ITALIC.sub(r"\1", line).rstrip())
    cleaned = "\n".join(lines).replace("$", "")
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


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
        return {"text": plain_text(data["text"])}

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
