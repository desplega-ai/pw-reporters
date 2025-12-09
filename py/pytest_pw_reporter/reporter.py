"""JSON event reporter for Playwright tests."""

import json
import sys
from datetime import datetime
from typing import Any


class JSONReporter:
    """Emits JSON events for test lifecycle and Playwright steps."""

    def __init__(self, output=None):
        self.output = output or sys.stdout
        self.events: list[dict[str, Any]] = []

    def log_event(self, event: str, data: dict[str, Any] | None = None):
        """Log a JSON event to output."""
        payload = {"event": event, "timestamp": datetime.now().isoformat()}
        if data:
            payload.update(data)
        self.events.append(payload)
        print(json.dumps(payload, indent=2, default=str), file=self.output)

    def on_step_begin(self, title: str, category: str):
        """Called when a Playwright step begins."""
        self.log_event("onStepBegin", {
            "step": {
                "title": title,
                "category": category,
            }
        })

    def on_step_end(self, title: str, category: str, duration_ms: float, error: str | None = None):
        """Called when a Playwright step ends."""
        self.log_event("onStepEnd", {
            "step": {
                "title": title,
                "category": category,
                "duration": duration_ms,
                "error": error,
            }
        })


# Global reporter instance
reporter = JSONReporter()
