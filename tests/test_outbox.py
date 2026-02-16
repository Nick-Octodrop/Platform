import os
import sys
import unittest


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "src")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
if SRC not in sys.path:
    sys.path.insert(0, SRC)

from event_bus import make_event
from outbox import Outbox


class TestOutbox(unittest.TestCase):
    def _base_meta(self) -> dict:
        return {
            "module_id": "job_management",
            "manifest_hash": "sha256:abcd",
            "actor": None,
            "trace_id": None,
        }

    def test_enqueue_pending_order(self) -> None:
        outbox = Outbox()
        e1 = make_event("a", {"x": 1}, self._base_meta())
        e2 = make_event("b", {"x": 2}, self._base_meta())
        outbox.enqueue(e1)
        outbox.enqueue(e2)
        pending = outbox.pending()
        self.assertEqual([p["name"] for p in pending], ["a", "b"])

    def test_ack(self) -> None:
        outbox = Outbox()
        event = make_event("a", {"x": 1}, self._base_meta())
        outbox.enqueue(event)
        event_id = event["meta"]["event_id"]
        self.assertTrue(outbox.ack(event_id))
        self.assertEqual(outbox.pending(), [])
        self.assertFalse(outbox.ack(event_id))


if __name__ == "__main__":
    unittest.main()
