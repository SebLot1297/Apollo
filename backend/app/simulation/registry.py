"""Authoritative, inert definitions shared by validation, engine, and clients."""
from types import MappingProxyType

OPERATORS = (">=", "<=", "=", ">", "<")


def _metric(key, name, unit, maximum, value_type, modes, calculation):
    return MappingProxyType(dict(key=key, name=name, label=name, unit=unit, minimum=0,
                                 maximum=maximum, value_type=value_type,
                                 supported_modes=tuple(modes), operators=OPERATORS,
                                 calculation=calculation))


METRIC_REGISTRY = MappingProxyType({
    "communication_uptime_percent": _metric(
        "communication_uptime_percent", "Communication uptime", "%", 100, "number",
        ["final", "maintained", "deadline"],
        "100 * connected simulated seconds / elapsed seconds. Connected means effective "
        "communications and power health are both >= 50. At time zero use 100 if connected, else 0."),
    "equipment_availability_percent": _metric(
        "equipment_availability_percent", "Equipment availability", "%", 100, "number",
        ["final", "maintained", "deadline"], "100 * operational equipment units / 20."),
    "incidents_resolved": _metric(
        "incidents_resolved", "Incidents resolved", "count", None, "integer",
        ["final", "maintained", "deadline", "accumulated"], "Number of distinct resolved incident IDs."),
    "supplies_delivered_percent": _metric(
        "supplies_delivered_percent", "Support supplies delivered", "%", 100, "number",
        ["final", "maintained", "deadline", "accumulated"],
        "Cumulative delivery percentage, capped at 100; rate = teams * remaining resources / 60000 per second."),
    "systems_restored": _metric(
        "systems_restored", "Systems restored", "count", None, "integer",
        ["final", "maintained", "deadline", "accumulated"],
        "Distinct degraded/offline to operational recovery episodes (health crossing >= 75)."),
    "elapsed_time_seconds": _metric(
        "elapsed_time_seconds", "Elapsed simulation time", "seconds", 86400, "number",
        ["final", "maintained", "deadline", "accumulated"], "Actual simulated seconds, excluding pauses."),
})


def _parameter(key, name, kind, default, description, effects, minimum=None, maximum=None, unit=None):
    return MappingProxyType(dict(key=key, name=name, label=name, type=kind, unit=unit,
                                 default=default, minimum=minimum, maximum=maximum,
                                 description=description, effects=effects,
                                 validation="Strict finite numeric values; booleans are not numbers."
                                 if kind in ("integer", "number") else "Strict declared type only."))


PARAMETER_REGISTRY = MappingProxyType({
    "mission_duration": _parameter("mission_duration", "Mission duration", "integer", 21600,
        "Top-level duration_seconds; no additional parameter field.", "Clips the simulation endpoint.", 60, 86400, "seconds"),
    "weather_severity": _parameter("weather_severity", "Weather severity", "number", 50,
        "Synthetic weather intensity.", "Adds 0.8 * severity / 100 incidents/hour to communications and power risk.", 0, 100, "%"),
    "environmental_disruption": _parameter("environmental_disruption", "Environmental disruption", "number", 40,
        "Synthetic infrastructure disruption.", "Initial power health = 100 - disruption / 2; adds power and equipment risk.", 0, 100, "%"),
    "team_count": _parameter("team_count", "Support teams", "integer", 4,
        "Number of fictional support teams.", "Multiplies delivery rate and divides repair resource costs.", 1, 10, "count"),
    "equipment_reliability": _parameter("equipment_reliability", "Equipment reliability", "number", 75,
        "Initial operational equipment percentage.", "Initial units = floor(20 * reliability / 100); lower reliability increases degradation risk.", 0, 100, "%"),
    "resource_level": _parameter("resource_level", "Resources", "number", 70,
        "Initial resource budget.", "Constrains repairs and deliveries; delivery consumes 0.1 resource units per percentage point.", 0, 100, "%"),
    "communication_reliability": _parameter("communication_reliability", "Communication reliability", "number", 45,
        "Initial communication health.", "Sets initial health; lower reliability increases communications outage risk.", 0, 100, "%"),
    "backup_power_enabled": _parameter("backup_power_enabled", "Backup power", "boolean", True,
        "Availability of backup power capability.", "Allows activation costing 3 resources; effective power health floor 90."),
    "custom_metadata": _parameter("custom_metadata", "Custom metadata", "object", None,
        "String-keyed JSON scalar annotations; default empty object.", "No numerical effects; never evaluated or executed."),
})


def get_registry() -> dict:
    """Return fresh JSON-compatible objects; callers cannot mutate registry definitions."""
    def export(entry):
        return {key: list(value) if isinstance(value, tuple) else value for key, value in entry.items()}
    result = {"metrics": [export(value) for value in METRIC_REGISTRY.values()],
              "parameters": [export(value) for value in PARAMETER_REGISTRY.values()],
              "categories": [
                  {"key": "communications_recovery", "name": "Communications Recovery", "enabled": True},
                  {"key": "search_and_rescue", "name": "Search and Rescue", "enabled": False},
                  {"key": "humanitarian_logistics", "name": "Humanitarian Logistics", "enabled": False},
                  {"key": "base_infrastructure_emergency", "name": "Base Infrastructure Emergency", "enabled": False},
                  {"key": "defensive_cyber_incident_response", "name": "Defensive Cyber Incident Response", "enabled": False},
              ]}
    for parameter in result["parameters"]:
        if parameter["key"] == "custom_metadata":
            parameter["default"] = {}
    return result
