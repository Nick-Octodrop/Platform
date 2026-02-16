import unittest

from app.stores import MemoryAutomationStore, MemoryJobStore
from app.worker import _run_automation


class TestAutomationRuntime(unittest.TestCase):
    def test_delay_reschedules(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Delay Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [{"id": "delay1", "kind": "delay", "seconds": 60}],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "queued")
        jobs = job_store.list("default")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["type"], "automation.run")

    def test_idempotency_skips_duplicate(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Idem Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [{"id": "noop1", "kind": "action", "action_id": "system.noop"}],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        first_runs = store.list_step_runs(run["id"])
        self.assertEqual(len(first_runs), 1)
        store.update_run(run["id"], {"status": "running", "current_step_index": 0})
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        second_runs = store.list_step_runs(run["id"])
        self.assertEqual(len(second_runs), 1)

    def test_retry_policy_reschedules(self):
        store = MemoryAutomationStore()
        job_store = MemoryJobStore()
        automation = store.create(
            {
                "name": "Retry Test",
                "status": "published",
                "trigger": {"kind": "event", "event_types": ["record.created"]},
                "steps": [
                    {
                        "id": "fail1",
                        "kind": "action",
                        "action_id": "system.fail",
                        "retry_policy": {"max_attempts": 2, "backoff_seconds": 1},
                    }
                ],
            }
        )
        run = store.create_run(
            {
                "automation_id": automation["id"],
                "status": "queued",
                "trigger_type": "record.created",
                "trigger_payload": {"record_id": "r1"},
            }
        )
        _run_automation({"payload": {"run_id": run["id"]}}, "default", automation_store=store, job_store=job_store)
        run_after = store.get_run(run["id"])
        self.assertEqual(run_after["status"], "queued")
        jobs = job_store.list("default")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["type"], "automation.run")


if __name__ == "__main__":
    unittest.main()
