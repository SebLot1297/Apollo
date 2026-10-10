"""Golden fixtures proving the narrative boundary always yields plain, readable text.

Every ``<case>.input.txt`` holds messy provider output (Markdown, LaTeX, pasted tables) and
``<case>.expected.txt`` holds the reviewed plain-text result; golden files end with a newline.
The checks are deliberately independent: the golden comparison pins exact output, the symbol
scan rejects a "fixed" golden file full of formatting marks, and the number scan proves
recorded evaluator values survive normalization unchanged.
"""

import pathlib
import re

import pytest
from app.services.ai.providers import ProviderResult
from app.services.ai.validation import plain_text
from test_ai import FakeProvider, service

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "narrative"
CASES = sorted(path.name[: -len(".input.txt")] for path in FIXTURES.glob("*.input.txt"))
NARRATIVE_TASKS = ("chat", "explain_incident", "generate_report", "generate_recovery_strategy")
PROVIDERS = ("gemini", "qwen", "mock")
FORBIDDEN = ("**", "__", "$", "`", "\\", "#", "|", "* ", "+ ")
PROMPT = "Summarize the recorded run for the operator."


def fixture(case: str, kind: str) -> str:
    return (FIXTURES / f"{case}.{kind}.txt").read_text(encoding="utf-8")


def test_every_case_has_a_reviewed_golden_file():
    assert len(CASES) >= 5
    for case in CASES:
        assert (FIXTURES / f"{case}.expected.txt").is_file(), f"missing golden output for {case}"
        assert fixture(case, "input").strip(), f"empty input fixture for {case}"


@pytest.mark.parametrize("case", CASES)
def test_plain_text_matches_the_reviewed_golden_output(case):
    assert plain_text(fixture(case, "input")) == fixture(case, "expected").rstrip("\n")


@pytest.mark.parametrize("case", CASES)
def test_golden_output_is_plain_readable_prose(case):
    result = plain_text(fixture(case, "input"))
    for symbol in FORBIDDEN:
        assert symbol not in result, f"{case} still contains {symbol!r}"
    assert "\n\n\n" not in result
    assert plain_text(result) == result


@pytest.mark.parametrize("case", CASES)
def test_recorded_numbers_survive_normalization(case):
    source = fixture(case, "input")
    result = plain_text(source)
    numbers = re.findall(r"\d+(?:\.\d+)?", source)
    assert numbers, f"{case} should contain recorded values"
    for number in numbers:
        assert number in result, f"{case} lost the recorded value {number}"


@pytest.mark.parametrize("case", CASES)
@pytest.mark.parametrize("task", NARRATIVE_TASKS)
async def test_every_provider_returns_plain_text(case, task):
    payload = ProviderResult(fixture(case, "input"))
    ai = service(FakeProvider("gemini", [payload]), FakeProvider("qwen", [payload]), ai_requests_per_minute=120)
    for provider in PROVIDERS:
        envelope = await ai.execute(task, PROMPT, provider=provider)
        assert envelope["provider"] == provider
        text = envelope["data"]["text"]
        assert text.strip(), f"{provider}/{task} returned empty text for {case}"
        for symbol in FORBIDDEN:
            assert symbol not in text, f"{provider}/{task} left {symbol!r} in {case}"
        assert plain_text(text) == text, f"{provider}/{task} text was not already plain in {case}"
