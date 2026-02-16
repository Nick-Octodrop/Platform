import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from event_bus import EventBus, EventValidationError, make_event
from outbox import Outbox


class TestEventBus(unittest.TestCase):
    def _base_meta(self) -> dict:
        return {
            "module_id": "job_management",
            "manifest_hash": "sha256:abcd",
            "actor": {"id": "u1", "roles": ["admin"]},
            "trace_id": None,
        }

    def test_publish_enqueues_to_outbox(self) -> None:
        outbox = Outbox()
        bus = EventBus(outbox=outbox)
        event = make_event("job.scheduled", {"job_id": "j1"}, self._base_meta())
        bus.publish(event)
        self.assertEqual(len(outbox.pending()), 1)

    def test_handlers_called_in_order(self) -> None:
        bus = EventBus()
        calls = []

        def h1(evt: dict) -> None:
            calls.append("h1")

        def h2(evt: dict) -> None:
            calls.append("h2")

        bus.subscribe("job.scheduled", h1)
        bus.subscribe("job.scheduled", h2)
        event = make_event("job.scheduled", {"job_id": "j1"}, self._base_meta())
        bus.publish(event)
        self.assertEqual(calls, ["h1", "h2"])

    def test_unsubscribe(self) -> None:
        bus = EventBus()
        calls = []

        def h1(evt: dict) -> None:
            calls.append("h1")

        bus.subscribe("job.scheduled", h1)
        removed = bus.unsubscribe("job.scheduled", h1)
        self.assertTrue(removed)
        event = make_event("job.scheduled", {"job_id": "j1"}, self._base_meta())
        bus.publish(event)
        self.assertEqual(calls, [])

    def test_invalid_envelope_missing_name(self) -> None:
        bus = EventBus()
        event = make_event("job.scheduled", {"job_id": "j1"}, self._base_meta())
        event.pop("name")
        with self.assertRaises(EventValidationError):
            bus.publish(event)

    def test_invalid_occurred_at(self) -> None:
        bus = EventBus()
        event = make_event("job.scheduled", {"job_id": "j1"}, self._base_meta())
        event["meta"]["occurred_at"] = "2026-01-29T01:23:45"
        with self.assertRaises(EventValidationError):
            bus.publish(event)

    def test_invalid_manifest_hash_prefix(self) -> None:
        bus = EventBus()
        event = make_event("job.scheduled", {"job_id": "j1"}, self._base_meta())
        event["meta"]["manifest_hash"] = "md5:bad"
        with self.assertRaises(EventValidationError):
            bus.publish(event)

    def test_payload_rejects_nan_inf(self) -> None:
        bus = EventBus()
        event = make_event("job.scheduled", {"value": 1.0}, self._base_meta())
        event["payload"]["value"] = float("nan")
        with self.assertRaises(EventValidationError):
            bus.publish(event)


if __name__ == "__main__":
    unittest.main()
