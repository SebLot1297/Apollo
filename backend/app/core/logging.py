import json
import logging
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    def format(self, record):
        # Whitelist known structured fields; exclude exception SQL/URLs/secrets.
        data = {
            "time": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        for key in ("error_type", "engine_ready", "ai_ready", "database_engine"):
            if hasattr(record, key):
                data[key] = getattr(record, key)
        return json.dumps(data)


def configure(level):
    logger = logging.getLogger("commandgrid")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)
    logger.setLevel(level.upper())
