"""Simulation-only clock. Wall-clock scaling belongs to the external runner."""
import math
from datetime import timedelta
from decimal import Decimal

TERMINAL_STATUSES = frozenset({"completed", "failed", "terminated"})


def finite_number(value, name, *, positive=False):
    qualifier = "positive" if positive else "nonnegative"
    message = f"{name} must be a finite {qualifier} number"
    if type(value) not in (int, float):
        raise ValueError(message)
    try:
        number = float(value)
    except (OverflowError, ValueError) as error:
        raise ValueError(message) from error
    if not math.isfinite(number) or number < 0 or (positive and number == 0):
        raise ValueError(message)
    return number


def end_time(state, seconds):
    delta = finite_number(seconds, "seconds")
    # Decimal addition prevents common decimal deltas (e.g. ten 0.1s calls)
    # from generating a different endpoint than one 1s call.
    return min(float(Decimal(str(state.elapsed_time_seconds)) + Decimal(str(delta))),
               float(state.mission.duration_seconds))


def timestamp(state, seconds=None):
    return state.mission.created_at + timedelta(
        seconds=state.elapsed_time_seconds if seconds is None else seconds)
