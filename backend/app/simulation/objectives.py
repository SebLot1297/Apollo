"""Historical evaluation over analytic intervals, never inferred from telemetry."""
import math

from app.schemas.simulation import ObjectiveEvidence, ObjectiveResult
from .clock import TERMINAL_STATUSES
from .metrics import metric_values_at

EPSILON = 1e-9  # Absolute tolerance in each metric's documented units.


def compare(actual: float, operator: str, target: float) -> bool:
    if operator == ">=":
        return actual >= target - EPSILON
    if operator == "<=":
        return actual <= target + EPSILON
    if operator == "=":
        return abs(actual - target) <= EPSILON
    if operator == ">":
        return actual > target + EPSILON
    if operator == "<":
        return actual < target - EPSILON
    raise ValueError(f"unsupported operator: {operator}")


def _value(state, objective, seconds):
    return metric_values_at(state, seconds)[objective.metric_key]


def _first_satisfied(state, objective, start, end):
    """Find entry into the condition's value range, including interior equality."""
    first, last = _value(state, objective, start), _value(state, objective, end)
    if compare(first, objective.operator, objective.target_value):
        return start
    if first == last:
        return None
    target, operator = objective.target_value, objective.operator
    increasing = last > first
    lower = target - EPSILON if operator in (">=", "=") else target + EPSILON if operator == ">" else -math.inf
    upper = target + EPSILON if operator in ("<=", "=") else target - EPSILON if operator == "<" else math.inf
    boundary = lower if increasing else upper
    if not min(first, last) <= boundary <= max(first, last):
        return None
    low, high = start, end
    for _ in range(64):
        mid = (low + high) / 2
        if mid == low or mid == high:
            break
        value = _value(state, objective, mid)
        entered = value >= boundary if increasing else value <= boundary
        if entered:
            high = mid
        else:
            low = mid
    candidate = high
    for _ in range(16):
        if candidate <= end and compare(_value(state, objective, candidate), operator, target):
            return candidate
        candidate = math.nextafter(candidate, math.inf)
    return None


def _first_breach(state, objective, start, end):
    if not compare(_value(state, objective, start), objective.operator, objective.target_value):
        return start
    if compare(_value(state, objective, end), objective.operator, objective.target_value):
        return None
    low, high = start, end
    for _ in range(64):
        mid = (low + high) / 2
        if mid == low or mid == high:
            break
        if compare(_value(state, objective, mid), objective.operator, objective.target_value):
            low = mid
        else:
            high = mid
    return high


def evaluate(state, *, interval_start=None, finalize=False):
    terminal = finalize or state.status in TERMINAL_STATUSES
    start = state.elapsed_time_seconds if interval_start is None else interval_start
    end = state.elapsed_time_seconds
    results = []
    for objective in state.mission.objectives:
        key = str(objective.id)
        evidence = state.objective_evidence.setdefault(key, ObjectiveEvidence())
        if evidence.first_achieved_at_seconds is None:
            first = _first_satisfied(state, objective, start, end)
            if first is not None:
                evidence.first_achieved_at_seconds = first
        if objective.evaluation_mode == "maintained" and not evidence.breached:
            breach = _first_breach(state, objective, start, end)
            if breach is not None:
                evidence.breached = True
                evidence.breach_at_seconds = breach
        value = state.metrics[objective.metric_key]
        condition = compare(value, objective.operator, objective.target_value)
        mode = objective.evaluation_mode
        description = f"{objective.metric_key}={value:g} {objective.operator} {objective.target_value:g}. "
        if mode == "deadline":
            first = evidence.first_achieved_at_seconds
            passed = first is not None and first <= objective.deadline_seconds
            expired = end > objective.deadline_seconds or (first is not None and first > objective.deadline_seconds)
            status = "passed" if passed else "expired" if expired else "failed" if terminal else "pending"
            reason = description + (f"First achieved at {first:.12g}s; inclusive deadline {objective.deadline_seconds:g}s."
                                    if first is not None else f"Not achieved; inclusive deadline {objective.deadline_seconds:g}s.")
        elif mode == "maintained":
            passed = terminal and not evidence.breached
            status = "failed" if evidence.breached else "passed" if terminal else "pending"
            reason = description + (f"Historical breach at {evidence.breach_at_seconds:.12g}s; recovery cannot erase it."
                                    if evidence.breached else "No historical breach from time zero through the current endpoint.")
        elif mode == "accumulated":
            passed = condition
            status = "passed" if passed else "failed" if terminal else "pending"
            reason = description + "Compared the cumulative state value once; telemetry samples are never summed."
        else:
            passed = terminal and condition
            status = "passed" if passed else "failed" if terminal else "pending"
            reason = description + ("Evaluated at the actual terminal endpoint." if terminal else "Awaiting the actual terminal endpoint.")
        results.append(ObjectiveResult(objective=objective.model_copy(deep=True), achieved_value=value,
            passed=passed, status=status, first_achieved_at_seconds=evidence.first_achieved_at_seconds,
            reason=reason))
    state.objective_results = results


def required_pass(state):
    return all(result.passed for result in state.objective_results if result.objective.required)
