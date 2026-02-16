import unittest

from app.automations import match_event
from app.automations_runtime import handle_event
from app.stores import MemoryAutomationStore, MemoryJobStore
from event_bus import make_event


class TestAutomations(unittest.TestCase):
    def _event(self, event_type: str, payload: dict) -> dict:
        meta = {
            "module_id": "module_test",
            "manifest_hash": "sha256:test",
            "actor": {"id": "u1", "roles": ["owner"]},
        }
        return make_event("t1", {"event": event_type, **payload}, meta)

    def test_match_event_filters(self) -> None:
        trigger = {
            "kind": "event",
            "event_types": ["record.created"],
            "filters": [{"path": "record.status", "op": "eq", "value": "open"}],
        }
        payload = {"record": {"status": "open"}}
        self.assertTrue(match_event(trigger, "record.created", payload))
        self.assertFalse(match_event(trigger, "record.updated", payload))
        self.assertFalse(match_event(trigger, "record.created", {"record": {"status": "closed"}}))

    def test_handle_event_creates_run(self) -> None:
        automation_store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = automation_store.create(
            {
                "name": "Auto 1",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"], "filters": []},
                "steps": [{"id": "s1", "kind": "action", "action_id": "system.notify", "inputs": {}}],
            }
        )
        event = self._event("record.created", {"record": {"id": "r1"}})
        runs = handle_event(automation_store, job_store, event)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["automation_id"], automation["id"])


if __name__ == "__main__":
    unittest.main()
