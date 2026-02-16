"""In-memory outbox queue for validated events."""

from __future__ import annotations

import copy
from typing import Dict, List

from event_bus import Event, validate_event


class Outbox:
    def __init__(self) -> None:
        self._events: List[Event] = []

    def enqueue(self, event: dict) -> None:
        validate_event(event)
        self._events.append(copy.deepcopy(event))

    def pending(self) -> list[dict]:
        return list(self._events)

    def ack(self, event_id: str) -> bool:
        for idx, event in enumerate(self._events):
            if event.get("meta", {}).get("event_id") == event_id:
                del self._events[idx]
                return True
        return False

    def clear(self) -> None:
        self._events.clear()
